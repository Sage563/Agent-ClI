import { describe, expect, it, vi } from "vitest";
import { executeWithTimeout } from "../providers/base";
import { Config } from "../config";

describe("Streaming Config and Resilience Utilities", () => {
  it("ensureDefaults sets correct streaming defaults when missing from disk", () => {
    // We create a new Config instance. It will load from disk,
    // but we can manually clear the config and re-run ensureDefaults
    // to verify what happens when the keys are missing.
    const c = new Config();
    c.config = {} as any; 
    c.config.providers = {};
    
    // @ts-ignore - accessing private/internal method for testing
    c.ensureDefaults();
    
    expect(c.config.stream_retry_count).toBe(0);
    expect(c.config.disable_timeout_retry).toBe(true);
    expect(c.config.stream_timeout_ms).toBe(false);
  });

  it("executeWithTimeout handles timeoutMs <= 0 as unlimited", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await executeWithTimeout(fn, 0);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalled();
  });

  it("executeWithTimeout handles negative timeoutMs as unlimited", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await executeWithTimeout(fn, -1);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalled();
  });
});
