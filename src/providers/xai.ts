import OpenAI from "openai";
import { cfg } from "../config";
import type { TaskPayload } from "../types";
import type { ProviderCallOptions, ProviderResult } from "./base";
import { ResilientProvider } from "./base";

const XAI_BASE_URL = "https://api.x.ai/v1";

export class XAIProvider extends ResilientProvider {
    constructor() {
        super({ name: "xai", timeout: 60000, maxRetries: 3 });
    }

    private buildMessages(system: string, task: TaskPayload) {
        const cloned = { ...task } as Record<string, any>;
        const history = Array.isArray(cloned.session_history) ? cloned.session_history : [];
        const imageFiles = Array.isArray(cloned.image_files) ? cloned.image_files : [];
        delete cloned.session_history;
        delete cloned.image_files;

        const messages: any[] = [{ role: "system", content: system }];
        for (const msg of history) {
            messages.push({ role: msg.role, content: this.flattenContent(msg.content) });
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

    protected async executeCall(system: string, task: TaskPayload, opts?: ProviderCallOptions): Promise<ProviderResult> {
        const apiKey = cfg.getApiKey("xai");
        if (!apiKey) throw new Error("xAI API key not found. Run '/connect' or set XAI_API_KEY.");

        const providerConfig = cfg.getProviderConfig("xai");
        const thinkingEnabled = typeof providerConfig.thinking === "boolean" ? providerConfig.thinking : true;
        const baseURL = String(providerConfig.endpoint || XAI_BASE_URL);
        const client = new OpenAI({ apiKey, baseURL, timeout: 360000 });
        const streamOverride = task._stream_enabled;
        const streamEnabled = typeof streamOverride === "boolean" ? streamOverride : Boolean(providerConfig.stream ?? cfg.get("stream", true));
        const messages = this.buildMessages(system, task);
        const model = String(providerConfig.model || "grok-3");

        if (streamEnabled) {
            const chunks: string[] = [];
            const reasoningChunks: string[] = [];
            const usage = { input_tokens: 0, output_tokens: 0 };
            const response = await client.chat.completions.create({
                model,
                messages,
                stream: true,
                ...(providerConfig.generation || {}),
            } as any);

            for await (const event of response as any) {
                if (opts?.cancelSignal?.aborted) break;
                if (event?.usage) {
                    usage.input_tokens = event.usage.prompt_tokens ?? usage.input_tokens;
                    usage.output_tokens = event.usage.completion_tokens ?? usage.output_tokens;
                }
                const delta = event?.choices?.[0]?.delta;
                const content = delta?.content;
                if (content) {
                    chunks.push(content);
                    if (opts?.streamCallback) opts.streamCallback(content);
                }
                const reasoning = delta?.reasoning_content;
                if (thinkingEnabled && reasoning) reasoningChunks.push(reasoning);
            }
            return { text: chunks.join(""), usage, thinking: thinkingEnabled ? reasoningChunks.join("") : "" };
        }

        const response = await client.chat.completions.create({
            model,
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
            thinking: thinkingEnabled ? String((message as any)?.reasoning_content || "") : "",
        };
    }

    protected async executeValidation() {
        const apiKey = cfg.getApiKey("xai");
        if (!apiKey) return { ok: false, message: "xAI API key not set." };
        try {
            const providerConfig = cfg.getProviderConfig("xai");
            const baseURL = String(providerConfig.endpoint || XAI_BASE_URL);
            const client = new OpenAI({ apiKey, baseURL });
            await client.models.list();
            return { ok: true, message: "xAI API key is valid." };
        } catch (error) {
            return { ok: false, message: `xAI validation failed: ${String(error)}` };
        }
    }
}
