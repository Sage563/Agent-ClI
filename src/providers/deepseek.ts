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
  for (const msg of history) messages.push({ role: msg.role, content: msg.content });
  const taskJson = JSON.stringify(cloned);
  const contentParts: any[] = [{ type: "text", text: `=== CURRENT TURN OBJECTIVE ===\n${taskJson}\n==============================` }];
  for (const img of imageFiles) {
    const mime = String(img?.mime || "image/png");
    const data = String(img?.data_base64 || "");
    if (data) {
      contentParts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${data}` } });
    }
  }
  messages.push({ role: "user", content: contentParts });
  return messages;
}

export class DeepSeekProvider extends Provider {
  async call(system: string, task: TaskPayload, opts?: ProviderCallOptions): Promise<ProviderResult> {
    const apiKey = cfg.getApiKey("deepseek");
    if (!apiKey) throw new Error("DeepSeek API key not found. Use '/config deepseek_api_key <key>'.");

    const providerConfig = cfg.getProviderConfig("deepseek");
    const client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com", timeout: 360000 });
    const messages = buildMessages(system, task);
    const streamEnabled =
      typeof task._stream_enabled === "boolean" ? task._stream_enabled : Boolean(providerConfig.stream ?? cfg.get("stream", true));

    if (streamEnabled) {
      const chunks: string[] = [];
      const reasoningChunks: string[] = [];
      const usage = { input_tokens: 0, output_tokens: 0 };
      const response = await client.chat.completions.create({
        model: String(providerConfig.model || "deepseek-chat"),
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
        if (delta?.content) {
          chunks.push(delta.content);
          if (opts?.streamCallback) opts.streamCallback(delta.content);
        }
        if (delta?.reasoning_content) reasoningChunks.push(delta.reasoning_content);
      }
      return { text: chunks.join(""), usage, thinking: reasoningChunks.join("") };
    }

    const response = await client.chat.completions.create({
      model: String(providerConfig.model || "deepseek-chat"),
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
    const apiKey = cfg.getApiKey("deepseek");
    if (!apiKey) return { ok: false, message: "DeepSeek API key not set." };
    try {
      const client = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });
      await client.models.list();
      return { ok: true, message: "DeepSeek API key is valid." };
    } catch (error) {
      return { ok: false, message: `DeepSeek validation failed: ${String(error)}` };
    }
  }
}
