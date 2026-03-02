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
    const historicalContent = Array.isArray(msg.content)
      ? msg.content.map((c: any) => (typeof c === "string" ? c : c.text || "")).join("\n")
      : msg.content;
    messages.push({ role: msg.role, content: historicalContent });
  }
  const taskJson = JSON.stringify(cloned);
  const turnText = `=== CURRENT TURN OBJECTIVE ===\n${taskJson}\n==============================`;

  if (imageFiles.length === 0) {
    messages.push({ role: "user", content: turnText });
  } else {
    const contentParts: any[] = [{ type: "text", text: turnText }];
    for (const img of imageFiles) {
      const mime = String(img?.mime || "image/png");
      const data = String(img?.data_base64 || "");
      if (data) {
        contentParts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${data}` } });
      }
    }
    messages.push({ role: "user", content: contentParts });
  }
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
      let startedThinking = false;
      let endedThinking = false;
      for await (const event of response as any) {
        if (opts?.cancelSignal?.aborted) break;
        if (event?.usage) {
          usage.input_tokens = event.usage.prompt_tokens || usage.input_tokens;
          usage.output_tokens = event.usage.completion_tokens || usage.output_tokens;
        }
        const delta = event?.choices?.[0]?.delta;

        if (delta?.reasoning_content) {
          if (!startedThinking) {
            startedThinking = true;
            const openPattern = "<think>\n";
            reasoningChunks.push(openPattern);
            if (opts?.streamCallback) opts.streamCallback(openPattern);
          }
          reasoningChunks.push(delta.reasoning_content);
          if (opts?.streamCallback) opts.streamCallback(delta.reasoning_content);
        }

        if (delta?.content) {
          if (startedThinking && !endedThinking) {
            endedThinking = true;
            const closePattern = "\n</think>\n";
            reasoningChunks.push(closePattern);
            if (opts?.streamCallback) opts.streamCallback(closePattern);
          }
          chunks.push(delta.content);
          if (opts?.streamCallback) opts.streamCallback(delta.content);
        }
      }
      // Final close if needed
      if (startedThinking && !endedThinking) {
        const closePattern = "\n</think>\n";
        reasoningChunks.push(closePattern);
        if (opts?.streamCallback) opts.streamCallback(closePattern);
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
