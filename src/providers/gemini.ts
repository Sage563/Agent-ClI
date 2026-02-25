import { GoogleGenAI } from "@google/genai";
import { cfg } from "../config";
import type { TaskPayload } from "../types";
import type { ProviderCallOptions, ProviderResult } from "./base";
import { Provider } from "./base";

function normalizeModelName(modelName: string) {
  const aliases: Record<string, string> = {
    "gemini-2.0-flash-exp": "gemini-2.0-flash",
  };
  return aliases[modelName] || modelName;
}

function extractRetrySeconds(errorText: string) {
  const patterns = [/Please retry in\s+([0-9]+(?:\.[0-9]+)?)s/i, /retryDelay[:=]\s*([0-9]+)s/i];
  for (const pattern of patterns) {
    const match = pattern.exec(errorText || "");
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

function isQuotaError(errorText: string) {
  const text = (errorText || "").toLowerCase();
  return text.includes("resource_exhausted") || text.includes("quota exceeded");
}

function isHardQuotaZero(errorText: string) {
  return (errorText || "").toLowerCase().includes("limit: 0");
}

export class GeminiProvider extends Provider {
  async call(system: string, task: TaskPayload, opts?: ProviderCallOptions): Promise<ProviderResult> {
    const apiKey = cfg.getApiKey("gemini");
    if (!apiKey) throw new Error("Gemini API key not found. Use '/config gemini_api_key <key>'.");

    const providerConfig = cfg.getProviderConfig("gemini");
    const ai = new GoogleGenAI({ apiKey });
    const modelName = normalizeModelName(String(providerConfig.model || "gemini-2.0-flash"));

    const taskClone = { ...task } as Record<string, any>;
    const history = Array.isArray(taskClone.session_history) ? taskClone.session_history : [];
    const imageFiles = Array.isArray(taskClone.image_files) ? taskClone.image_files : [];
    delete taskClone.session_history;
    delete taskClone.image_files;

    const contents: any[] = [];
    history.forEach((msg) => {
      contents.push({ role: msg.role, parts: [{ text: msg.content }] });
    });
    const taskJson = JSON.stringify(taskClone);
    const parts: any[] = [{ text: `=== CURRENT TURN OBJECTIVE ===\n${taskJson}\n==============================` }];
    for (const img of imageFiles) {
      const mime = String(img?.mime || "image/png");
      const data = String(img?.data_base64 || "");
      if (data) parts.push({ inlineData: { mimeType: mime, data } });
    }
    contents.push({ role: "user", parts });

    const streamEnabled =
      typeof task._stream_enabled === "boolean" ? task._stream_enabled : Boolean(providerConfig.stream ?? cfg.get("stream", true));

    const attempts = 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        if (streamEnabled) {
          const stream = await ai.models.generateContentStream({
            model: modelName,
            contents,
            config: {
              systemInstruction: system,
              ...(providerConfig.generation || {}),
            } as any,
          });

          const chunks: string[] = [];
          let usageMeta: any;
          for await (const chunk of stream) {
            if (opts?.cancelSignal?.aborted) break;
            const text = String((chunk as any).text || "");
            if (text) {
              chunks.push(text);
              if (opts?.streamCallback) opts.streamCallback(text);
            }
            if ((chunk as any).usageMetadata) usageMeta = (chunk as any).usageMetadata;
          }

          return {
            text: chunks.join(""),
            usage: {
              input_tokens: Number(usageMeta?.promptTokenCount || 0),
              output_tokens: Number(usageMeta?.candidatesTokenCount || 0),
            },
            thinking: "",
          };
        }

        const response = await ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            systemInstruction: system,
            ...(providerConfig.generation || {}),
          } as any,
        });

        return {
          text: String((response as any).text || ""),
          usage: {
            input_tokens: Number((response as any).usageMetadata?.promptTokenCount || 0),
            output_tokens: Number((response as any).usageMetadata?.candidatesTokenCount || 0),
          },
          thinking: "",
        };
      } catch (error) {
        const errorText = String(error);
        if (isQuotaError(errorText)) {
          const retryAfter = extractRetrySeconds(errorText);
          const canRetry = attempt + 1 < attempts && retryAfter && retryAfter > 0 && retryAfter <= 60 && !isHardQuotaZero(errorText);
          if (canRetry) {
            await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
            continue;
          }
          throw new Error(
            [
              "Gemini quota exhausted (429 RESOURCE_EXHAUSTED).",
              `Model: ${modelName}`,
              "Action:",
              "1. Enable billing/check quota at https://ai.google.dev/gemini-api/docs/rate-limits",
              "2. Or switch provider/model, e.g. `/provider openai` or `/provider ollama`",
              "3. If using free tier with `limit: 0`, retries will not succeed until quota is available.",
            ].join("\n"),
          );
        }
        throw error;
      }
    }

    return { text: "", usage: { input_tokens: 0, output_tokens: 0 }, thinking: "" };
  }

  async validate() {
    const apiKey = cfg.getApiKey("gemini");
    if (!apiKey) return { ok: false, message: "Gemini API key not set." };
    try {
      const ai = new GoogleGenAI({ apiKey });
      const model = normalizeModelName(String(cfg.getModel("gemini") || "gemini-2.0-flash"));
      await ai.models.get({ model });
      return { ok: true, message: "Gemini API key is valid." };
    } catch (error) {
      return { ok: false, message: `Gemini validation failed: ${String(error)}` };
    }
  }
}
