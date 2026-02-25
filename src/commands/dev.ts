import { spawn } from "child_process";
import { registry } from "./registry";
import { printError, printPanel } from "../ui/console";

export const DEBUG_HISTORY: Array<Record<string, unknown>> = [];

const PROMPT_FILE_RE = /(?:^|[\\/])agent\.prompt\.txt\b/i;

function redactSensitiveText(value: string) {
  if (typeof value !== "string") return value;
  return value.replace(PROMPT_FILE_RE, "[redacted:agent.prompt.txt]");
}

function redactSensitiveObj(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map((x) => redactSensitiveObj(x));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    Object.entries(obj as Record<string, unknown>).forEach(([k, v]) => {
      out[redactSensitiveText(String(k))] = redactSensitiveObj(v);
    });
    return out;
  }
  if (typeof obj === "string") return redactSensitiveText(obj);
  return obj;
}

function summarizeMissionData(data: unknown) {
  if (!data || typeof data !== "object") return data;
  const out: Record<string, unknown> = {};
  Object.entries(data as Record<string, unknown>).forEach(([k, v]) => {
    if (["files", "web_results", "project_search", "detailed_map", "symbol_definitions", "terminal_results"].includes(k)) {
      if (typeof v === "string") out[k] = `[${v.length} chars]`;
      else if (Array.isArray(v)) out[k] = `[list:${v.length}]`;
      else if (v && typeof v === "object") out[k] = `[object:${Object.keys(v as object).length} keys]`;
      else out[k] = `[${typeof v}]`;
    } else {
      out[k] = v;
    }
  });
  return redactSensitiveObj(out);
}

registry.register("/code", "Open VS Code")(() => {
  try {
    spawn("code", [process.cwd()], { cwd: process.cwd(), detached: true, stdio: "ignore" }).unref();
  } catch {
    printError("VS Code command 'code' not found in PATH.");
  }
  return true;
});

registry.register("/debug", "Show raw JSON exchange for the last interaction")(() => {
  if (!DEBUG_HISTORY.length) {
    printError("No debug history available.");
    return true;
  }
  const last = DEBUG_HISTORY[DEBUG_HISTORY.length - 1] as Record<string, unknown>;
  const task = last.task as Record<string, unknown> | undefined;

  if (task) {
    // We show the task (request) but the getDynamicPrompt result (the long prompt) is NOT in this object.
    // It's in agent.ts as a separate variable during handle().
    const requestJson = redactSensitiveObj(task);
    printPanel(JSON.stringify(requestJson, null, 2), "AI REQUEST (JSON)", "cyan");
  }

  const response = last.response;
  if (response) {
    try {
      const parsedRes = typeof response === "string" ? JSON.parse(response) : response;
      printPanel(JSON.stringify(redactSensitiveObj(parsedRes), null, 2), "AI RESPONSE (JSON)", "green");
    } catch {
      printPanel(String(response), "AI RESPONSE (RAW)", "green");
    }
  }

  return true;
});
