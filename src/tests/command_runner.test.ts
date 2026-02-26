import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { resetBaseDir, setBaseDir } from "../app_dirs";
import { runCommand } from "../core/command_runner";

const tempRoot = path.join(os.tmpdir(), `agent-cli-tests-${Date.now()}`);

afterEach(() => {
  resetBaseDir();
  try {
    fs.removeSync(tempRoot);
  } catch {
    // ignore cleanup failures
  }
});

describe("command runner", () => {
  it("captures stdout/stderr/exit code and writes logs", async () => {
    setBaseDir(tempRoot);
    const result = await runCommand('node -e "process.stdout.write(\'ok\')"', {
      timeoutMs: 15_000,
      logEnabled: true,
    });
    expect(result.success).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(result.stdout.includes("ok")).toBe(true);

    const logsDir = path.join(tempRoot, "logs");
    expect(fs.existsSync(logsDir)).toBe(true);
    const files = fs.readdirSync(logsDir);
    expect(files.some((f) => f.endsWith(".ndjson"))).toBe(true);
  });

  it("reports non-zero exit codes", async () => {
    setBaseDir(tempRoot);
    const result = await runCommand('node -e "process.exit(3)"', {
      timeoutMs: 15_000,
      logEnabled: false,
    });
    expect(result.success).toBe(false);
    expect(result.exit_code).not.toBe(0);
  });

  it("supports unlimited timeout when timeout is 0", async () => {
    setBaseDir(tempRoot);
    const result = await runCommand('node -e "setTimeout(()=>process.exit(0), 1200)"', {
      timeoutMs: 0,
      logEnabled: false,
    });
    expect(result.success).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(result.timeout_ms).toBe(0);
  });
});
