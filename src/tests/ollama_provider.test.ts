import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "stream";

vi.mock("axios", () => ({
  default: {
    post: vi.fn(),
  },
}));

import axios from "axios";
import { cfg } from "../config";
import { OllamaProvider } from "../providers/ollama";

describe("OllamaProvider", () => {
  const provider = new OllamaProvider();

  let getProviderConfigSpy: ReturnType<typeof vi.spyOn>;
  let getSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getProviderConfigSpy = vi.spyOn(cfg, "getProviderConfig").mockReturnValue({
      endpoint: "http://localhost:11434",
      model: "qwen3:14b",
      generation: { num_ctx: 131072, temperature: 0.2 },
      stream: false,
    } as Record<string, unknown>);
    getSpy = vi.spyOn(cfg, "get").mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === "stream") return false;
      return defaultValue as unknown;
    });
  });

  afterEach(() => {
    getProviderConfigSpy.mockRestore();
    getSpy.mockRestore();
  });

  it("retries once with safe payload when chat returns 500", async () => {
    const post = vi.mocked(axios.post);
    post
      .mockResolvedValueOnce({
        status: 500,
        statusText: "Internal Server Error",
        data: { error: "failed to process context" },
      } as any)
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        data: {
          message: { content: "final answer" },
          prompt_eval_count: 10,
          eval_count: 5,
        },
      } as any);

    const result = await provider.call("system", {
      session_history: [],
      image_files: [],
      _stream_enabled: false,
    } as any);

    expect(result.text).toBe("final answer");
    expect(post).toHaveBeenCalledTimes(2);
    const retryPayload = post.mock.calls[1][1] as Record<string, unknown>;
    const retryOptions = (retryPayload.options || {}) as Record<string, unknown>;
    expect(retryPayload.context).toBeUndefined();
    expect(retryOptions.num_ctx).toBeUndefined();
    expect(retryOptions.num_predict).toBeUndefined();
    expect(retryPayload.think).toBe(false);
  });

  it("passes think=true when think_mode is enabled", async () => {
    getSpy.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === "stream") return false;
      if (key === "think_mode") return true;
      return defaultValue as unknown;
    });

    const post = vi.mocked(axios.post);
    post.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      data: {
        message: { content: "done", thinking: "step-by-step" },
        prompt_eval_count: 1,
        eval_count: 1,
      },
    } as any);

    const result = await provider.call("system", {
      session_history: [],
      image_files: [],
      _stream_enabled: false,
    } as any);

    const payload = post.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.think).toBe(true);
    expect(result.thinking).toContain("step-by-step");
  });

  it("maps Ollama `thought` field into thinking output", async () => {
    getSpy.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === "stream") return false;
      if (key === "think_mode") return true;
      return defaultValue as unknown;
    });

    const post = vi.mocked(axios.post);
    post.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      data: {
        message: { content: "done", thought: "internal chain" },
        prompt_eval_count: 1,
        eval_count: 1,
      },
    } as any);

    const result = await provider.call("system", {
      session_history: [],
      image_files: [],
      _stream_enabled: false,
    } as any);

    expect(result.thinking).toContain("internal chain");
  });

  it("streams thinking from Ollama chunks even when think_mode is off", async () => {
    getProviderConfigSpy.mockReturnValue({
      endpoint: "http://localhost:11434",
      model: "qwen3:14b",
      generation: { temperature: 0.2 },
      stream: true,
    } as Record<string, unknown>);
    getSpy.mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === "stream") return true;
      if (key === "think_mode") return false;
      return defaultValue as unknown;
    });

    const stream = Readable.from([
      `${JSON.stringify({ message: { thinking: "first thought chunk" }, created_at: "2026-03-05T01:23:45Z", done: false })}\n`,
      `${JSON.stringify({ context: [1, 2, 3], done: true, total_duration: 1234 })}\n`,
    ]);

    const post = vi.mocked(axios.post);
    post.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      data: stream,
    } as any);

    const chunks: string[] = [];
    const onStreamActivity = vi.fn();
    const result = await provider.call("system", {
      session_history: [],
      image_files: [],
      _stream_enabled: true,
    } as any, {
      streamCallback: (chunk) => chunks.push(chunk),
      onStreamActivity,
    });

    expect(result.thinking).toContain("first thought chunk");
    expect(result.text).toBe("");
    expect(chunks.join("")).toContain("<think>");
    expect(chunks.join("")).toContain("first thought chunk");
    expect(chunks.join("")).toContain("</think>");
    expect(onStreamActivity).toHaveBeenCalled();
    expect((result.provider_state as any)?.ollama_context).toEqual([1, 2, 3]);
  });
});
