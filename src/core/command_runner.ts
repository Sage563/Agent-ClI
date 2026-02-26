import fs from "fs-extra";
import path from "path";
import { spawn } from "child_process";
import { appDataDir } from "../app_dirs";
import type { CommandExecutionRecord } from "../types";
import { eventBus } from "./events";

type RunCommandOptions = {
  cwd?: string;
  timeoutMs?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  logEnabled?: boolean;
};

function commandLogPath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(appDataDir(), "logs", `commands-${date}.ndjson`);
}

function appendCommandLog(record: CommandExecutionRecord) {
  const p = commandLogPath();
  fs.ensureDirSync(path.dirname(p));
  fs.appendFileSync(p, `${JSON.stringify(record)}\n`, "utf8");
}

export async function runCommand(command: string, options?: RunCommandOptions): Promise<CommandExecutionRecord> {
  const cwd = options?.cwd || process.cwd();
  const timeoutRaw = Number(options?.timeoutMs ?? 30_000);
  const timeoutUnlimited = !Number.isFinite(timeoutRaw) || timeoutRaw <= 0;
  const timeoutMs = timeoutUnlimited ? 0 : Math.max(1_000, Math.floor(timeoutRaw));
  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  eventBus.emit({
    phase: "running_command",
    status: "start",
    message: `Running command: ${command}`,
    command,
  });

  const record = await new Promise<CommandExecutionRecord>((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });

    const timer = timeoutUnlimited
      ? null
      : setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch {
          // ignore
        }
      }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      stdout += text;
      options?.onStdout?.(text);
      eventBus.emit({
        phase: "running_command",
        status: "progress",
        message: `STDOUT: ${text.slice(-240).trim()}`,
        command,
      });
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      stderr += text;
      options?.onStderr?.(text);
      eventBus.emit({
        phase: "running_command",
        status: "progress",
        message: `STDERR: ${text.slice(-240).trim()}`,
        command,
      });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const endedAt = Date.now();
      const success = !timedOut && code === 0;
      const out: CommandExecutionRecord = {
        command,
        cwd,
        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: Math.max(0, endedAt - startedAt),
        timeout_ms: timeoutMs,
        exit_code: timedOut ? null : code,
        success,
        stdout,
        stderr: timedOut ? `${stderr}\nProcess timed out after ${timeoutMs}ms.`.trim() : stderr,
      };
      resolve(out);
    });

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      const endedAt = Date.now();
      const out: CommandExecutionRecord = {
        command,
        cwd,
        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: Math.max(0, endedAt - startedAt),
        timeout_ms: timeoutMs,
        exit_code: null,
        success: false,
        stdout,
        stderr: `${stderr}\n${String(error)}`.trim(),
      };
      resolve(out);
    });
  });

  eventBus.emit({
    phase: record.success ? "finished" : "error",
    status: "end",
    message: `Command ${record.success ? "succeeded" : "failed"} (exit: ${record.exit_code})`,
    command,
    exit_code: record.exit_code,
    success: record.success,
  });

  if (options?.logEnabled !== false) {
    appendCommandLog(record);
  }
  return record;
}

export function readCommandLogs(limit = 60) {
  const p = commandLogPath();
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
  const selected = lines.slice(-Math.max(1, Math.floor(limit)));
  return selected
    .map((line) => {
      try {
        return JSON.parse(line) as CommandExecutionRecord;
      } catch {
        return null;
      }
    })
    .filter((x): x is CommandExecutionRecord => Boolean(x));
}
