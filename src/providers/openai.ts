import OpenAI from "openai";
import { cfg } from "../config";
import type { TaskPayload } from "../types";
import type { ProviderCallOptions, ProviderResult } from "./base";
import { Provider } from "./base";

function buildMessages(system: string, task: TaskPayload) {
  const cloned = { ...task } as Record<string, any>;
  const history = Array.isArray(cloned.session_history) ? cloned.session_history : [];
  const imageFiles = Array.isArray(cloned.image_files) ? cloned.image_files : [];
  delete cloned.session_history;
  delete cloned.image_files;

  const messages: any[] = [{ role: "system", content: system }];
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  const taskJson = JSON.stringify(cloned);
  const contentParts: any[] = [{ type: "text", text: `=== CURRENT TURN OBJECTIVE ===\n${taskJson}\n==============================` }];
  for (const img of imageFiles) {
    const mime = String(img?.mime || "image/png");
    const data = String(img?.data_base64 || "");
    if (data) {
      contentParts.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${data}` },
      });
    }
  }
  messages.push({ role: "user", content: contentParts });
  return messages;
}

export class OpenAIProvider extends Provider {
  async call(system: string, task: TaskPayload, opts?: ProviderCallOptions): Promise<ProviderResult> {
    const apiKey = cfg.getApiKey("openai");
    if (!apiKey) throw new Error("OpenAI API key not found. Please set '/config openai_api_key <key>'.");

    const client = new OpenAI({ apiKey, timeout: 360000 });
    const providerConfig = cfg.getProviderConfig("openai");
    const streamOverride = task._stream_enabled;
    const streamEnabled = typeof streamOverride === "boolean" ? streamOverride : Boolean(providerConfig.stream ?? cfg.get("stream", true));
    const messages = buildMessages(system, task);

    if (streamEnabled) {
      const chunks: string[] = [];
      const reasoningChunks: string[] = [];
      const usage = { input_tokens: 0, output_tokens: 0 };
      const response = await client.chat.completions.create({
        model: String(providerConfig.model || "gpt-4o"),
        messages,
        stream: true,
        ...(providerConfig.generation || {}),
      } as any);

      for await (const event of response as any) {
        if (opts?.cancelSignal?.aborted) break;
        if (event?.usage) {
          usage.input_tokens = event.usage.prompt_tokens || 0;
          usage.output_tokens = event.usage.completion_tokens || 0;
        }
        const delta = event?.choices?.[0]?.delta;
        const content = delta?.content;
        if (content) {
          chunks.push(content);
          if (opts?.streamCallback) opts.streamCallback(content);
        }
        const reasoning = delta?.reasoning_content;
        if (reasoning) reasoningChunks.push(reasoning);
      }
      return { text: chunks.join(""), usage, thinking: reasoningChunks.join("") };
    }

    const response = await client.chat.completions.create({
      model: String(providerConfig.model || "gpt-4o"),
      messages,
      ...(providerConfig.generation || {}),
    } as any);
    const message = response.choices?.[0]?.message;
    return {
      text: String(message?.content || ""),
      usage: {
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
      },
      thinking: String((message as any)?.reasoning_content || ""),
    };
  }

  async validate() {
    const apiKey = cfg.getApiKey("openai");
    if (!apiKey) return { ok: false, message: "OpenAI API key not set." };
    try {
      const client = new OpenAI({ apiKey });
      await client.models.list();
      return { ok: true, message: "OpenAI API key is valid." };
    } catch (error) {
      return { ok: false, message: `OpenAI validation failed: ${String(error)}` };
    }
  }
}
