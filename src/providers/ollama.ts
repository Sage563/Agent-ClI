import axios from "axios";
import { cfg } from "../config";
import type { TaskPayload } from "../types";
import type { ProviderCallOptions, ProviderResult } from "./base";
import { Provider } from "./base";

function splitThinking(fullContent: string) {
  if (fullContent.includes("<think>") && fullContent.includes("</think>")) {
    const [head, tail] = fullContent.split("</think>", 2);
    return {
      content: head.replace("<think>", "").trim() ? tail.trim() : fullContent,
      thinking: head.replace("<think>", "").trim(),
    };
  }
  return { content: fullContent, thinking: "" };
}

function normalizeEndpoint(raw: string) {
  const base = String(raw || "").trim();
  if (!base) return "http://localhost:11434";
  const withProtocol = /^https?:\/\//i.test(base) ? base : `http://${base}`;
  return withProtocol.replace(/\/+$/, "");
}

export class OllamaProvider extends Provider {
  async call(system: string, task: TaskPayload, opts?: ProviderCallOptions): Promise<ProviderResult> {
    const providerConfig = cfg.getProviderConfig("ollama");
    const endpoint = normalizeEndpoint(String(providerConfig.endpoint || "http://localhost:11434"));
    const url = `${endpoint}/api/chat`;

    const taskClone = { ...task } as Record<string, any>;
    const history = Array.isArray(taskClone.session_history) ? taskClone.session_history : [];
    const imageFiles = Array.isArray(taskClone.image_files) ? taskClone.image_files : [];
    const cachedContext = Array.isArray(taskClone._ollama_context) ? taskClone._ollama_context : [];
    const includeSystemFlag = taskClone.ollama_include_system;
    const includeHistoryFlag = taskClone.ollama_include_history;
    const includeSystem = typeof includeSystemFlag === "boolean" ? includeSystemFlag : true;
    const includeHistory = typeof includeHistoryFlag === "boolean" ? includeHistoryFlag : true;
    delete taskClone.session_history;
    delete taskClone.image_files;
    delete taskClone._ollama_context;
    delete taskClone.ollama_context_mode;
    delete taskClone.ollama_include_system;
    delete taskClone.ollama_include_history;

    const messages: any[] = [];
    if (includeSystem || !cachedContext.length) {
      messages.push({ role: "system", content: system });
    }
    if (includeHistory || !cachedContext.length) {
      for (const msg of history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    const taskJson = JSON.stringify(taskClone);
    const userMsg: Record<string, unknown> = {
      role: "user",
      content: `=== CURRENT TURN OBJECTIVE ===\n${taskJson}\n==============================`,
    };
    if (imageFiles.length) {
      userMsg.images = imageFiles.map((img: any) => String(img?.data_base64 || "")).filter(Boolean);
    }
    messages.push(userMsg);

    const generation = { ...(providerConfig.generation || {}) } as Record<string, unknown>;
    if (generation.max_tokens) {
      generation.num_predict = generation.max_tokens;
      delete generation.max_tokens;
    } else if (generation.max_output_tokens) {
      generation.num_predict = generation.max_output_tokens;
      delete generation.max_output_tokens;
    }

    const streamEnabled =
      typeof task._stream_enabled === "boolean" ? task._stream_enabled : Boolean(providerConfig.stream ?? cfg.get("stream", true));

    const payload = {
      model: String(providerConfig.model || "qwen2.5-coder:7b"),
      messages,
      stream: Boolean(streamEnabled),
      options: generation,
      context: cachedContext.length ? cachedContext : undefined,
    };

    let response: import("axios").AxiosResponse;
    try {
      response = await axios.post(url, payload, {
        headers: { "content-type": "application/json" },
        signal: opts?.cancelSignal,
        responseType: streamEnabled ? "stream" : "json",
        validateStatus: () => true,
        timeout: 360000,
      });
    } catch (e: any) {
      const errStr = String(e);
      if (errStr.includes("ECONNREFUSED") || errStr.includes("AggregateError")) {
        throw new Error(`Could not connect to Ollama at ${endpoint}. Is the Ollama app running?`);
      }
      throw new Error(`Ollama connection error: ${errStr}`);
    }

    if (response.status === 404) {
      throw new Error(`Model '${payload.model}' not found. Please run 'ollama pull ${payload.model}'.`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    let fullContent = "";
    const usage = { input_tokens: 0, output_tokens: 0 };
    let responseContext: number[] = [];
    if (streamEnabled && response.data) {
      const stream = response.data as NodeJS.ReadableStream;
      let buffered = "";
      await new Promise<void>((resolve, reject) => {
        const processLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          const parsed = JSON.parse(trimmed) as any;
          const chunk = parsed?.message?.content || "";
          if (chunk) {
            fullContent += chunk;
            if (opts?.streamCallback) opts.streamCallback(chunk);
          }
          if (parsed?.done) {
            usage.input_tokens = parsed?.prompt_eval_count || 0;
            usage.output_tokens = parsed?.eval_count || 0;
            if (Array.isArray(parsed?.context)) {
              responseContext = parsed.context
                .map((x: unknown) => Number(x))
                .filter((x: number) => Number.isFinite(x) && x >= 0)
                .map((x: number) => Math.floor(x));
            }
          }
        };

        stream.on("data", (chunk: Buffer | string) => {
          buffered += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          let idx = buffered.indexOf("\n");
          while (idx >= 0) {
            const line = buffered.slice(0, idx);
            buffered = buffered.slice(idx + 1);
            processLine(line);
            idx = buffered.indexOf("\n");
          }
        });
        stream.on("end", () => {
          if (buffered.trim()) processLine(buffered);
          resolve();
        });
        stream.on("error", reject);
      });
    } else {
      const parsed = response.data as any;
      fullContent = String(parsed?.message?.content || "");
      usage.input_tokens = parsed?.prompt_eval_count || 0;
      usage.output_tokens = parsed?.eval_count || 0;
      if (Array.isArray(parsed?.context)) {
        responseContext = parsed.context
          .map((x: unknown) => Number(x))
          .filter((x: number) => Number.isFinite(x) && x >= 0)
          .map((x: number) => Math.floor(x));
      }
    }

    const split = splitThinking(fullContent);
    return {
      text: split.content,
      usage,
      thinking: split.thinking,
      provider_state: responseContext.length ? { ollama_context: responseContext } : undefined,
    };
  }

  async validate() {
    const providerConfig = cfg.getProviderConfig("ollama");
    const endpoint = normalizeEndpoint(String(providerConfig.endpoint || "http://localhost:11434"));
    try {
      const response = await axios.get(`${endpoint}/api/tags`, {
        timeout: 5000,
        validateStatus: () => true,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return { ok: true, message: "Ollama endpoint is reachable." };
    } catch (error) {
      return { ok: false, message: `Ollama not reachable: ${String(error)}` };
    }
  }
}
