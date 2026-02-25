import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "../config";
import type { TaskPayload } from "../types";
import type { ProviderCallOptions, ProviderResult } from "./base";
import { Provider } from "./base";

function buildMessages(task: TaskPayload) {
  const cloned = { ...task } as Record<string, any>;
  const history = Array.isArray(cloned.session_history) ? cloned.session_history : [];
  const imageFiles = Array.isArray(cloned.image_files) ? cloned.image_files : [];
  delete cloned.session_history;
  delete cloned.image_files;

  const messages: any[] = [];
  history.forEach((msg) => messages.push({ role: msg.role, content: msg.content }));
  const taskJson = JSON.stringify(cloned);
  const parts: any[] = [{ type: "text", text: `=== CURRENT TURN OBJECTIVE ===\n${taskJson}\n==============================` }];
  for (const img of imageFiles) {
    const mime = String(img?.mime || "image/png");
    const data = String(img?.data_base64 || "");
    if (data) {
      parts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mime,
          data,
        },
      });
    }
  }
  messages.push({ role: "user", content: parts });
  return messages;
}

export class AnthropicProvider extends Provider {
  async call(system: string, task: TaskPayload, opts?: ProviderCallOptions): Promise<ProviderResult> {
    const apiKey = cfg.getApiKey("anthropic");
    if (!apiKey) throw new Error("Anthropic API key not found. Use '/config anthropic_api_key <key>'.");

    const providerConfig = cfg.getProviderConfig("anthropic");
    const client = new Anthropic({ apiKey, timeout: 360000 });
    const messages = buildMessages(task);
    const streamEnabled =
      typeof task._stream_enabled === "boolean" ? task._stream_enabled : Boolean(providerConfig.stream ?? cfg.get("stream", true));

    if (streamEnabled) {
      const chunks: string[] = [];
      const usage = { input_tokens: 0, output_tokens: 0 };
      const stream = await client.messages.stream({
        model: String(providerConfig.model || "claude-3-5-sonnet-20241022"),
        max_tokens: Number((providerConfig.generation || {}).max_tokens || 4096),
        system,
        messages,
      });
      for await (const event of stream) {
        if (opts?.cancelSignal?.aborted) break;
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          const text = event.delta.text || "";
          chunks.push(text);
          if (opts?.streamCallback) opts.streamCallback(text);
        }
      }
      const finalMessage = await stream.finalMessage();
      usage.input_tokens = finalMessage.usage.input_tokens || 0;
      usage.output_tokens = finalMessage.usage.output_tokens || 0;
      return { text: chunks.join(""), usage, thinking: "" };
    }

    const response = await client.messages.create({
      model: String(providerConfig.model || "claude-3-5-sonnet-20241022"),
      max_tokens: Number((providerConfig.generation || {}).max_tokens || 4096),
      system,
      messages,
    });
    return {
      text: String((response.content?.[0] as any)?.text || ""),
      usage: {
        input_tokens: response.usage.input_tokens || 0,
        output_tokens: response.usage.output_tokens || 0,
      },
      thinking: "",
    };
  }

  async validate() {
    const apiKey = cfg.getApiKey("anthropic");
    if (!apiKey) return { ok: false, message: "Anthropic API key not set." };
    try {
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
      return { ok: true, message: "Anthropic API key is valid." };
    } catch (error) {
      return { ok: false, message: `Anthropic validation failed: ${String(error)}` };
    }
  }
}
