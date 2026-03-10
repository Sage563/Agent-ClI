import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callWithStreamRecovery } from "../core/streaming";

describe("callWithStreamRecovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back when there is no stream activity", async () => {
    const run = vi.fn(async (streamEnabled: boolean) => {
      if (!streamEnabled) return "fallback-ok";
      await new Promise(() => { /* never resolves */ });
      return "unreachable";
    });

    const pending = callWithStreamRecovery({
      streamRetryCount: 0,
      streamTimeoutMs: 100,
      run,
    });

    await vi.advanceTimersByTimeAsync(2500);
    const out = await pending;
    expect(out.result).toBe("fallback-ok");
    expect(out.health.fallback_used).toBe(true);
  });

  it("does not timeout while stream activity keeps arriving", async () => {
    const run = vi.fn(async (streamEnabled: boolean, markActivity?: () => void) => {
      if (!streamEnabled) return "fallback-unused";
      const heartbeat = setInterval(() => markActivity?.(), 40);
      const result = await new Promise<string>((resolve) => {
        setTimeout(() => resolve("stream-ok"), 260);
      });
      clearInterval(heartbeat);
      return result;
    });

    const pending = callWithStreamRecovery({
      streamRetryCount: 0,
      streamTimeoutMs: 100,
      run,
    });

    await vi.advanceTimersByTimeAsync(500);
    const out = await pending;
    expect(out.result).toBe("stream-ok");
    expect(out.health.fallback_used).toBe(false);
  });

  it("disables stream timeout when streamTimeoutMs is 0", async () => {
    const run = vi.fn(async (streamEnabled: boolean) => {
      if (!streamEnabled) return "fallback-unused";
      return await new Promise<string>((resolve) => {
        setTimeout(() => resolve("stream-ok-unlimited"), 2000);
      });
    });

    const pending = callWithStreamRecovery({
      streamRetryCount: 0,
      streamTimeoutMs: 0,
      run,
    });

    await vi.advanceTimersByTimeAsync(2500);
    const out = await pending;
    expect(out.result).toBe("stream-ok-unlimited");
    expect(out.health.fallback_used).toBe(false);
    expect(out.health.timeout_ms).toBe(0);
  });
});
