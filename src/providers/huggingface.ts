import OpenAI from "openai";
import axios from "axios";
import { cfg } from "../config";
import type { TaskPayload, MessageContent } from "../types";
import type { ProviderCallOptions, ProviderResult, ProviderConfig } from "./base";
import { ResilientProvider } from "./base";

const HF_CHAT_ENDPOINT = "https://router.huggingface.co/v1";
const HF_LEGACY_ENDPOINT_BASE = "https://router.huggingface.co/models";
const DEFAULT_MODEL = "microsoft/Phi-3-mini-4k-instruct";

/** Returns true if the endpoint is a Chat-compatible OpenAI-style endpoint. */
function isChatEndpoint(endpoint: string | undefined): boolean {
    if (!endpoint) return true; // default to chat API
    const lower = endpoint.toLowerCase();
    return lower.includes("/v1") || lower.includes("chat") || lower.includes("openai");
}

/** Build the OpenAI-compatible base URL from a HF endpoint. */
function normalizeChatBaseUrl(endpoint: string | undefined): string {
    if (!endpoint) return HF_CHAT_ENDPOINT;
    // Strip trailing /chat/completions or /completions if the user set the full URL
    return endpoint.replace(/\/chat\/completions\/?$/, "").replace(/\/completions\/?$/, "");
}

/** Format a MessageContent value into a form suitable for HF Chat API (OpenAI-compatible). */
function formatContentForHF(content: MessageContent): string | any[] {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content.map((part) => {
            if (typeof part === "string") return { type: "text", text: part };
            if (part.type === "text") return { type: "text", text: part.text };
            // image_url format for vision-capable models
            if (part.type === "image" && part.source?.data) {
                return {
                    type: "image_url",
                    image_url: {
                        url: `data:${part.source.media_type || "image/jpeg"};base64,${part.source.data}`,
                    },
                };
            }
            return part;
        });
    }
    return String(content);
}

/** Sleep helper for retry wait. */
function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HuggingFaceProvider extends ResilientProvider {
    constructor() {
        super({ name: "hf", timeout: 30000, maxRetries: 3 });
    }

    private buildMessages(system: string, task: TaskPayload): any[] {
        const messages: any[] = [];
        if (system) messages.push({ role: "system", content: system });

        const history = Array.isArray(task.session_history) ? task.session_history : [];
        for (const msg of history) {
            messages.push({
                role: msg.role === "assistant" ? "assistant" : "user",
                content: formatContentForHF(msg.content as MessageContent),
            });
        }

        const taskClone = { ...task } as Record<string, any>;
        delete taskClone.session_history;
        delete taskClone.image_files;
        delete taskClone.image_descriptions;
        delete taskClone.image_errors;

        const taskJson = JSON.stringify(taskClone);
        const imageFiles = Array.isArray(task.image_files) ? task.image_files : [];
        if (imageFiles.length > 0) {
            const contentParts: any[] = [
                { type: "text", text: `=== CURRENT TURN OBJECTIVE ===\n${taskJson}\n==============================` },
            ];
            for (const img of imageFiles) {
                const mime = String(img?.mime || "image/png");
                const data = String(img?.data_base64 || "");
                if (data) {
                    contentParts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${data}` } });
                }
            }
            messages.push({ role: "user", content: contentParts });
        } else {
            messages.push({
                role: "user",
                content: `=== CURRENT TURN OBJECTIVE ===\n${taskJson}\n==============================`,
            });
        }
        return messages;
    }

    protected async executeCall(system: string, task: TaskPayload, opts?: ProviderCallOptions): Promise<ProviderResult> {
        const apiKey = cfg.getApiKey("hf");
        if (!apiKey) throw new Error("Hugging Face API key not found. Use '/config hf_api_key <key>'.");

        const providerConfig = cfg.getProviderConfig("hf");
        const model = String(providerConfig.model || DEFAULT_MODEL);
        const customEndpoint = String(providerConfig.endpoint || "").trim();
        const streamEnabled =
            typeof task._stream_enabled === "boolean" ? task._stream_enabled : Boolean(providerConfig.stream ?? cfg.get("stream", true));

        // Determine API style
        if (!isChatEndpoint(customEndpoint || undefined)) {
            return this.callLegacyApi(apiKey, customEndpoint || `${HF_LEGACY_ENDPOINT_BASE}/${model}`, system, task);
        }

        const baseURL = normalizeChatBaseUrl(customEndpoint || undefined);
        const client = new OpenAI({ apiKey, baseURL, timeout: 360000 });
        const messages = this.buildMessages(system, task);

        const generation = { ...(providerConfig.generation || {}) };
        const maxTokens = Number(generation.max_tokens || generation.max_new_tokens || 2048);
        delete generation.max_tokens;
        delete generation.max_new_tokens;

        const requestParams: any = {
            model,
            messages,
            max_tokens: maxTokens,
            ...generation,
        };

        // --- Streaming path ---
        if (streamEnabled) {
            const chunks: string[] = [];
            const usage = { input_tokens: 0, output_tokens: 0 };
            let stream: any;
            try {
                stream = await client.chat.completions.create({ ...requestParams, stream: true });
            } catch (err: any) {
                throw this.formatError(err, model);
            }

            for await (const event of stream as any) {
                if (opts?.cancelSignal?.aborted) break;
                if (event?.usage) {
                    usage.input_tokens = event.usage.prompt_tokens ?? usage.input_tokens;
                    usage.output_tokens = event.usage.completion_tokens ?? usage.output_tokens;
                }
                const content = event?.choices?.[0]?.delta?.content;
                if (content) {
                    chunks.push(content);
                    if (opts?.streamCallback) opts.streamCallback(content);
                }
            }
            return { text: chunks.join(""), usage, thinking: "" };
        }

        // --- Non-streaming path ---
        let response: any;
        try {
            response = await client.chat.completions.create(requestParams);
        } catch (err: any) {
            throw this.formatError(err, model);
        }

        const message = response.choices?.[0]?.message;
        return {
            text: String(message?.content || ""),
            usage: {
                input_tokens: response.usage?.prompt_tokens || 0,
                output_tokens: response.usage?.completion_tokens || 0,
            },
            thinking: "",
        };
    }

    /**
     * Legacy text-generation API fallback (for models that do not support Chat-compatible endpoints).
     * Uses the raw Inference API with retry on 503 (model warming up).
     */
    private async callLegacyApi(
        apiKey: string,
        endpoint: string,
        system: string,
        task: TaskPayload
    ): Promise<ProviderResult> {
        const promptParts: string[] = [];
        if (system) promptParts.push(`System: ${system}`);
        const history = Array.isArray(task.session_history) ? task.session_history : [];
        for (const msg of history) {
            const role = msg.role === "assistant" ? "AI" : "User";
            promptParts.push(`${role}: ${this.flattenContent(msg.content)}`);
        }
        const taskClone = { ...task } as any;
        delete taskClone.session_history;
        promptParts.push(`User: ${JSON.stringify(taskClone)}\n\nAI:`);
        const fullPrompt = promptParts.join("\n\n");

        const payload = {
            inputs: fullPrompt,
            parameters: { return_full_text: false, max_new_tokens: 2048 },
            options: { wait_for_model: true },
        };

        // Retry up to 3 times for 503 (model cold start)
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const response = await axios.post(endpoint, payload, {
                    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
                    timeout: 360000,
                });
                const data = response.data;
                const text = Array.isArray(data) ? data[0]?.generated_text : data?.generated_text || "";
                return { text: String(text), usage: { input_tokens: 0, output_tokens: 0 }, thinking: "" };
            } catch (err: any) {
                const status = err?.response?.status;
                if (status === 503 && attempt < 2) {
                    const estimated = Number(err?.response?.data?.estimated_time || 30) * 1000;
                    const waitMs = Math.min(estimated, 60000);
                    await sleep(waitMs);
                    continue;
                }
                throw this.formatError(err, "legacy-inference");
            }
        }
        throw new Error("Hugging Face: Model failed to load after retries.");
    }

    /** Converts API errors into human-readable messages. */
    private formatError(err: any, model: string): Error {
        const status = err?.status || err?.response?.status;
        const data = err?.response?.data;
        const remoteMsg = typeof data === "string" ? data : data?.error || JSON.stringify(data);

        if (status === 401) return new Error(`Hugging Face: Unauthorized. Check your API key with '/config hf_api_key <key>'.`);
        if (status === 403) return new Error(`Hugging Face: Access denied. You may need to accept the model license for '${model}' on huggingface.co.`);
        if (status === 404) return new Error(`Hugging Face: Model '${model}' not found. Use '/model <model-id>' to set a valid model ID.`);
        if (status === 422) return new Error(`Hugging Face: Invalid request for model '${model}'. Some models may not support the Chat API.`);
        if (status === 503) return new Error(`Hugging Face: Model '${model}' is currently loading. Please try again in a moment.`);
        if (remoteMsg) return new Error(`Hugging Face API error (${status || "unknown"}): ${remoteMsg}`);
        return err;
    }

    protected async executeValidation(): Promise<{ ok: boolean; message: string }> {
        const apiKey = cfg.getApiKey("hf");
        if (!apiKey) return { ok: false, message: "Hugging Face API key not set. Use '/config hf_api_key <key>'." };
        try {
            const res = await axios.get("https://huggingface.co/api/whoami-v2", {
                headers: { Authorization: `Bearer ${apiKey}` },
                timeout: 8000,
            });
            const name = res.data?.name || res.data?.fullname || "unknown";
            return { ok: true, message: `Hugging Face API key valid. Authenticated as: ${name}.` };
        } catch (err: any) {
            const status = err?.response?.status;
            if (status === 401) return { ok: false, message: "Hugging Face: Unauthorized. API key is invalid." };
            return { ok: false, message: `Hugging Face validation failed: ${String(err?.message || err)}` };
        }
    }
}
