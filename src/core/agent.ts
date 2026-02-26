import chalk from "chalk";
import logUpdate from "log-update";
import fs from "fs-extra";
import path from "path";
import { createHash } from "crypto";
import { cfg } from "../config";
import { build } from "../task_builder";
import { apply } from "../applier";
import {
  add,
  compactSession,
  estimateTokens,
  getOllamaPromptFingerprint,
  getOllamaSessionContext,
  invalidateOllamaContext,
  load,
  setOllamaPromptFingerprint,
  setOllamaSessionContext,
} from "../memory";
import { calculateCost } from "../cost";
import { parseJsonBestEffort, sanitizeAiEditedContent, speakText } from "./utils";
import { webBrowse, webSearch, searchProject, indexProject, lintProject } from "./tools";
import { isFullAccess } from "./permissions";
import { intel } from "./intelligence";
import { manager as procManager } from "./process";
import type { ExecutionEvent, MissionData, SessionStats, TaskChange, TaskCommand, TaskPayload } from "../types";
import { getProvider } from "../providers/manager";
import { registry } from "../commands/registry";
import { displayThinking, showDiff } from "../ui/agent_ui";
import { renderWorkspaceLayout } from "../ui/layout";
import {
  MissionBoard,
  THEME,
  console,
  isPromptInputActive,
  printActivity,
  printError,
  printInfo,
  printPanel,
  renderPanel,
  printSuccess,
  printWarning,
} from "../ui/console";
import { DEBUG_HISTORY } from "../commands/dev";
import { getRuntimePrompt } from "../runtime_assets";
import { showSessionGui } from "../ui/session_gui";
import { appDataDir } from "../app_dirs";
import { eventBus } from "./events";
import { runCommand } from "./command_runner";
import { ensureSessionAccessForPaths, ensureSessionAccessMode, getSessionAccessGrant } from "./session_access";
import { callWithStreamRecovery, createRenderThrottler, StreamingJsonObserver as CoreStreamingJsonObserver } from "./streaming";
import { recordDiffBatch } from "./diff_tracker";

import "../commands/core";
import "../commands/config";
import "../commands/session";
import "../commands/dev";
import "../commands/mission_mgmt";
import "../commands/mcp";
import "../commands/init";
import "../commands/git_commands";
import "../commands/chat";
import "../commands/status";
import "../commands/uninstall";
import "../commands/access";
import "../commands/diffs";

export const SESSION_STATS: SessionStats = {
  input_tokens: 0,
  output_tokens: 0,
  total_cost: 0,
  turns: 0,
  model: "unknown",
  start_time: Date.now() / 1000,
};

let MISSION_BOARD: MissionBoard | null = null;
const LAST_EDITED_FILES: string[] = [];
const MISSION_IDLE_LIMIT = 3;
const MISSION_MAX_STEPS = 5000;
const MAX_CONSECUTIVE_LINT_CYCLES = 2;
let LAST_TERMINAL_OUTPUT = "";

function redactPromptLeak(text: string) {
  const value = String(text || "");
  if (!value.trim()) return value;
  const markers = [
    "### PROJECT INSTRUCTIONS (from AGENTS.md)",
    "=== CURRENT TURN OBJECTIVE ===",
    "[USER OS]",
    "[USER ENVIRONMENT]",
    "Return strict JSON only",
  ];
  const hitCount = markers.reduce((acc, marker) => acc + (value.includes(marker) ? 1 : 0), 0);
  if (hitCount >= 2 || value.includes("### PROJECT INSTRUCTIONS (from AGENTS.md)")) {
    return "I can’t share internal instructions or hidden prompts. I can continue the task directly.";
  }
  return value;
}

function extractJsonStringAt(buffer: string, start: number) {
  const isLikelyTerminator = (idx: number) => {
    for (let j = idx + 1; j < buffer.length; j += 1) {
      const next = buffer[j];
      if (next === " " || next === "\n" || next === "\r" || next === "\t") continue;
      return next === "," || next === "}" || next === "]";
    }
    // If stream chunk ended right after a quote, treat it as complete for now.
    return true;
  };

  let raw = "";
  let escaped = false;
  for (let i = start; i < buffer.length; i += 1) {
    const ch = buffer[i];
    if (escaped) {
      raw += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      raw += ch;
      escaped = true;
      continue;
    }
    if (ch === '"' && isLikelyTerminator(i)) {
      return { raw, complete: true };
    }
    raw += ch;
  }
  return { raw, complete: false };
}

function decodeJsonStringFragment(raw: string, complete: boolean) {
  let safe = raw;
  if (!complete) {
    safe = safe.replace(/\\u[0-9a-fA-F]{0,3}$/, "");
    safe = safe.replace(/\\$/, "");
  }
  try {
    return JSON.parse(`"${safe}"`) as string;
  } catch {
    return safe
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }
}

const STREAM_STRING_FIELDS = ["response", "thought", "plan", "self_critique", "ask_user"] as const;
type StreamStringField = (typeof STREAM_STRING_FIELDS)[number];
const STREAM_TOOL_KEYS = [
  "changes",
  "commands",
  "request_files",
  "web_search",
  "web_browse",
  "search_project",
  "detailed_map",
  "find_symbol",
  "terminal_spawn",
  "terminal_input",
  "terminal_read",
  "terminal_kill",
  "index_project",
  "lint_project",
];

export class StreamingJsonObserver {
  private buffer = "";
  private fieldStarts: Record<StreamStringField, number | null> = {
    response: null,
    thought: null,
    plan: null,
    self_critique: null,
    ask_user: null,
  };
  private emitted: Record<StreamStringField, string> = {
    response: "",
    thought: "",
    plan: "",
    self_critique: "",
    ask_user: "",
  };
  private completed: Record<StreamStringField, boolean> = {
    response: false,
    thought: false,
    plan: false,
    self_critique: false,
    ask_user: false,
  };
  private seenFiles = new Set<string>();
  private seenSchemaKeys = new Set<string>();
  private seenToolKeys = new Set<string>();

  private findFieldStart(field: StreamStringField) {
    if (this.fieldStarts[field] !== null || this.completed[field]) return;
    const re = new RegExp(`"${field}"\\s*:\\s*"`, "g");
    const match = re.exec(this.buffer);
    if (match) {
      this.fieldStarts[field] = match.index + match[0].length;
    }
  }

  private updateField(field: StreamStringField) {
    this.findFieldStart(field);
    const start = this.fieldStarts[field];
    if (start === null) return "";
    const parsed = extractJsonStringAt(this.buffer, start);
    const decoded = decodeJsonStringFragment(parsed.raw, parsed.complete);
    const previous = this.emitted[field];
    const delta = decoded.startsWith(previous) ? decoded.slice(previous.length) : decoded;
    this.emitted[field] = decoded;
    if (parsed.complete) this.completed[field] = true;
    return delta;
  }

  private discoverSchemaKeys() {
    const newKeys: string[] = [];
    let inString = false;
    let escaped = false;
    let objectDepth = 0;
    let arrayDepth = 0;

    for (let i = 0; i < this.buffer.length; i += 1) {
      const ch = this.buffer[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }

      if (ch === "{") {
        objectDepth += 1;
        continue;
      }
      if (ch === "}") {
        objectDepth = Math.max(0, objectDepth - 1);
        continue;
      }
      if (ch === "[") {
        arrayDepth += 1;
        continue;
      }
      if (ch === "]") {
        arrayDepth = Math.max(0, arrayDepth - 1);
        continue;
      }

      if (ch !== '"') continue;
      inString = true;

      // Only capture top-level object keys (ignore nested keys like changes[].original/edited).
      if (objectDepth !== 1 || arrayDepth !== 0) continue;

      const parsed = extractJsonStringAt(this.buffer, i + 1);
      if (!parsed.complete) continue;
      const key = decodeJsonStringFragment(parsed.raw, true).trim();
      // Move i to closing quote position.
      i += parsed.raw.length + 1;
      inString = false;

      let j = i + 1;
      while (j < this.buffer.length && /\s/.test(this.buffer[j])) j += 1;
      if (this.buffer[j] !== ":") continue;
      if (!key || this.seenSchemaKeys.has(key)) continue;
      this.seenSchemaKeys.add(key);
      newKeys.push(key);
    }
    return newKeys;
  }

  private discoverToolSignals() {
    const signals: string[] = [];
    for (const key of STREAM_TOOL_KEYS) {
      if (this.seenToolKeys.has(key)) continue;
      if (new RegExp(`"${key}"\\s*:`).test(this.buffer)) {
        this.seenToolKeys.add(key);
        signals.push(key);
      }
    }
    return signals;
  }

  private discoverFileEdits() {
    const fileEdits: string[] = [];
    const fileRegex = /"file"\s*:\s*"/g;
    let match: RegExpExecArray | null = null;
    while ((match = fileRegex.exec(this.buffer))) {
      const start = match.index + match[0].length;
      const parsed = extractJsonStringAt(this.buffer, start);
      if (!parsed.complete) continue;
      const filePath = decodeJsonStringFragment(parsed.raw, true).trim();
      if (filePath && !this.seenFiles.has(filePath)) {
        this.seenFiles.add(filePath);
        fileEdits.push(filePath);
      }
    }
    return fileEdits;
  }

  snapshot() {
    return {
      response: this.emitted.response,
      thought: this.emitted.thought,
      plan: this.emitted.plan,
      self_critique: this.emitted.self_critique,
      ask_user: this.emitted.ask_user,
      rawTail: this.buffer.slice(-3000),
      seenSchemaKeys: [...this.seenSchemaKeys],
      seenToolKeys: [...this.seenToolKeys],
    };
  }

  ingest(chunk: string) {
    this.buffer += chunk;
    const deltas: Record<StreamStringField, string> = {
      response: this.updateField("response"),
      thought: this.updateField("thought"),
      plan: this.updateField("plan"),
      self_critique: this.updateField("self_critique"),
      ask_user: this.updateField("ask_user"),
    };

    return {
      deltas,
      fileEdits: this.discoverFileEdits(),
      newSchemaKeys: this.discoverSchemaKeys(),
      toolSignals: this.discoverToolSignals(),
    };
  }
}

function parseLooseKvResponse(text: string) {
  const validKeys = new Set([
    "thought",
    "response",
    "message",
    "reply",
    "answer",
    "output",
    "result",
    "assistant_response",
    "final_response",
    "plan",
    "ask_user",
    "self_critique",
    "search_project",
    "web_search",
    "web_browse",
    "detailed_map",
    "find_symbol",
    "terminal_spawn",
    "terminal_input",
    "terminal_read",
    "terminal_kill",
  ]);
  const out: Record<string, any> = {};
  let currentKey = "";
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentKey) return;
    let raw = currentLines.join("\n").trim().replace(/,$/, "");
    if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
    raw = raw.replace(/\\"/g, '"').replace(/\\n/g, "\n");
    const canonicalKey =
      currentKey === "message" ||
        currentKey === "reply" ||
        currentKey === "answer" ||
        currentKey === "output" ||
        currentKey === "result" ||
        currentKey === "assistant_response" ||
        currentKey === "final_response"
        ? "response"
        : currentKey;
    out[canonicalKey] = raw;
    currentKey = "";
    currentLines = [];
  };

  for (const line of (text || "").split(/\r?\n/)) {
    const m = line.match(/^\s*"?(?<key>[a-zA-Z_][a-zA-Z0-9_]*)"?\s*:\s*(?<value>.*)$/);
    const key = m?.groups?.key || "";
    const value = m?.groups?.value || "";
    if (key && validKeys.has(key)) {
      flush();
      currentKey = key;
      currentLines = [value.trim()];
    } else if (currentKey) {
      currentLines.push(line);
    }
  }
  flush();
  return Object.keys(out).length ? out : null;
}

function parseActionEnvelopeText(text: string): Record<string, any> | null {
  const raw = String(text || "");
  if (!raw.trim()) return null;
  const actionMatch = raw.match(/"?(action|tool|type)"?\s*:\s*["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?/i);
  if (!actionMatch) return null;

  const action = String(actionMatch[2] || "").trim();
  if (!action) return null;

  const parameters: Record<string, any> = {};
  const quotedField = (name: string) => {
    const m = raw.match(new RegExp(`"?${name}"?\\s*:\\s*"(.*?)"`, "is"));
    if (m?.[1]) return m[1].replace(/\\"/g, '"');
    const m2 = raw.match(new RegExp(`"?${name}"?\\s*:\\s*'(.*?)'`, "is"));
    return m2?.[1] || "";
  };

  const query = quotedField("query") || quotedField("q") || quotedField("search_query") || quotedField("search");
  if (query) parameters.query = query;

  const url = quotedField("url");
  if (url) parameters.url = url;

  const filePath = quotedField("file") || quotedField("path") || quotedField("file_path");
  if (filePath) parameters.file = filePath;

  const command = quotedField("command") || quotedField("cmd");
  if (command) parameters.command = command;
  const pattern = quotedField("pattern");
  if (pattern) parameters.pattern = pattern;
  const symbol = quotedField("symbol") || quotedField("name");
  if (symbol) parameters.symbol = symbol;

  const quotedArrayField = (name: string) => {
    const m = raw.match(new RegExp(`"?${name}"?\\s*:\\s*\\[(.*?)\\]`, "is"));
    if (!m?.[1]) return [] as string[];
    const items = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => String(x[1] || "").trim()).filter(Boolean);
    return items;
  };
  const files = quotedArrayField("file_paths");
  if (files.length) parameters.file_paths = files;
  const commands = quotedArrayField("commands");
  if (commands.length) parameters.commands = commands;

  const regexMatch = raw.match(/"?(regex|use_regex)"?\s*:\s*(true|false)/i);
  if (regexMatch) parameters.regex = String(regexMatch[2]).toLowerCase() === "true";

  return { action, parameters };
}

function extractCanonicalResponse(data: Record<string, any> | null | undefined) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.response === "string" && data.response.trim()) return String(data.response);
  if (typeof data.message === "string" && data.message.trim()) return String(data.message);
  if (data.message && typeof data.message === "object") {
    const msg = data.message as Record<string, unknown>;
    const fromMessage = String(msg.content || msg.text || "").trim();
    if (fromMessage) return fromMessage;
  }
  for (const key of [
    "reply",
    "answer",
    "output",
    "result",
    "assistant_response",
    "final_response",
    "finalAnswer",
    "content",
    "text",
    "final",
  ]) {
    const val = (data as Record<string, unknown>)[key];
    if (typeof val === "string" && val.trim()) return val;
  }
  return "";
}

function extractCanonicalThought(data: Record<string, any> | null | undefined) {
  if (!data || typeof data !== "object") return "";
  for (const key of ["thought", "reasoning", "analysis", "thinking"]) {
    const val = (data as Record<string, unknown>)[key];
    if (typeof val === "string" && val.trim()) return val;
  }
  return "";
}

function normalizeDisplayNewlines(value: string) {
  return (value || "").replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");
}

function stripResponseWrapperText(value: string) {
  let out = normalizeDisplayNewlines(String(value || ""));
  if (!out.trim()) return "";
  out = out.trim();

  // Handles wrappers such as: {"response":"..."} or response: "..."
  const parsed = parseJsonBestEffort(out) as Record<string, unknown> | null;
  if (parsed && typeof parsed.response === "string" && String(parsed.response).trim()) {
    return normalizeDisplayNewlines(String(parsed.response)).trim();
  }

  out = out.replace(/^\s*\{\s*"?response"?\s*:\s*/i, "");
  out = out.replace(/^\s*"?response"?\s*:\s*/i, "");
  out = out.replace(/\s*\}\s*$/, "");
  out = out.replace(/^\s*"/, "").replace(/"\s*,?\s*$/, "");
  return out.trim();
}

function sanitizeStreamFieldPreview(field: "response" | "thought" | "plan" | "ask_user", value: string) {
  const raw = normalizeDisplayNewlines(String(value || ""));
  if (!raw.trim()) return "";

  const parsed = parseJsonBestEffort(raw) as Record<string, unknown> | null;
  const parsedField = parsed && typeof parsed[field] === "string" ? String(parsed[field] || "") : "";
  if (parsedField.trim()) return normalizeDisplayNewlines(parsedField);

  let out = raw;
  const prefix = new RegExp(`^\\s*\\{?\\s*"?${field}"?\\s*:\\s*`, "i");
  if (prefix.test(out)) out = out.replace(prefix, "");
  out = out.replace(/^\s*"/, "");
  out = out.replace(/"\s*[,}]?\s*$/, "");

  if (field === "response") {
    // Trim accidental schema spillover when partial JSON tails leak into response preview.
    const sameLineLeak = out.search(/",\s*"[a-zA-Z_][a-zA-Z0-9_]*"\s*:/);
    if (sameLineLeak > 0) {
      out = out.slice(0, sameLineLeak);
    }
    const nextLineLeak = out.search(/\n\s*"[a-zA-Z_][a-zA-Z0-9_]*"\s*:/);
    if (nextLineLeak > 0) {
      out = out.slice(0, nextLineLeak);
    }
    out = out.replace(/",?\s*$/, "");
  }

  return out;
}

function formatExecutionActivity(event: ExecutionEvent) {
  const rel = event.file_path
    ? path.relative(process.cwd(), String(event.file_path)).replace(/\\/g, "/")
    : "";

  if (event.phase === "writing_file") {
    if (event.status === "start") return rel ? `Writing file: ${rel}` : event.message;
    if (event.status === "end") return rel ? `Wrote file: ${rel}` : event.message;
  }
  if (event.phase === "running_command") {
    const cmd = String(event.command || "").trim();
    if (event.status === "start") return cmd ? `Running command: ${cmd}` : event.message;
    if (event.status === "end") {
      if (typeof event.exit_code === "number") {
        return `${cmd || "Command"} exited ${event.exit_code}`;
      }
      return cmd ? `Finished command: ${cmd}` : event.message;
    }
  }
  if (event.phase === "reading_file" && event.status === "start") return event.message;
  if (event.phase === "searching_web" && event.status === "start") return event.message;
  if (event.phase === "error") return `Error: ${event.message}`;
  return String(event.message || "").trim();
}

function extractClaimedFilePaths(responseMsg: string) {
  if (!responseMsg) return [];
  const low = responseMsg.toLowerCase();
  const markers = ["created", "generated", "saved", "wrote", "written", "report in", "find the report in"];
  if (!markers.some((marker) => low.includes(marker))) return [];

  const out: string[] = [];
  for (const match of responseMsg.matchAll(/`([^`]+?\.[A-Za-z0-9]{1,10})`/g)) {
    const p = (match[1] || "").trim().replace(/[.,;:!?]+$/, "");
    if (p && !/^https?:\/\//i.test(p)) out.push(p);
  }
  if (!out.length) {
    for (const match of responseMsg.matchAll(/(?<![\w:])([A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_. -]+)+\.[A-Za-z0-9]{1,10})/g)) {
      const p = (match[1] || "").trim().replace(/[.,;:!?]+$/, "");
      if (p && !/^https?:\/\//i.test(p)) out.push(p);
    }
  }

  return [...new Set(out.map((x) => x.replace(/\\/g, "/")))];
}

function extractFirstFencedBlock(text: string) {
  const m = (text || "").match(/```[A-Za-z0-9_+\-]*\n([\s\S]*?)```/);
  return m?.[1]?.trim() || "";
}

function normalizePathKey(filePath: string) {
  return String(filePath || "").trim().replace(/\\/g, "/").toLowerCase();
}

function extractNearestPathHint(contextBeforeFence: string) {
  const windowText = String(contextBeforeFence || "").split(/\r?\n/).slice(-6).join("\n");
  const backtick = [...windowText.matchAll(/`([^`]+?\.[A-Za-z0-9]{1,10})`/g)]
    .map((m) => String(m[1] || "").trim())
    .filter(Boolean);
  if (backtick.length) return backtick[backtick.length - 1];

  const pathMatches = [...windowText.matchAll(/([A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_. -]+)+\.[A-Za-z0-9]{1,10})/g)]
    .map((m) => String(m[1] || "").trim())
    .filter(Boolean);
  if (pathMatches.length) return pathMatches[pathMatches.length - 1];
  return "";
}

function extractFencedEditsByPath(claimSource: string, claimedPaths: string[]) {
  const out = new Map<string, string>();
  const text = String(claimSource || "");
  const claimedSet = new Set(claimedPaths.map((p) => normalizePathKey(p)));
  const fenceRe = /```[A-Za-z0-9_+\-]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null = null;
  while ((match = fenceRe.exec(text))) {
    const block = String(match[1] || "").trim();
    if (!block) continue;
    const before = text.slice(Math.max(0, match.index - 320), match.index);
    const hintedPath = extractNearestPathHint(before);
    if (!hintedPath) continue;
    const key = normalizePathKey(hintedPath);
    if (claimedSet.has(key) && !out.has(key)) out.set(key, block);
  }
  return out;
}

function countDiffLines(oldText: string, newText: string) {
  if (oldText === newText) return { added: 0, removed: 0 };
  const oldLines = (oldText || "").split(/\r?\n/);
  const newLines = (newText || "").split(/\r?\n/);
  let added = 0;
  let removed = 0;
  const oldCounts = new Map<string, number>();
  const newCounts = new Map<string, number>();
  for (const line of oldLines) oldCounts.set(line, (oldCounts.get(line) || 0) + 1);
  for (const line of newLines) newCounts.set(line, (newCounts.get(line) || 0) + 1);
  for (const [line, count] of newCounts.entries()) {
    const prev = oldCounts.get(line) || 0;
    if (count > prev) added += count - prev;
  }
  for (const [line, count] of oldCounts.entries()) {
    const next = newCounts.get(line) || 0;
    if (count > next) removed += count - next;
  }
  return { added, removed };
}

type HandleArgs = {
  yes?: boolean;
  fast?: boolean;
  plan?: boolean;
  __autoPlanDone?: boolean;
  __planningPass?: boolean;
  __planningPassStep?: boolean;
  __executionFromPlan?: boolean;
  __planFilePath?: string | null;
  __strictChangeRetryUsed?: boolean;
  __codeFirstRetryUsed?: boolean;
  __lintFollowupDepth?: number;
  __lastLintDigest?: string;
  __lintAppliedCount?: number;
  __lintRecoveryUsed?: boolean;
};

function buildPlanMarkdown(userInput: string, planBody: string, thoughtBody: string) {
  const now = new Date();
  const stamp = now.toISOString();
  const lines: string[] = [];
  lines.push(`# Agent Plan`);
  lines.push("");
  lines.push(`Generated: ${stamp}`);
  lines.push("");
  lines.push("## Request");
  lines.push(userInput || "(empty)");
  lines.push("");
  lines.push("## Plan");
  lines.push(planBody || "No plan provided by model.");
  if (thoughtBody && thoughtBody.trim()) {
    lines.push("");
    lines.push("## Reasoning Notes");
    lines.push(thoughtBody.trim());
  }
  lines.push("");
  lines.push("## Execution Policy");
  lines.push("- This plan file was generated before execution.");
  lines.push("- The next pass executes based on this plan exactly once.");
  lines.push("");
  return lines.join("\n");
}

function hashText(value: string) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function estimateContextWindow(provider: string, model: string) {
  if (provider === "ollama") {
    const generation = (cfg.getProviderConfig("ollama").generation || {}) as Record<string, unknown>;
    return Number(generation.num_ctx || 32768);
  }
  const known: Record<string, number> = {
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "gpt-4-turbo": 128000,
    o1: 200000,
    "o1-mini": 128000,
    "o3-mini": 200000,
    "claude-sonnet-4-20250514": 200000,
    "claude-3-5-sonnet-20241022": 200000,
    "claude-3-5-haiku-20241022": 200000,
    "claude-3-opus-20240229": 200000,
    "gemini-2.5-pro-preview-06-05": 1048576,
    "gemini-2.5-flash-preview-05-20": 1048576,
    "gemini-2.0-flash": 1048576,
    "deepseek-chat": 64000,
    "deepseek-reasoner": 64000,
  };
  return Number(known[model] || 0);
}

function writePlanArtifact(userInput: string, planBody: string, thoughtBody: string) {
  const dir = path.join(appDataDir(), "plans");
  fs.ensureDirSync(dir);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(dir, `plan-${ts}.md`);
  fs.writeFileSync(filePath, buildPlanMarkdown(userInput, planBody, thoughtBody), "utf8");
  return filePath;
}

import { getMcpSystemPrompt } from "../mcp_client";

async function getDynamicPrompt(text: string) {
  let currentOs = process.platform;
  let currentEnv = `${process.platform} ${process.version}`;
  const low = text.toLowerCase();
  if (low.includes("for linux") || low.includes("on linux")) {
    currentOs = "linux";
    currentEnv = "Linux (User Override)";
  } else if (low.includes("for mac") || low.includes("on mac") || low.includes("for osx")) {
    currentOs = "darwin";
    currentEnv = "macOS (User Override)";
  } else if (low.includes("for windows") || low.includes("on windows")) {
    currentOs = "win32";
    currentEnv = "Windows (User Override)";
  }

  let prompt = getRuntimePrompt()
    .replace("[USER OS]", currentOs)
    .replace("[USER ENVIRONMENT]", currentEnv)
    .replace("[USER CWD]", process.cwd());

  const agentsPath = path.resolve(process.cwd(), "AGENTS.md");
  if (fs.existsSync(agentsPath)) {
    try {
      prompt += `\n\n### PROJECT INSTRUCTIONS (from AGENTS.md)\n${fs.readFileSync(agentsPath, "utf8")}\n`;
    } catch {
      // ignore
    }
  }

  if (cfg.get("think_mode", false)) {
    prompt +=
      "\n\n[Think Mode Enabled]\nWhen appropriate, reason deeply and explicitly. Return strict JSON only.";
  }
  const mcpPrompt = await getMcpSystemPrompt();
  if (mcpPrompt) {
    prompt += `\n\n${mcpPrompt}\n`;
  }

  const mcpSchema = cfg.isMcpEnabled() ? ',"mcp_call":{"server":"string","tool":"string","args":{}}' : '';

  prompt +=
    "\n\n[CODE-FIRST EXECUTION POLICY]\n" +
    "Default to concrete action over explanation. You are a highly autonomous agent.\n" +
    "- If a task requires searching, use `web_search` or `search_project` until you have enough info.\n" +
    "- For implementation/fix/refactor tasks, return actionable `changes[]` and/or `commands[]`.\n" +
    "- You can include multiple `changes[]` in a single response to fix multiple issues or files.\n" +
    "- In `changes[]`, the `edited` content is applied to ALL occurrences of `original` in the file. Choose unique snippets if you only want to change one spot.\n" +
    "- Support for `\\n` as a newline is enabled. Use it to structure your text, but prioritize valid JSON escaping.\n" +
    "- Do not return prose-only implementation plans in apply mode.\n" +
    "- Ask clarifying questions only if a blocking ambiguity or safety concern exists.\n" +
    "- Minimize narrative explanation unless the user explicitly asks for explanation.\n" +
    "- When work is complete, include a concise completion summary in `response`.\n" +
    "\n\n[STRICT OUTPUT SCHEMA]\n" +
    "Return ONE JSON object only (no markdown/code fences). " +
    "Prefer this exact shape: " +
    `{"response":"string","thought":"string optional","plan":"string optional","self_critique":"string optional","ask_user":"string|string[] optional","ask_user_questions":[],"request_files":[],"web_search":[],"web_browse":[],"search_project":"string optional","changes":[],"commands":[]${mcpSchema}}.\n` +
    "Use `response` as the main answer field. " +
    "Write `response` in clean Markdown (headings/lists/code fences when useful). " +
    "Do not use alternate answer keys unless unavoidable.";
  return prompt;
}

function toBoolean(value: string) {
  return ["y", "yes", "a", "accept", ""].includes((value || "").trim().toLowerCase());
}

function isFullUnlimitedAccess() {
  return isFullAccess() || getSessionAccessGrant().mode === "full";
}

async function askInput(promptText: string) {
  return (await console.input(promptText)).trim();
}

async function askClarificationInput(title: string, question: string) {
  printPanel(
    `${question}\n\nRequired to continue. Multiline supported: Ctrl+Enter or F5 submits.`,
    title || "Clarification Needed",
    THEME.warning,
    true,
  );
  try {
    const { promptMultiline } = await import("../input_mode");
    const reply = await promptMultiline("Reply to AI:");
    return String(reply || "").trim();
  } catch {
    return await askInput("Reply > ");
  }
}

type ClarificationPair = {
  question: string;
  answer: string;
};

async function askClarificationQuestionsSequential(questions: string[]) {
  const out: ClarificationPair[] = [];
  const normalized = normalizeQuestionList(questions);
  const total = normalized.length;
  for (let i = 0; i < total; i += 1) {
    const question = normalized[i];
    const progress = total > 1 ? `Question ${i + 1}/${total}\n\n` : "";
    let answer = "";
    while (!answer.trim()) {
      answer = await askClarificationInput(
        total > 1 ? `Clarification (${i + 1}/${total})` : "Clarification Needed",
        `${progress}${question}`,
      );
      if (!answer.trim()) {
        printWarning("Please enter a response so the agent can continue.");
      }
    }
    out.push({ question, answer: String(answer || "").trim() });
  }
  return out;
}

function buildAskUserAnswerBlock(pairs: ClarificationPair[]) {
  const lines: string[] = ["ASK_USER_ANSWER:"];
  for (let i = 0; i < pairs.length; i += 1) {
    lines.push(`Question ${i + 1}: ${pairs[i].question}`);
    lines.push(`Answer ${i + 1}: ${pairs[i].answer}`);
  }
  return lines.join("\n");
}

export async function askYesNo(
  title: string,
  question: string,
  defaultYes = true,
  style: string = THEME.warning,
) {
  printPanel(
    `${question}\n\n- \`y\` = yes\n- \`n\` = no\n- \`Enter\` = ${defaultYes ? "yes" : "no"}`,
    title,
    style,
    true,
  );
  while (true) {
    const answer = (await askInput(defaultYes ? "Approve? [Y/n] > " : "Approve? [y/N] > ")).trim().toLowerCase();
    if (!answer) return defaultYes;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
    printWarning("Please reply with y or n.");
  }
}

type ChangeDecision = "yes" | "no" | "all" | "none" | "preview";

async function askChangeDecision(change: TaskChange, existed: boolean, idx: number, total: number): Promise<ChangeDecision> {
  const action = existed ? "Edit" : "Create";
  const sizeHint = `${(change.edited || "").split(/\r?\n/).length} line(s)`;
  const summary =
    existed
      ? `${action} \`${change.file}\` (${sizeHint}).`
      : `${action} \`${change.file}\` (${sizeHint}). Missing folder(s) will be created automatically.`;
  printPanel(
    `${summary}\n\nChoose:\n- \`y\` accept this file\n- \`n\` skip this file\n- \`a\` accept all remaining\n- \`s\` skip all remaining\n- \`p\` preview this diff`,
    `Change ${idx}/${total}`,
    existed ? THEME.accent : THEME.warning,
    true,
  );
  while (true) {
    const answer = (await askInput("Decision [y/n/a/s/p] > ")).trim().toLowerCase();
    if (!answer || answer === "y" || answer === "yes") return "yes";
    if (answer === "n" || answer === "no") return "no";
    if (answer === "a" || answer === "all") return "all";
    if (answer === "s" || answer === "skip-all" || answer === "none") return "none";
    if (answer === "p" || answer === "preview") return "preview";
    printWarning("Use y, n, a, s, or p.");
  }
}

function parsePlanTasks(plan: unknown) {
  const text = Array.isArray(plan) ? plan.map((x) => String(x)).join("\n") : String(plan || "");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean)
    .map((line) => ({ text: line, done: false }));
}

function normalizeStringList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x || "").trim()).filter(Boolean);
  if (typeof raw === "string") {
    const t = raw.trim();
    return t ? [t] : [];
  }
  return [];
}

function normalizeQuestionList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      const q = String(item || "").trim();
      if (!q) continue;
      out.push(q);
    }
    return [...new Set(out)];
  }
  if (typeof raw === "string") {
    const q = raw.trim();
    return q ? [q] : [];
  }
  return [];
}

function normalizeAskUserFields(input: Record<string, any>) {
  const data = { ...(input || {}) } as Record<string, any>;
  const questions = [
    ...normalizeQuestionList(data.ask_user_questions),
    ...normalizeQuestionList(data.ask_user),
  ];
  const unique = [...new Set(questions)];
  if (!unique.length) {
    if (!data.ask_user) data.ask_user = "";
    if (data.ask_user_questions !== undefined) data.ask_user_questions = [];
    return data;
  }
  data.ask_user_questions = unique;
  data.ask_user = unique[0];
  return data;
}

function normalizeTaskChanges(raw: unknown): TaskChange[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskChange[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const rec = (item || {}) as Record<string, unknown>;
    const file = String(rec.file || "").trim().replace(/\\/g, "/");
    if (!file) continue;
    if (seen.has(file)) continue;
    seen.add(file);
    out.push({
      file,
      original: String(rec.original || ""),
      edited: sanitizeAiEditedContent(String(rec.edited || "")),
    });
  }
  return out;
}

function toActionChanges(params: Record<string, any>) {
  const fromList = Array.isArray(params.changes) ? params.changes : [];
  if (fromList.length) return fromList;
  const file = String(params.file ?? params.path ?? params.file_path ?? "").trim();
  if (!file) return [];
  return [
    {
      file,
      original: String(params.original ?? params.before ?? params.old_content ?? ""),
      edited: String(params.edited ?? params.content ?? params.new_content ?? params.after ?? ""),
    },
  ];
}

function normalizeActionPayload(input: Record<string, any>) {
  const data = { ...(input || {}) } as Record<string, any>;
  const action = String(data.action || data.tool || data.type || "").trim().toLowerCase();
  const params = data.parameters && typeof data.parameters === "object" ? (data.parameters as Record<string, any>) : {};
  if (!action) return data;

  if (action === "request_files" || action === "read_files") {
    if (!data.request_files) {
      data.request_files =
        params.file_paths ??
        params.paths ??
        params.files ??
        params.file_path ??
        params.path ??
        [];
    }
  } else if (["web_search", "search_web", "search_online", "internet_search", "online_search"].includes(action)) {
    if (!data.web_search) {
      data.web_search =
        params.query ??
        params.queries ??
        params.q ??
        params.search_query ??
        params.search ??
        params.term ??
        params.text ??
        [];
    }
    if (!data.web_search_type && params.search_type) data.web_search_type = params.search_type;
    if (!data.web_search_limit && (params.limit || params.max_results)) data.web_search_limit = params.limit ?? params.max_results;
  } else if (["web_browse", "browse", "open_url", "visit_url"].includes(action)) {
    if (!data.web_browse) {
      data.web_browse = params.urls ?? params.url ?? params.links ?? params.link ?? params.href ?? [];
    }
  } else if (["search_project", "grep_project", "find_in_project"].includes(action)) {
    if (!data.search_project) data.search_project = params.query ?? params.pattern ?? params.search ?? params.q ?? "";
  } else if (action === "ask_user" || action === "question") {
    if (!data.ask_user_questions) data.ask_user_questions = params.questions ?? params.ask_user_questions ?? [];
    if (!data.ask_user) data.ask_user = params.question ?? params.prompt ?? params.message ?? params.questions ?? params.ask_user_questions ?? "";
  } else if (action === "response" || action === "respond" || action === "answer") {
    if (!data.response) data.response = params.message ?? params.content ?? params.text ?? "";
  } else if (["changes", "edit_files", "edit_file", "modify_file", "create_file", "write_file"].includes(action)) {
    if (!data.changes) data.changes = toActionChanges(params);
  } else if (["commands", "run_commands", "run_command", "shell_command"].includes(action)) {
    if (!data.commands) data.commands = params.commands ?? params.command ?? params.cmd ?? [];
  }

  if (!data.request_files && params.file_paths) data.request_files = params.file_paths;
  if (!data.web_search && (params.query || params.queries || params.q)) {
    data.web_search = params.query ?? params.queries ?? params.q;
  }
  if (!data.web_browse && (params.urls || params.url)) data.web_browse = params.urls ?? params.url;
  if (!data.search_project && (params.pattern || params.query || params.search)) {
    data.search_project = params.pattern ?? params.query ?? params.search;
  }
  if (!data.ask_user_questions && (params.questions || params.ask_user_questions)) {
    data.ask_user_questions = params.questions ?? params.ask_user_questions;
  }
  if (!data.changes && (params.file || params.path || params.file_path)) data.changes = toActionChanges(params);
  if (!data.commands && (params.command || params.cmd)) data.commands = params.command ?? params.cmd;

  if (!data.response) {
    const aliases = [
      data.message,
      data.reply,
      data.answer,
      data.output,
      data.result,
      data.assistant_response,
      data.final_response,
      data.finalAnswer,
    ];
    for (const candidate of aliases) {
      if (typeof candidate === "string" && candidate.trim()) {
        data.response = candidate;
        break;
      }
    }
  }

  return normalizeAskUserFields(data);
}

function compactSchemaKey(key: string) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSchemaAliases(input: Record<string, any>) {
  const data = { ...(input || {}) } as Record<string, any>;
  for (const [rawKey, value] of Object.entries(data)) {
    const canonical = canonicalizeSchemaKey(rawKey);
    if (!canonical || canonical === rawKey) continue;
    if (data[canonical] === undefined) {
      data[canonical] = value;
    }
  }

  return data;
}

const KNOWN_SCHEMA_KEYS = new Set([
  "thought",
  "response",
  "mode",
  "plan",
  "confidence",
  "self_critique",
  "changes",
  "commands",
  "ask_user",
  "ask_user_questions",
  "request_files",
  "web_search",
  "web_search_type",
  "web_search_limit",
  "web_browse",
  "search_project",
  "detailed_map",
  "find_symbol",
  "terminal_spawn",
  "terminal_input",
  "terminal_read",
  "terminal_kill",
  "index_project",
  "lint_project",
  "mission_complete",
  "token_usage",
]);

const SCHEMA_ALIAS_TO_CANONICAL = new Map<string, string>([
  ["filechanges", "changes"],
  ["filechange", "changes"],
  ["shellcommands", "commands"],
  ["shellcommand", "commands"],
]);

for (const key of KNOWN_SCHEMA_KEYS) {
  SCHEMA_ALIAS_TO_CANONICAL.set(compactSchemaKey(key), key);
}

function canonicalizeSchemaKey(key: string) {
  const compact = compactSchemaKey(key);
  if (!compact) return "";
  return SCHEMA_ALIAS_TO_CANONICAL.get(compact) || "";
}

function truncateForStream(value: string, maxChars = 1200) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function truncateToolResult(value: unknown, maxChars = 14000) {
  const text = String(value || "").trim();
  if (!text) return "(empty)";
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.55);
  const tail = Math.max(0, maxChars - head - 64);
  return `${text.slice(0, head)}\n\n... (truncated) ...\n\n${text.slice(Math.max(0, text.length - tail))}`;
}

function buildToolFollowupText(baseText: string, toolResults: Record<string, unknown>) {
  const objective = String(baseText || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find(Boolean) || "(objective unavailable)";

  const sections: string[] = [];
  const pushSection = (label: string, value: unknown, maxChars = 14000) => {
    if (value === undefined || value === null) return;
    const rendered = truncateToolResult(value, maxChars);
    sections.push(`### ${label}\n${rendered}`);
  };

  pushSection("Lint Result", toolResults.lint_result, 16000);
  pushSection("Project Search", toolResults.project_search, 6000);
  pushSection("Terminal Results", toolResults.terminal_results, 6000);
  pushSection("Indexing Result", toolResults.indexing_result, 3000);
  pushSection("Symbol Definitions", toolResults.symbol_definitions, 5000);
  pushSection("Web Results", toolResults.web_results, 7000);
  pushSection("Requested Files", toolResults.files, 6000);

  if (!sections.length) sections.push("### Tool Result\nNo tool outputs were captured.");

  return [
    "Continue from the latest tool results only.",
    `Objective: ${objective}`,
    "Do not repeat the entire previous prompt. Use the tool outputs below and return the next concrete actions.",
    "TOOL_RESULTS:",
    sections.join("\n\n"),
  ].join("\n\n");
}

export function renderStreamDashboard(params: {
  provider: string;
  response: string;
  thought: string;
  plan: string;
  activity: string[];
}) {
  const { provider, response, thought, plan, activity } = params;
  const responseBox = renderPanel(truncateForStream(response || "_waiting for output..._", 1500), "Stream: Output", "green", true);
  const thoughtBox = renderPanel(truncateForStream(thought || "_waiting for thought..._", 900), "Stream: Thought", THEME.secondary, true);
  const planBox = renderPanel(truncateForStream(plan || "_waiting for plan..._", 900), "Stream: Plan", THEME.accent, true);
  const activityText = activity.length ? activity.map((a) => `- ${a}`).join("\n") : "_no activity yet..._";
  const activityBox = renderPanel(activityText, `Stream: Activity (${provider})`, THEME.warning, true);
  return [responseBox, thoughtBox, planBox, activityBox].join("\n");
}

import { runMcpTool } from "../mcp_client";

export function describeToolSignal(key: string) {
  const map: Record<string, string> = {
    changes: "Planning file edits",
    commands: "Planning command execution",
    request_files: "Requesting project file(s)",
    web_search: "Running web search",
    web_browse: "Browsing web page(s)",
    search_project: "Searching project files",
    detailed_map: "Building detailed project map",
    find_symbol: "Finding symbol definitions",
    terminal_spawn: "Starting terminal process",
    terminal_input: "Sending terminal input",
    terminal_read: "Reading terminal output",
    terminal_kill: "Stopping terminal process",
    index_project: "Indexing project",
    lint_project: "Running verification/lint",
    mcp_call: "Running external MCP tool",
  };
  return map[key] || `Detected action: ${key}`;
}

function synthesizeChangesIfMissing(claimSource: string, currentChanges: TaskChange[]): TaskChange[] {
  const claimedPaths = extractClaimedFilePaths(claimSource);
  if (!currentChanges.length && claimedPaths.length) {
    const fallbackCode = extractFirstFencedBlock(claimSource);
    const fencedByPath = extractFencedEditsByPath(claimSource, claimedPaths);
    const singleClaim = claimedPaths.length === 1;
    const synthesized: TaskChange[] = [];
    for (const filePath of claimedPaths) {
      const full = path.resolve(process.cwd(), filePath);
      const pathKey = normalizePathKey(filePath);
      const hintedCode = fencedByPath.get(pathKey) || (singleClaim ? fallbackCode : "");
      const existed = fs.existsSync(full);

      if (hintedCode) {
        const edited = sanitizeAiEditedContent(hintedCode);
        const original = existed ? String(fs.readFileSync(full, "utf8")) : "";
        synthesized.push({ file: filePath, original, edited });
        continue;
      }

      if (!existed) {
        const edited = sanitizeAiEditedContent(filePath.endsWith(".md") ? "# Report\n\nGenerated by Agent CLI.\n" : "");
        synthesized.push({ file: filePath, original: "", edited });
      }
    }
    if (synthesized.length) {
      printWarning("AI claimed edits without `changes[]`. Reconstructed actionable file edits from response content.");
      return synthesized;
    }
  }
  return [];
}

function buildFallbackResponse(data: Record<string, any>) {
  const parts: string[] = [];
  const changeCount = Array.isArray(data.changes) ? data.changes.length : 0;
  const commandCount = Array.isArray(data.commands) ? data.commands.length : 0;
  if (changeCount) parts.push(`Prepared ${changeCount} file change(s).`);
  if (commandCount) parts.push(`Prepared ${commandCount} command(s).`);
  if (data.ask_user) parts.push("I need a quick clarification from you.");
  if (!parts.length && data.plan) {
    const plan = Array.isArray(data.plan) ? data.plan.map((x: unknown) => String(x)).join(" | ") : String(data.plan);
    if (plan.trim()) parts.push(`Plan: ${plan.trim()}`);
  }
  return parts.join(" ");
}

function hasToolIntent(data: Record<string, any>) {
  return Boolean(
    data.request_files ||
    data.web_search ||
    data.web_browse ||
    data.search_project ||
    data.detailed_map ||
    data.find_symbol ||
    data.index_project ||
    data.lint_project ||
    data.mcp_call ||
    (Array.isArray(data.commands) && data.commands.length) ||
    (Array.isArray(data.changes) && data.changes.length),
  );
}

function detectEditClaimWithoutChanges(responseMsg: string, responseText: string, changes: TaskChange[]) {
  if (changes.length > 0) return false;
  const combined = `${String(responseMsg || "")}\n${String(responseText || "")}`.trim();
  if (!combined) return false;
  const low = combined.toLowerCase();
  if (/\b(no|didn'?t|unable|cannot|can't)\s+(edit|change|create|modify|write|update)\b/.test(low)) return false;
  const hasEditVerb = /\b(edit(ed|ing)?|modif(y|ied|ying)|updat(ed|ing)?|creat(ed|ing)?|wrot(e|ten|ing)|added|changed|saved|generated)\b/i.test(combined);
  const claimedPaths = extractClaimedFilePaths(combined);
  return hasEditVerb && claimedPaths.length > 0;
}

async function runMissionTools(data: Record<string, any>, missionData: MissionData | undefined) {
  const missionResults: MissionData = {};
  let toolActivityCount = 0;
  let lastActivity = "";
  const updateStatus = (log: string) => {
    if (log !== lastActivity) {
      printActivity(log);
      lastActivity = log;
    }
    if (MISSION_BOARD) {
      MISSION_BOARD.update({
        status: "RUNNING TOOLS",
        status_style: THEME.warning,
        log,
      });
    } else {
      process.stdout.write(chalk.yellow(`\r${log}... `));
    }
    eventBus.emit({
      phase: "thinking",
      status: "progress",
      message: log,
    });
  };

  const markToolResult = (status: string) => {
    toolActivityCount += 1;
    (missionResults as Record<string, unknown>).tool_result_present = true;
    (missionResults as Record<string, unknown>).last_tool_status = status;
  };

  const requestFiles = normalizeStringList(data.request_files);
  const requiresProjectRead = Boolean(
    requestFiles.length ||
    (typeof data.search_project === "string" && data.search_project.trim()) ||
    data.detailed_map ||
    data.find_symbol ||
    data.index_project ||
    data.lint_project,
  );
  if (requiresProjectRead) {
    const requested = requestFiles.length ? requestFiles : ["."];
    const reasonByPath: Record<string, string> = {};
    for (const p of requestFiles) reasonByPath[p] = "Requested by the agent for current task context.";
    if (!requestFiles.length) reasonByPath["."] = "Required for project search/index/lint operations.";
    const access = await ensureSessionAccessForPaths(requested, reasonByPath);
    if (!access.allowed) {
      const deniedRel = access.denied_paths.map((p) => path.relative(process.cwd(), p).replace(/\\/g, "/"));
      const deniedText = deniedRel.length ? deniedRel.join(", ") : "one or more paths";
      missionResults.files = `File access denied for: ${deniedText}`;
      (missionResults as Record<string, unknown>).tool_result_present = true;
      (missionResults as Record<string, unknown>).last_tool_status = "permission_denied";
      printWarning(`File access denied for: ${deniedText}`);
      return missionResults;
    }
  }

  if (requestFiles.length) {
    updateStatus(`Reading ${requestFiles.length} file(s)...`);
    eventBus.emit({
      phase: "reading_file",
      status: "start",
      message: `Reading ${requestFiles.length} requested file(s).`,
    });
    markToolResult(`read_files:${requestFiles.length}`);
    let combined = "";
    for (const rawPath of requestFiles) {
      const p = path.resolve(process.cwd(), String(rawPath));
      if (!fs.existsSync(p)) {
        combined += `\n--- ${rawPath} ---\nError: Not found.\n`;
        continue;
      }
      const stat = fs.statSync(p);
      if (stat.isFile()) {
        try {
          combined += `\n--- ${rawPath} ---\n${fs.readFileSync(p, "utf8")}\n`;
        } catch (error) {
          combined += `\n--- ${rawPath} ---\nError: ${String(error)}\n`;
        }
      } else {
        combined += `\n--- ${rawPath} ---\nError: Path is not a file.\n`;
      }
    }
    missionResults.files = combined;
    missionResults.file_list = requestFiles;
    eventBus.emit({
      phase: "reading_file",
      status: "end",
      message: `Finished reading ${requestFiles.length} file(s).`,
      success: true,
    });
  }

  const asyncTasks: Array<Promise<void>> = [];

  if (data.web_search) {
    const ws = data.web_search;
    const direct = normalizeStringList(ws);
    const fromQuery = normalizeStringList(ws?.query);
    const fromQueries = normalizeStringList(ws?.queries);
    const normalizedQueries = direct.length ? direct : fromQuery.length ? fromQuery : fromQueries;
    const searchTypeRaw = String(data.web_search_type || ws?.search_type || "text").toLowerCase();
    const searchType = searchTypeRaw === "news" ? "news" : "text";
    const finalQueries = normalizedQueries;
    if (finalQueries.length) {
      updateStatus(`Running web search: ${finalQueries.join(", ")}...`);
      eventBus.emit({
        phase: "searching_web",
        status: "start",
        message: `Running web search: ${finalQueries.join(", ")}`,
      });
      markToolResult(`web_search:${finalQueries.join(", ")}`);
      asyncTasks.push(
        (async () => {
          try {
            const results = await webSearch(finalQueries, searchType, Number(data.web_search_limit || 10));
            missionResults.web_results = String(results || "").trim() || "Web search completed with no results.";
            updateStatus("Web search complete.");
            eventBus.emit({
              phase: "searching_web",
              status: "end",
              message: "Web search complete.",
              success: true,
            });
          } catch (error) {
            missionResults.web_results = `Web search failed: ${String(error)}`;
            updateStatus(`Web search failed: ${String(error)}`);
            eventBus.emit({
              phase: "searching_web",
              status: "end",
              message: `Web search failed: ${String(error)}`,
              success: false,
            });
          }
        })(),
      );
    }
  }

  if (data.web_browse) {
    const wb = data.web_browse;
    const urls = normalizeStringList(wb?.urls);
    const fromUrl = normalizeStringList(wb?.url);
    const direct = normalizeStringList(wb);
    const finalUrls = urls.length ? urls : fromUrl.length ? fromUrl : direct;
    if (finalUrls.length) {
      updateStatus(`Browsing URL(s): ${finalUrls.join(", ")}...`);
      markToolResult(`web_browse:${finalUrls.length}`);
      asyncTasks.push(
        (async () => {
          try {
            const browseResult = await webBrowse(finalUrls);
            const existing = String(missionResults.web_results || "");
            missionResults.web_results = existing ? `${existing}\n\nBROWSE RESULTS:\n${browseResult}` : browseResult || "Browse completed with no results.";
            updateStatus("Web browse complete.");
          } catch (error) {
            missionResults.web_results = `${String(missionResults.web_results || "")}\nWeb browse failed: ${String(error)}`.trim();
            updateStatus(`Web browse failed: ${String(error)}`);
          }
        })(),
      );
    }
  }

  if (typeof data.search_project === "string" && data.search_project.trim()) {
    updateStatus(`Searching project for pattern: ${data.search_project.trim()}...`);
    eventBus.emit({
      phase: "reading_file",
      status: "start",
      message: `Searching project for: ${data.search_project.trim()}`,
    });
    markToolResult(`search_project:${data.search_project.trim()}`);
    missionResults.project_search = searchProject(data.search_project.trim());
    eventBus.emit({
      phase: "reading_file",
      status: "end",
      message: "Project search complete.",
      success: true,
    });
  }

  if (data.detailed_map) {
    updateStatus("Generating detailed project map...");
    markToolResult("detailed_map");
    missionResults.detailed_map = intel.getDetailedStructure(".");
  }

  if (data.find_symbol) {
    const findSymbol = data.find_symbol;
    updateStatus("Finding symbol definitions...");
    markToolResult("find_symbol");
    if (typeof findSymbol === "string") {
      const asString = findSymbol.trim();
      if (asString.startsWith("re:")) {
        missionResults.symbol_definitions = intel.findSymbol(asString.slice(3), ".", true);
      } else if (asString) {
        missionResults.symbol_definitions = intel.findSymbol(asString, ".", false);
      }
    } else if (findSymbol && typeof findSymbol === "object") {
      const target = String(findSymbol.symbol || findSymbol.name || findSymbol.pattern || findSymbol.query || "").trim();
      const regexMode = Boolean(findSymbol.regex);
      if (target) missionResults.symbol_definitions = intel.findSymbol(target, ".", regexMode);
    }
  }

  if (data.terminal_spawn && typeof data.terminal_spawn === "object") {
    const command = String(data.terminal_spawn.command || "").trim();
    if (command) {
      updateStatus(`Spawning terminal command: ${command}...`);
      markToolResult(`terminal_spawn:${command}`);
      const handle = procManager.spawn(command);
      missionResults.terminal_results = `Process spawned. Handle: ${handle}`;
    }
  }
  if (data.terminal_input && typeof data.terminal_input === "object") {
    const handle = String(data.terminal_input.handle || "").trim();
    const input = String(data.terminal_input.input || "");
    if (handle) {
      updateStatus(`Sending input to terminal ${handle}...`);
      markToolResult(`terminal_input:${handle}`);
      const ok = procManager.send(handle, input);
      missionResults.terminal_results = `${String(missionResults.terminal_results || "")}\n${ok ? `Sent input to ${handle}: ${input}` : `Error: Handle ${handle} not found for input.`
        }`;
    }
  }
  if (data.terminal_read && typeof data.terminal_read === "object") {
    const handle = String(data.terminal_read.handle || "").trim();
    if (handle) {
      updateStatus(`Reading from terminal ${handle}...`);
      markToolResult(`terminal_read:${handle}`);
      const out = procManager.read(handle);
      missionResults.terminal_results = `${String(missionResults.terminal_results || "")}\nRead from ${handle}:\n${out || "(no output)"}`;
    }
  }
  if (data.terminal_kill && typeof data.terminal_kill === "object") {
    const handle = String(data.terminal_kill.handle || "").trim();
    if (handle) {
      updateStatus(`Killing terminal process ${handle}...`);
      markToolResult(`terminal_kill:${handle}`);
      const ok = procManager.kill(handle);
      missionResults.terminal_results = `${String(missionResults.terminal_results || "")}\n${ok ? `Process ${handle} killed.` : `Error: Handle ${handle} not found for killing.`
        }`;
    }
  }

  if (data.index_project) {
    updateStatus("Indexing project for context map...");
    eventBus.emit({
      phase: "reading_file",
      status: "start",
      message: "Indexing project files.",
    });
    markToolResult("index_project");
    asyncTasks.push(
      (async () => {
        missionResults.indexing_result = await indexProject();
        eventBus.emit({
          phase: "reading_file",
          status: "end",
          message: "Project index complete.",
          success: true,
        });
      })(),
    );
  }

  if (data.lint_project) {
    updateStatus("Running automated project verification (lint)...");
    markToolResult("lint_project");
    asyncTasks.push(
      (async () => {
        missionResults.lint_result = await lintProject();
        eventBus.emit({
          phase: "running_command",
          status: "end",
          message: "Lint command completed.",
          success: !String(missionResults.lint_result || "").toLowerCase().includes("failed"),
        });
      })(),
    );
  }

  if (data.mcp_call && typeof data.mcp_call === "object") {
    const serverName = String(data.mcp_call.server || "").trim();
    const toolName = String(data.mcp_call.tool || "").trim();
    const toolArgs = typeof data.mcp_call.args === "object" ? data.mcp_call.args : {};

    if (serverName && toolName) {
      updateStatus(`Running MCP Tool: ${serverName}:${toolName}...`);
      markToolResult(`mcp_call:${serverName}:${toolName}`);
      asyncTasks.push(
        (async () => {
          missionResults.mcp_results = await runMcpTool(serverName, toolName, toolArgs as Record<string, unknown>);
        })(),
      );
    }
  }

  if (asyncTasks.length) {
    await Promise.all(asyncTasks);
  }
  if (toolActivityCount > 0) {
    (missionResults as Record<string, unknown>).tool_activity_count = toolActivityCount;
  }

  if (Object.keys(missionResults).length) {
    if (!MISSION_BOARD) process.stdout.write("\r" + " ".repeat(50) + "\r"); // Clear spinner line
    if (missionData) Object.assign(missionData, missionResults);
    return missionResults;
  }
  if (!MISSION_BOARD) process.stdout.write("\r" + " ".repeat(50) + "\r"); // Clear spinner line
  return null;
}

export async function handle(text: string, args?: HandleArgs, missionData?: MissionData): Promise<Record<string, any> | null | undefined> {
  const safeArgs = args || { yes: false, fast: false, plan: false };
  const normalized = text.trim().toLowerCase();

  if (normalized === "/sesssion_gui" || normalized === "/session_gui") {
    await showSessionGui();
    return null;
  }

  if (text.startsWith("/")) {
    const executed = await registry.execute(text);
    if (executed) return null;
    const cmdToken = String(text.trim().split(/\s+/)[0] || "").toLowerCase();
    if (cmdToken.startsWith("/")) {
      const suggestions = registry.suggestCommands(cmdToken, 6);
      const hint = suggestions.length
        ? `Unknown command: \`${cmdToken}\`\n\nDid you mean:\n${suggestions.map((s) => `- \`${s}\``).join("\n")}\n\nUse \`/commands\` or \`/help\`.`
        : `Unknown command: \`${cmdToken}\`\n\nUse \`/commands\` or \`/help\` to list available commands.`;
      printPanel(hint, "Command Not Found", THEME.warning, true);
      return null;
    }
  }
  if (cfg.isMissionMode() && !missionData) {
    return missionLoop(text, safeArgs);
  }
  const inMission = Boolean(missionData && (missionData as Record<string, unknown>).is_mission);

  // Planning mode contract:
  // 1) generate a markdown plan artifact in AppData
  // 2) execute exactly once from that plan
  if (
    cfg.isPlanningMode() &&
    !safeArgs.__planningPass &&
    !safeArgs.__autoPlanDone &&
    !inMission
  ) {
    printActivity("Plan mode enabled: generating plan artifact.");
    const planningResult = await handle(
      text,
      {
        ...safeArgs,
        plan: true,
        __planningPass: true,
        __autoPlanDone: true,
      },
      missionData,
    );
    const planText = String(
      (planningResult as Record<string, unknown> | null)?.plan ||
      (planningResult as Record<string, unknown> | null)?.response ||
      "",
    ).trim();
    const thoughtText = String((planningResult as Record<string, unknown> | null)?.thought || "").trim();
    const planFilePath = writePlanArtifact(text, planText, thoughtText);
    printSuccess(`Plan file created: ${planFilePath}`);
    printActivity("Executing once from generated plan.");

    const applyText = [
      text,
      "",
      `Execution Plan File: ${planFilePath}`,
      "Execute exactly once based on this plan:",
      planText || "(no explicit plan text provided by model)",
    ].join("\n");

    return handle(
      applyText,
      {
        ...safeArgs,
        plan: false,
        __autoPlanDone: true,
        __planFilePath: planFilePath,
      },
      missionData,
    );
  }
  if (cfg.isNewlineSupport()) text = text.replace(/\\n/g, "\n");

  const debugEntry: Record<string, any> = { user_input: text, task: null, response: null };
  DEBUG_HISTORY.push(debugEntry);

  const providerName = cfg.getActiveProvider();
  let provider: Awaited<ReturnType<typeof getProvider>>;
  try {
    provider = await getProvider(providerName);
  } catch (error) {
    printError(`Provider initialization failed: ${String(error)}`);
    printInfo("Use `/provider <name>` to switch provider or `/config -h` to configure credentials/endpoints.");
    return null;
  }
  const isFast = Boolean(safeArgs.fast || cfg.isFastMode());
  const isPlanOnly = Boolean((safeArgs.__planningPass || safeArgs.plan) && !isFast && !safeArgs.__executionFromPlan);
  // inMission is computed above before plan-mode orchestration.

  if (!isPlanOnly && !safeArgs.__planningPass && Boolean(cfg.get("auto_compact_enabled", true))) {
    const active = load();
    const session = Array.isArray(active.session) ? active.session : [];
    const used = session.reduce((acc, msg) => acc + estimateTokens(String(msg.content || "")), 0);
    const model = cfg.getModel(providerName);
    const window = estimateContextWindow(providerName, model);
    const thresholdPct = Math.max(1, Math.min(100, Number(cfg.get("auto_compact_threshold_pct", 90))));
    const keepRecent = Math.max(1, Number(cfg.get("auto_compact_keep_recent_turns", 8)));
    if (window > 0 && used >= Math.floor((window * thresholdPct) / 100)) {
      const result = compactSession(undefined, keepRecent, 24);
      if (result.startsWith("Compacted ")) {
        printActivity(`Auto-compacted context at ${thresholdPct}% usage (kept last ${keepRecent} turns).`);
      }
    }
  }

  // Keep recently edited files in context for follow-up edits.
  if (LAST_EDITED_FILES.length) {
    if (!missionData) missionData = {};
    const missionObj = missionData as Record<string, unknown>;
    const existing = Array.isArray(missionObj.auto_context_files) ? (missionObj.auto_context_files as string[]) : [];
    missionObj.auto_context_files = [...new Set([...existing, ...LAST_EDITED_FILES])];
  }
  if (missionData && Array.isArray((missionData as Record<string, unknown>).auto_context_files)) {
    for (const file of (missionData as Record<string, unknown>).auto_context_files as string[]) {
      if (!LAST_EDITED_FILES.includes(file)) LAST_EDITED_FILES.push(file);
    }
  }

  const prompt = await getDynamicPrompt(text);
  const ollamaModel = cfg.getModel("ollama");
  const promptFingerprint = providerName === "ollama" ? hashText(prompt) : "";
  const storedPromptFingerprint = providerName === "ollama" ? getOllamaPromptFingerprint() : "";
  const cachedOllamaContext = providerName === "ollama" ? getOllamaSessionContext(ollamaModel) : [];
  const ollamaWarm = providerName === "ollama" && cachedOllamaContext.length > 0 && storedPromptFingerprint === promptFingerprint;
  const task = build(text, isPlanOnly, isFast, missionData, providerName === "ollama"
    ? {
      ollama_context_mode: ollamaWarm ? "warm" : "cold",
      // Keep system instructions present for Ollama so schema adherence stays stable across turns.
      ollama_include_system: true,
      ollama_include_history: !ollamaWarm,
    }
    : undefined);
  task._stream_print = Boolean(cfg.get("stream_print", true));
  task._stream_enabled = Boolean(cfg.get("stream", true));
  if (providerName === "ollama" && ollamaWarm) {
    task.session_history = [];
  }
  debugEntry.task = task;

  const streamBuffer: string[] = [];
  const streamObserver = new CoreStreamingJsonObserver(STREAM_TOOL_KEYS);
  let streamedResponse = "";
  let streamedThought = "";
  let streamedPlan = "";

  let streamedAskUser = "";
  const turnStartAt = Date.now();
  let announcedStreaming = false;
  let streamUiDisabledForTurn = false;
  let streamUiFallbackNotified = false;

  let streamChunkCount = 0;
  const streamStartAt = Date.now();
  let streamHeartbeat: NodeJS.Timeout | null = null;
  const spinnerFrames = ["|", "/", "-", "\\"];
  const editingState: {
    active: boolean;
    file: string;
    phase: "stream" | "apply";
    timer: NodeJS.Timeout | null;
    frameIdx: number;
  } = {
    active: false,
    file: "",
    phase: "stream",
    timer: null,
    frameIdx: 0,
  };
  let requestWorkspaceRender: (() => void) | null = null;
  const getEditingStatusText = () => {
    if (!editingState.active || !editingState.file) return "";
    const frame = spinnerFrames[editingState.frameIdx % spinnerFrames.length];
    return `Currently Editing ${editingState.file} ${frame}`;
  };
  const renderEditingState = () => {
    const text = getEditingStatusText();
    if (!text) return;
    if (MISSION_BOARD) {
      MISSION_BOARD.update({
        status: editingState.phase === "apply" ? "APPLYING CHANGES" : "STREAM EDITING",
        status_style: editingState.phase === "apply" ? THEME.accent : THEME.warning,
        live_field: editingState.phase === "apply" ? "APPLY" : "STREAM EDIT",
        live_text: text,
        log: text,
      });
      return;
    }
    if (!isPromptInputActive() && requestWorkspaceRender) requestWorkspaceRender();
  };
  const startEditingSpinner = (file: string, phase: "stream" | "apply") => {
    const nextFile = String(file || "").trim();
    if (!nextFile) return;
    editingState.file = nextFile;
    editingState.phase = phase;
    editingState.active = true;
    if (editingState.timer) return;
    editingState.frameIdx = 0;
    renderEditingState();
    editingState.timer = setInterval(() => {
      editingState.frameIdx += 1;
      renderEditingState();
    }, 90);
  };
  const updateEditingSpinner = (file: string, phase: "stream" | "apply") => {
    const nextFile = String(file || "").trim();
    if (!nextFile) return;
    editingState.file = nextFile;
    editingState.phase = phase;
    if (!editingState.active) {
      startEditingSpinner(nextFile, phase);
      return;
    }
    renderEditingState();
  };
  const stopEditingSpinner = () => {
    editingState.active = false;
    editingState.file = "";
    editingState.phase = "stream";
    editingState.frameIdx = 0;
    if (editingState.timer) {
      clearInterval(editingState.timer);
      editingState.timer = null;
    }
    if (!MISSION_BOARD && requestWorkspaceRender) requestWorkspaceRender();
  };
  const getRealActivities = (limit = 12) => {
    const recent = eventBus
      .getRecent(240)
      .filter((event) => event.timestamp >= turnStartAt)
      .map((event) => formatExecutionActivity(event))
      .map((line) => line.trim())
      .filter(Boolean);
    const deduped: string[] = [];
    for (const line of recent) {
      if (deduped[deduped.length - 1] === line) continue;
      deduped.push(line);
    }
    return deduped.slice(-Math.max(1, Math.floor(limit)));
  };
  const renderLiveWorkspace = () => {
    if (MISSION_BOARD || streamUiDisabledForTurn || isPromptInputActive()) return;
    const displayResponse = stripResponseWrapperText(sanitizeStreamFieldPreview("response", streamedResponse || ""));
    const displayThought = sanitizeStreamFieldPreview("thought", streamedThought || "");
    const lines = (displayResponse || "").split(/\r?\n/);
    const responsePreview = lines.length ? lines.join("\n") : "_waiting for response..._";
    const editingText = getEditingStatusText();
    const streamElapsedSec = Math.max(0, Math.floor((Date.now() - streamStartAt) / 1000));
    const spinner = spinnerFrames[streamElapsedSec % spinnerFrames.length];
    const status = editingState.active
      ? (editingState.phase === "apply" ? "APPLYING CHANGES" : "STREAM EDITING")
      : (streamedAskUser ? "WAITING FOR USER" : `STREAMING ${spinner}`);
    const statusColor = editingState.active
      ? (editingState.phase === "apply" ? "green" : "yellow")
      : (streamedAskUser ? "yellow" : "cyan");
    const activityLog = getRealActivities(editingText ? 11 : 12);
    const activity = editingText ? [...activityLog, editingText] : activityLog;
    const workspace = renderWorkspaceLayout({
      title: "Agent CLI Workspace",
      status,
      statusColor,
      meta: `Provider: ${providerName} | Model: ${cfg.getModel(providerName)} | Time: ${streamElapsedSec}s | Chunks: ${streamChunkCount}`,
      response: normalizeDisplayNewlines(responsePreview),
      thought: normalizeDisplayNewlines(displayThought),
      activity,
      fileTree: LAST_EDITED_FILES.slice(-12),
      terminalOutput: LAST_TERMINAL_OUTPUT,
    });
    logUpdate(workspace);
  };
  const renderThrottle = createRenderThrottler(Number(cfg.get("stream_render_fps", 24)), renderLiveWorkspace);
  requestWorkspaceRender = () => {
    if (MISSION_BOARD || streamUiDisabledForTurn || isPromptInputActive()) return;
    renderThrottle.request();
  };
  const streamCallback = (chunk: string) => {
    try {
      streamBuffer.push(chunk);
      streamChunkCount += 1;
      if (!announcedStreaming) {
        printActivity(`Streaming response from ${providerName}.`);
        eventBus.emit({
          phase: "streaming",
          status: "start",
          message: `Streaming response from ${providerName}.`,
        });
        announcedStreaming = true;
      }
      const observed = streamObserver.ingest(chunk);

      if (observed.deltas.response) streamedResponse += observed.deltas.response;
      if (observed.deltas.thought) streamedThought += observed.deltas.thought;
      if (observed.deltas.plan) streamedPlan += observed.deltas.plan;

      if (observed.deltas.ask_user) streamedAskUser += observed.deltas.ask_user;

      const snapshot = streamObserver.snapshot();

      const liveParsed =
        (parseJsonBestEffort(snapshot.rawTail) as Record<string, any> | null) ||
        parseActionEnvelopeText(snapshot.rawTail) ||
        parseLooseKvResponse(snapshot.rawTail);
      const liveResponse = normalizeDisplayNewlines(extractCanonicalResponse(liveParsed));
      const liveThought = normalizeDisplayNewlines(extractCanonicalThought(liveParsed));
      if (liveResponse && liveResponse.length > streamedResponse.length) {
        streamedResponse = liveResponse;
      }
      if (liveThought && liveThought.length > streamedThought.length) {
        streamedThought = liveThought;
      }

      if (observed.fileEdits.length) {
        for (const filePath of observed.fileEdits) {
          const label = `Currently Editing ${filePath}`;
          updateEditingSpinner(filePath, "stream");
          if (MISSION_BOARD) {
            MISSION_BOARD.update({
              status: "STREAMING",
              status_style: THEME.accent,
              log: label,
            });
          }
        }
      }

      if (!MISSION_BOARD && !streamUiDisabledForTurn) {
        renderThrottle.request();
      }

      if (MISSION_BOARD) {
        const liveField = streamedAskUser
          ? "ASK_USER"
          : streamedThought
            ? "THOUGHT"
            : streamedPlan
              ? "PLAN"
              : streamedResponse
                ? "OUTPUT"
                : "STREAM";
        const liveText = streamedAskUser
          ? sanitizeStreamFieldPreview("ask_user", streamedAskUser)
          : streamedThought
            ? sanitizeStreamFieldPreview("thought", streamedThought)
            : streamedPlan
              ? sanitizeStreamFieldPreview("plan", streamedPlan)
              : stripResponseWrapperText(sanitizeStreamFieldPreview("response", streamedResponse || snapshot.response || "")).slice(-2400);
        MISSION_BOARD.update({
          status: streamedAskUser ? "WAITING FOR USER" : "STREAMING",
          status_style: streamedAskUser ? THEME.warning : THEME.accent,
          thought: String(streamedThought || snapshot.thought || ""),
          tasks: parsePlanTasks(streamedPlan || snapshot.plan || ""),
          live_field: liveField,
          live_text: liveText,
          log: observed.deltas.ask_user ? `AI question: ${String(streamedAskUser).slice(-220)}` : undefined,
        });
      }
    } catch (error) {
      streamUiDisabledForTurn = true;
      if (!streamUiFallbackNotified) {
        streamUiFallbackNotified = true;
        printActivity("Streaming UI fallback engaged; continuing response.");
        eventBus.emit({
          phase: "streaming",
          status: "progress",
          message: "Streaming UI fallback engaged",
          metadata: { error: String(error) },
        });
      }
      try {
        renderThrottle.forceFlush();
      } catch {
        // ignore streaming redraw errors in fallback mode
      }
    }
  };

  let responseText = "";
  let rawModelThinking = "";
  let usage = { input_tokens: 0, output_tokens: 0 };
  const streamRetryCount = Number(cfg.get("stream_retry_count", 1));
  const streamTimeoutMs = Number(cfg.get("stream_timeout_ms", 90_000));
  try {
    printActivity(`Talking to provider: ${providerName}`);
    eventBus.emit({
      phase: "thinking",
      status: "start",
      message: `Talking to provider: ${providerName}`,
    });
    if (MISSION_BOARD) {
      MISSION_BOARD.update({
        status: "THINKING",
        status_style: THEME.accent,
        log: `Provider: ${providerName}`,
      });
    }
    if (!MISSION_BOARD) {
      requestWorkspaceRender?.();
      streamHeartbeat = setInterval(() => {
        if (streamUiDisabledForTurn || MISSION_BOARD || isPromptInputActive()) return;
        requestWorkspaceRender?.();
      }, 140);
    }
    const streamExecution = await callWithStreamRecovery({
      streamRetryCount,
      streamTimeoutMs,
      run: async (streamEnabled: boolean) => {
        const attemptTask = {
          ...(task as TaskPayload),
          _stream_enabled: streamEnabled,
        } as TaskPayload;
        return provider.call(prompt, attemptTask, {
          streamCallback: streamEnabled ? streamCallback : undefined,
        });
      },
    });
    streamExecution.health.throttled_renders = renderThrottle.getThrottledCount();
    const result = streamExecution.result;
    responseText = result.text || "";
    rawModelThinking = result.thinking || "";
    usage = result.usage || usage;
    if (streamExecution.health.fallback_used) {
      printWarning("Streaming fallback engaged. Response completed using non-stream mode.");
      eventBus.emit({
        phase: "streaming",
        status: "end",
        message: "Streaming fallback engaged; completed with non-stream mode.",
        success: true,
        metadata: streamExecution.health as unknown as Record<string, unknown>,
      });
    }
    if (providerName === "ollama") {
      const rawContext = (result.provider_state as Record<string, unknown> | undefined)?.ollama_context;
      if (Array.isArray(rawContext) && rawContext.length) {
        const contextTokens = rawContext
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x) && x >= 0)
          .map((x) => Math.floor(x));
        if (contextTokens.length) {
          setOllamaSessionContext(contextTokens, cfg.getModel("ollama"));
          setOllamaPromptFingerprint(promptFingerprint);
        } else {
          invalidateOllamaContext();
        }
      } else {
        invalidateOllamaContext();
      }
    }
    debugEntry.response = responseText;
    if (announcedStreaming) {
      eventBus.emit({
        phase: "streaming",
        status: "end",
        message: "Streaming complete.",
        success: true,
      });
    }
    eventBus.emit({
      phase: "thinking",
      status: "end",
      message: "Provider response received",
      success: true,
      metadata: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      },
    });
  } catch (error) {
    stopEditingSpinner();
    if (providerName === "ollama") invalidateOllamaContext();
    printError(`Error calling provider: ${String(error)}`);
    if (MISSION_BOARD) {
      MISSION_BOARD.update({
        status: "ERROR",
        status_style: THEME.error,
        log: `Provider error: ${String(error)}`,
      });
    }
    eventBus.emit({
      phase: "error",
      status: "end",
      message: `Provider error: ${String(error)}`,
      success: false,
    });
    return null;
  } finally {
    if (streamHeartbeat) {
      clearInterval(streamHeartbeat);
      streamHeartbeat = null;
    }
  }
  try {
    renderThrottle.forceFlush();
  } catch {
    // best effort
  }
  const streamSnapshot = streamObserver.snapshot();

  SESSION_STATS.input_tokens += usage.input_tokens || 0;
  SESSION_STATS.output_tokens += usage.output_tokens || 0;
  SESSION_STATS.turns += 1;
  SESSION_STATS.model = cfg.getModel(providerName);
  SESSION_STATS.total_cost += calculateCost(SESSION_STATS.model, usage.input_tokens || 0, usage.output_tokens || 0);

  let data: Record<string, any> = {};
  const streamText = streamBuffer.join("");
  data =
    (parseJsonBestEffort(responseText) as Record<string, any> | null) ||
    (parseJsonBestEffort(streamText) as Record<string, any> | null) ||
    parseActionEnvelopeText(responseText) ||
    parseActionEnvelopeText(streamText) ||
    parseLooseKvResponse(responseText) ||
    parseLooseKvResponse(streamText) ||
    { response: normalizeDisplayNewlines(responseText || streamText || "") };
  if (!data || typeof data !== "object") data = { response: normalizeDisplayNewlines(responseText || "") };
  data = normalizeActionPayload(data);
  data = normalizeSchemaAliases(data);
  data = normalizeAskUserFields(data);
  if (!data.response) {
    const canonical = extractCanonicalResponse(data);
    if (canonical) data.response = canonical;
  }
  if (!data.response && streamSnapshot.response.trim()) data.response = streamSnapshot.response;
  if (!data.thought && streamSnapshot.thought.trim()) data.thought = streamSnapshot.thought;
  if (!data.plan && streamSnapshot.plan.trim()) data.plan = streamSnapshot.plan;
  if (!data.self_critique && streamSnapshot.self_critique.trim()) data.self_critique = streamSnapshot.self_critique;
  if (!data.ask_user && streamSnapshot.ask_user.trim()) data.ask_user = streamSnapshot.ask_user;
  data = normalizeAskUserFields(data);
  if (!data.web_search && Array.isArray(streamSnapshot.seenToolKeys) && streamSnapshot.seenToolKeys.includes("web_search")) {
    const inferred = parseActionEnvelopeText(streamSnapshot.rawTail);
    const query = String(inferred?.parameters?.query || "").trim() || text.trim();
    if (query) data.web_search = [query];
  }
  if (!data.web_browse && Array.isArray(streamSnapshot.seenToolKeys) && streamSnapshot.seenToolKeys.includes("web_browse")) {
    const inferred = parseActionEnvelopeText(streamSnapshot.rawTail);
    const url = String(inferred?.parameters?.url || "").trim();
    if (url) data.web_browse = [url];
  }
  if (!data.search_project && Array.isArray(streamSnapshot.seenToolKeys) && streamSnapshot.seenToolKeys.includes("search_project")) {
    const inferred = parseActionEnvelopeText(streamSnapshot.rawTail);
    const query = String(
      inferred?.parameters?.pattern ||
      inferred?.parameters?.query ||
      inferred?.parameters?.q ||
      "",
    ).trim();
    if (query) data.search_project = query;
  }
  if (!data.request_files && Array.isArray(streamSnapshot.seenToolKeys) && streamSnapshot.seenToolKeys.includes("request_files")) {
    const inferred = parseActionEnvelopeText(streamSnapshot.rawTail);
    const files = normalizeStringList(inferred?.parameters?.file_paths);
    if (files.length) data.request_files = files;
  }
  if (!data.commands && Array.isArray(streamSnapshot.seenToolKeys) && streamSnapshot.seenToolKeys.includes("commands")) {
    const inferred = parseActionEnvelopeText(streamSnapshot.rawTail);
    const list = normalizeStringList(inferred?.parameters?.commands);
    const one = String(inferred?.parameters?.command || "").trim();
    if (list.length) {
      data.commands = list.map((cmd) => ({ command: cmd }));
    } else if (one) {
      data.commands = [{ command: one }];
    }
  }
  if (!data.find_symbol && Array.isArray(streamSnapshot.seenToolKeys) && streamSnapshot.seenToolKeys.includes("find_symbol")) {
    const inferred = parseActionEnvelopeText(streamSnapshot.rawTail);
    const symbol = String(inferred?.parameters?.symbol || "").trim();
    if (symbol) {
      data.find_symbol = {
        symbol,
        regex: Boolean(inferred?.parameters?.regex),
      };
    }
  }
  if (!data.detailed_map && Array.isArray(streamSnapshot.seenToolKeys) && streamSnapshot.seenToolKeys.includes("detailed_map")) {
    data.detailed_map = true;
  }
  if (!data.index_project && Array.isArray(streamSnapshot.seenToolKeys) && streamSnapshot.seenToolKeys.includes("index_project")) {
    data.index_project = true;
  }
  if (!data.lint_project && Array.isArray(streamSnapshot.seenToolKeys) && streamSnapshot.seenToolKeys.includes("lint_project")) {
    data.lint_project = true;
  }

  if (!responseText.trim() && !Object.keys(data).length) {
    printWarning("AI returned an empty response. This might be due to a model issue or connectivity problem.");
    return { response: "Empty response from AI." };
  }

  const askUserQuestions = normalizeQuestionList(data.ask_user_questions ?? data.ask_user);

  if (MISSION_BOARD) {
    MISSION_BOARD.update({
      status: "PARSING",
      status_style: THEME.secondary,
      thought: String(data.thought || streamedThought || rawModelThinking || ""),
      tasks: parsePlanTasks(data.plan),
      log: "Model response parsed.",
    });
  }

  const toolResults = await runMissionTools(data, missionData);
  if (toolResults) {
    stopEditingSpinner();
    if (MISSION_BOARD) {
      MISSION_BOARD.update({
        status: "TOOL RESULT",
        status_style: THEME.warning,
        log: `Tool execution complete. Resulting tools: ${Object.keys(toolResults).join(", ")}`,
      });
    }
    let nextText = text;
    let nextArgs = { ...safeArgs };
    const lintResult = String((toolResults as Record<string, unknown>).lint_result || "");
    if (lintResult.trim()) {
      const appliedCount = Array.isArray((missionData as Record<string, unknown> | undefined)?.applied_files)
        ? (((missionData as Record<string, unknown>).applied_files as string[]).length)
        : LAST_EDITED_FILES.length;
      const nextLintDepth = Number(safeArgs.__lintFollowupDepth || 0) + 1;
      const lintDigest = hashText(lintResult);
      const depth = Number(safeArgs.__lintFollowupDepth || 0);
      const noEditsSinceLint =
        typeof safeArgs.__lintAppliedCount === "number" &&
        safeArgs.__lintAppliedCount === appliedCount &&
        depth >= 1;
      const sameLintAgain = safeArgs.__lastLintDigest === lintDigest && depth >= 1;
      const tooManyLintCycles = nextLintDepth > MAX_CONSECUTIVE_LINT_CYCLES;

      if (tooManyLintCycles || noEditsSinceLint || sameLintAgain) {
        const reason = tooManyLintCycles
          ? "too many consecutive lint cycles"
          : noEditsSinceLint
            ? "no file edits occurred between lint passes"
            : "lint output repeated unchanged";
        printWarning(`Lint loop guard detected: ${reason}.`);
        if (!safeArgs.__lintRecoveryUsed) {
          printActivity("Lint loop guard: forcing concrete edit proposal.");
          nextText = [
            buildToolFollowupText(text, toolResults as Record<string, unknown>),
            "",
            "LOOP GUARD:",
            `Detected ${reason}.`,
            "Do NOT request lint again in this turn.",
            "Return concrete `changes[]` file edits now (and optional `commands` only after edits).",
          ].join("\n");
          nextArgs = {
            ...nextArgs,
            __lintRecoveryUsed: true,
            __lastLintDigest: lintDigest,
            __lintFollowupDepth: 0,
            __lintAppliedCount: appliedCount,
          };
        } else {
          printWarning("Lint loop recovery already attempted once; stopping this cycle.");
          if (MISSION_BOARD) {
            MISSION_BOARD.update({
              status: "LINT LOOP STOP",
              status_style: THEME.warning,
              log: "Lint loop persisted after recovery prompt.",
            });
          }
          return {
            ...data,
            response: "Lint loop persisted. I stopped re-verifying. Next step: provide concrete file edits in `changes` first, then lint.",
            lint_result: lintResult,
          };
        }
      } else {
        printActivity("Lint completed; using compact follow-up context.");
        nextText = buildToolFollowupText(text, toolResults as Record<string, unknown>);
        nextArgs = {
          ...nextArgs,
          __lintRecoveryUsed: false,
          __lastLintDigest: lintDigest,
          __lintFollowupDepth: nextLintDepth,
          __lintAppliedCount: appliedCount,
        };
      }
    } else if (safeArgs.__lastLintDigest || safeArgs.__lintFollowupDepth) {
      nextArgs = {
        ...nextArgs,
        __lintRecoveryUsed: false,
        __lastLintDigest: "",
        __lintFollowupDepth: 0,
        __lintAppliedCount: undefined,
      };
    }

    if (missionData) {
      Object.assign(missionData, toolResults);
      if ((missionData as Record<string, unknown>).is_mission) {
        const passes = Number((missionData as Record<string, unknown>).tool_passes || 0) + 1;
        (missionData as Record<string, unknown>).tool_passes = passes;
        if (passes <= 6) {
          return handle(nextText, nextArgs, missionData);
        }
        printWarning("Mission tool pass limit reached for this step. Continuing with current output.");
      } else {
        return handle(nextText, nextArgs, missionData);
      }
    }
    return handle(nextText, nextArgs, toolResults);
  }
  if (missionData && (missionData as Record<string, unknown>).is_mission) {
    (missionData as Record<string, unknown>).tool_passes = 0;
  }

  if (askUserQuestions.length) {
    printActivity("AI requested clarification from you.");
    if (MISSION_BOARD) {
      MISSION_BOARD.update({
        status: "WAITING FOR USER",
        status_style: THEME.warning,
        log: askUserQuestions.length > 1 ? `${askUserQuestions.length} clarification questions` : String(askUserQuestions[0] || ""),
      });
    }
    const pairs = await askClarificationQuestionsSequential(askUserQuestions);
    const answerSummary = pairs
      .map((pair, idx) => `${idx + 1}. ${pair.answer}`)
      .join("\n");
    const askUserBlock = buildAskUserAnswerBlock(pairs);
    const nextText =
      `${text}\n\nClarification Provided:\n${answerSummary}\n\n${askUserBlock}`;
    if (missionData) {
      (missionData as Record<string, unknown>).last_clarification = answerSummary;
      (missionData as Record<string, unknown>).ask_user_answer = pairs.map((x) => x.answer).join("\n");
      (missionData as Record<string, unknown>).ask_user_answers = pairs.map((x) => ({ ...x }));
    }
    return handle(nextText, safeArgs, missionData);
  }

  const maxBudget = Number(cfg.get("max_budget", 5.0));
  if (SESSION_STATS.total_cost > maxBudget) {
    printWarning(`Cost Limit Reached! Current Session Cost: $${SESSION_STATS.total_cost.toFixed(4)}`);
    const answer = (await askInput("Budget exceeded. Continue? (y/n): ")).toLowerCase();
    if (answer !== "y") {
      printInfo("Stopped due to budget constraints.");
      return null;
    }
  }

  const structuredThought = String(data.thought || "");
  const thoughtMsg = redactPromptLeak(structuredThought || streamedThought.trim());
  let responseMsg = data.response ? String(data.response) : "";
  if (!responseMsg && responseText.trim()) responseMsg = responseText.trim();
  if (!responseMsg && streamedResponse.trim()) responseMsg = streamedResponse.trim();
  if (!responseMsg && streamSnapshot.response.trim()) responseMsg = streamSnapshot.response.trim();
  responseMsg = stripResponseWrapperText(responseMsg);
  if (!responseMsg.trim()) {
    responseMsg = hasToolIntent(data)
      ? buildFallbackResponse(data)
      : stripResponseWrapperText(responseText || streamText || "");
  }
  if (!responseMsg.trim() && thoughtMsg.trim()) {
    responseMsg = `Model returned reasoning but no final answer.\n\n${thoughtMsg.slice(0, 1200)}`;
  }
  if (!responseMsg.trim()) {
    responseMsg = "No visible assistant output was returned. Check provider/model health and retry.";
  }
  responseMsg = redactPromptLeak(responseMsg);
  let planText = data.plan || "No plan provided";
  if (Array.isArray(planText)) planText = planText.map((x) => String(x)).join("\n");
  data.plan = planText;
  let changes = normalizeTaskChanges(data.changes);
  const commands = Array.isArray(data.commands) ? (data.commands as TaskCommand[]) : [];

  // Planning pass should never directly apply edits/commands.
  if (safeArgs.__planningPass || isPlanOnly) {
    add({ input: text, response: responseMsg || String(data.plan || ""), changes: 0, plan: String(data.plan || "") });
    return data;
  }

  const synthesizedChanges = synthesizeChangesIfMissing(responseMsg || responseText || "", changes);
  if (synthesizedChanges.length) {
    changes = synthesizedChanges;
    data.changes = synthesizedChanges;
  }
  if (Array.isArray(data.changes) && changes.length !== (data.changes as unknown[]).length) {
    printWarning("Some invalid/duplicate file changes were ignored.");
    data.changes = changes;
  }

  if (detectEditClaimWithoutChanges(responseMsg || "", responseText || "", changes)) {
    if (!safeArgs.__strictChangeRetryUsed) {
      printWarning("Strict retry: model claimed edits without changes.");
      printActivity("Strict retry: model claimed edits without changes.");
      const retryText = [
        text,
        "",
        "SYSTEM CORRECTION:",
        "You claimed file modifications. Return concrete `changes[]` entries with exact `file`, `original`, and `edited`.",
        "Do not return prose-only edit claims.",
      ].join("\n");
      return handle(
        retryText,
        {
          ...safeArgs,
          __strictChangeRetryUsed: true,
        },
        missionData,
      );
    }
    printError("Strict retry failed; no file actions applied.");
    printActivity("Strict retry failed; no file actions applied.");
    if (MISSION_BOARD) {
      MISSION_BOARD.update({
        status: "NO ACTIONABLE CHANGES",
        status_style: THEME.error,
        log: "Strict retry failed; model returned no actionable changes.",
      });
    }
    return null;
  }

  const buildIntent = Boolean((task as Record<string, unknown>).build_intent);
  if (buildIntent && !changes.length && !commands.length && !askUserQuestions.length) {
    if (!safeArgs.__codeFirstRetryUsed) {
      printWarning("Code-first retry: no actionable changes/commands were produced.");
      const retryText = [
        text,
        "",
        "SYSTEM CORRECTION:",
        "This task requires concrete implementation output.",
        "Return actionable `changes[]` and/or `commands[]` now.",
        "Do not return explanation-only responses.",
      ].join("\n");
      return handle(
        retryText,
        {
          ...safeArgs,
          __codeFirstRetryUsed: true,
        },
        missionData,
      );
    }
    printWarning("Code-first retry already used; continuing without forcing another correction.");
  }

  const claimedPaths = extractClaimedFilePaths(responseMsg || responseText || "");
  if (claimedPaths.length && !MISSION_BOARD) {
    printPanel(claimedPaths.map((p) => `- \`${p}\``).join("\n"), "Files Mentioned By AI", THEME.secondary, true);
  }

  const showUi = !Boolean(MISSION_BOARD);
  if (Boolean(cfg.get("think_mode", false)) && !isFast) {
    displayThinking(rawModelThinking, thoughtMsg, showUi, Boolean(MISSION_BOARD));
  }
  if (responseMsg) {
    printPanel(responseMsg, "Agent Response", "green", true);
    if (cfg.isVoiceMode()) void speakText(responseMsg);
  }
  if (!MISSION_BOARD) {
    const finalActivities = getRealActivities(12);
    if (finalActivities.length) {
      printPanel(finalActivities.map((a) => `- ${a}`).join("\n"), "Activity", THEME.warning, true);
    }
  }
  // Minimal runtime UI: response + thought + activity only (no plan/schema panels).
  if (changes.length && !isFast) {
    printPanel(changes.map((c) => `- \`${c.file}\``).join("\n"), "Suggested Files", THEME.accent, true);
    console.print("\nProposed Changes:");
    changes.forEach((change) => {
      try {
        showDiff(change.file, change.original || "", change.edited || "");
      } catch (error) {
        printError(`Error showing diff: ${String(error)}`);
      }
    });
  }
  if (commands.length && !isFast) {
    printPanel(commands.map((c) => `- \`${c.command}\`${c.reason ? ` - ${c.reason}` : ""}`).join("\n"), "Proposed Commands", "yellow", true);
  }

  const strictEditRequiresFullAccess = Boolean(cfg.get("strict_edit_requires_full_access", true));
  let editBlockedByPolicy = false;
  if (changes.length) {
    await ensureSessionAccessMode();
    if (strictEditRequiresFullAccess && !isFullUnlimitedAccess()) {
      editBlockedByPolicy = true;
      const blockedFiles = changes.map((change) => path.resolve(process.cwd(), change.file).replace(/\\/g, "/"));
      const blockedLabel = "Edits were blocked because full project access is required. Run `/access full` to allow edits.";
      printWarning(blockedLabel);
      eventBus.emit({
        phase: "writing_file",
        status: "end",
        message: "Editing blocked: full access required",
        success: false,
        metadata: {
          reason: "requires_full_access",
          files: blockedFiles,
        },
      });
      if (MISSION_BOARD) {
        MISSION_BOARD.update({
          status: "EDIT BLOCKED",
          status_style: THEME.warning,
          log: blockedLabel,
        });
      }
      if (missionData) {
        (missionData as Record<string, unknown>).last_tool_status = "edit_blocked";
      }
      responseMsg = `${responseMsg}\n\n${blockedLabel}`.trim();
      data.response = responseMsg;
      changes = [];
      data.changes = [];
    }
  }

  if (!changes.length && !commands.length) {
    stopEditingSpinner();
    if (missionData) {
      (missionData as Record<string, unknown>).last_tool_status = editBlockedByPolicy ? "edit_blocked" : "no_tools";
    }
    if (!MISSION_BOARD) {
      if (editBlockedByPolicy) printWarning("Edit batch was rejected: full project access is required for file writes.");
      else printInfo("No file changes or commands detected. Returning to input.");
    }
    if (MISSION_BOARD) {
      MISSION_BOARD.update({
        status: editBlockedByPolicy ? "EDIT BLOCKED" : "IDLE",
        status_style: editBlockedByPolicy ? THEME.warning : THEME.primary,
        log: editBlockedByPolicy
          ? "Edit batch was rejected: full project access is required."
          : "No file changes or commands detected.",
      });
    }
    add({ input: text, response: responseMsg, changes: 0, plan: String(planText) });
    eventBus.emit({
      phase: "finished",
      status: "end",
      message: editBlockedByPolicy
        ? "Task finished with edit block: full access required."
        : "Task finished with no file/command actions.",
      success: !editBlockedByPolicy,
    });
    return data;
  }

  while (true) {
    if (changes.length) {
      if (!strictEditRequiresFullAccess) {
        const reasonByPath: Record<string, string> = {};
        for (const change of changes) {
          reasonByPath[change.file] = "File write requested by the agent for this task.";
        }
        const access = await ensureSessionAccessForPaths(changes.map((c) => c.file), reasonByPath);
        if (!access.allowed) {
          const deniedText = access.denied_paths
            .map((x) => path.relative(process.cwd(), x).replace(/\\/g, "/"))
            .join(", ");
          printWarning(`File access denied for: ${deniedText || "requested file(s)"}`);
          eventBus.emit({
            phase: "error",
            status: "end",
            message: `File write denied: ${deniedText || "requested files"}`,
            success: false,
          });
          add({ input: text, response: "File access denied by session policy.", changes: 0, plan: String(planText) });
          return null;
        }
      }
    }

    const fullAccess = isFullUnlimitedAccess();
    const requiresHumanReview = !strictEditRequiresFullAccess && changes.length > 0 && !fullAccess;
    const autoApplyRequested = Boolean(safeArgs.yes || cfg.isFastMode() || cfg.getRunPolicy() === "always" || inMission);

    let inputAction = "a";
    if (!requiresHumanReview && fullAccess) {
      printInfo("Auto-accepting file changes (Unlimited/Full Access).");
      printActivity("Auto-accepting file changes (Unlimited/Full Access).");
    }
    if (autoApplyRequested && !requiresHumanReview) {
      printInfo("Auto-applying changes and commands (Full/Auto Mode).");
    } else {
      if (autoApplyRequested && requiresHumanReview) {
        printWarning("Permissions are limited. Manual approval is required for each file change.");
      }
      inputAction = await askInput("(A)ccept / (R)eject / Type to refine: ");
    }

    if (toBoolean(inputAction)) {
      if (changes.length) {
        if (requiresHumanReview) {
          const accepted: TaskChange[] = [];
          const skipped: string[] = [];
          let approveAllRemaining = false;
          let skipAllRemaining = false;
          for (let i = 0; i < changes.length; i += 1) {
            const change = changes[i];
            const existed = fs.existsSync(path.resolve(process.cwd(), change.file));
            if (approveAllRemaining) {
              accepted.push(change);
              continue;
            }
            if (skipAllRemaining) {
              printInfo(`Skipped: ${change.file}`);
              skipped.push(change.file);
              continue;
            }

            while (true) {
              const decision = await askChangeDecision(change, existed, i + 1, changes.length);
              if (decision === "preview") {
                try {
                  showDiff(change.file, change.original || "", change.edited || "");
                } catch (error) {
                  printError(`Error showing diff: ${String(error)}`);
                }
                continue;
              }
              if (decision === "all") {
                approveAllRemaining = true;
                accepted.push(change);
                break;
              }
              if (decision === "none") {
                skipAllRemaining = true;
                printInfo(`Skipped: ${change.file}`);
                skipped.push(change.file);
                break;
              }
              if (decision === "yes") accepted.push(change);
              else {
                printInfo(`Skipped: ${change.file}`);
                skipped.push(change.file);
              }
              break;
            }
          }
          changes = accepted;
          data.changes = accepted;
          if (missionData && skipped.length) {
            const existingSkipped = Array.isArray((missionData as Record<string, unknown>).skipped_files)
              ? ((missionData as Record<string, unknown>).skipped_files as string[])
              : [];
            (missionData as Record<string, unknown>).skipped_files = [...new Set([...existingSkipped, ...skipped])];
          }
          if (!changes.length) printWarning("No file changes were accepted.");
        }

        if (changes.length) {
          if (MISSION_BOARD) {
            MISSION_BOARD.update({
              status: "APPLYING CHANGES",
              status_style: THEME.accent,
              log: `Applying ${changes.length} file change(s).`,
            });
          }
          const preApply = changes.map((change) => {
            const full = path.resolve(process.cwd(), change.file);
            const existed = fs.existsSync(full);
            const prev = existed ? fs.readFileSync(full, "utf8") : "";
            return { file: change.file, prev };
          });

          try {
            apply(changes, (filePath, existedBefore, idx, total, phase) => {
              const action = existedBefore ? "Editing" : "Creating";
              const absPath = path.resolve(process.cwd(), filePath);
              if (phase === "start") {
                updateEditingSpinner(filePath, "apply");
                printActivity(`${action} file ${idx}/${total}: ${filePath}`);
                printInfo(`${action} file ${idx}/${total}: ${filePath}`);
                eventBus.emit({
                  phase: "writing_file",
                  status: "start",
                  message: `${action} file ${idx}/${total}: ${filePath}`,
                  file_path: absPath,
                });
              } else if (phase === "done") {
                updateEditingSpinner(filePath, "apply");
                printActivity(`Done editing ${filePath}`);
                eventBus.emit({
                  phase: "writing_file",
                  status: "end",
                  message: `Finished writing ${filePath}`,
                  file_path: absPath,
                  success: true,
                });
              }
              if (MISSION_BOARD) {
                MISSION_BOARD.update({
                  status: `APPLYING ${idx}/${total}`,
                  status_style: THEME.accent,
                  log: `${action}: ${filePath}`,
                });
              }
            });
          } catch (error) {
            printError(String(error));
            eventBus.emit({
              phase: "error",
              status: "end",
              message: `Apply failed: ${String(error)}`,
              success: false,
            });
            if (missionData) {
              const failed = Array.isArray((missionData as Record<string, unknown>).apply_failures)
                ? ((missionData as Record<string, unknown>).apply_failures as string[])
                : [];
              failed.push(String(error));
              (missionData as Record<string, unknown>).apply_failures = failed;
              (missionData as Record<string, unknown>).last_tool_status = "apply_failed";
            }
            if (MISSION_BOARD) {
              MISSION_BOARD.update({
                status: "APPLY FAILED",
                status_style: THEME.error,
                log: String(error),
              });
            }
            return null;
          } finally {
            stopEditingSpinner();
          }

          if (missionData && typeof missionData === "object") {
            const existing = Array.isArray((missionData as Record<string, unknown>).edited_files)
              ? ((missionData as Record<string, unknown>).edited_files as string[])
              : [];
            const merged = [...existing, ...changes.map((x) => x.file)];
            (missionData as Record<string, unknown>).edited_files = [...new Set(merged)];
            const applied = Array.isArray((missionData as Record<string, unknown>).applied_files)
              ? ((missionData as Record<string, unknown>).applied_files as string[])
              : [];
            (missionData as Record<string, unknown>).applied_files = [...new Set([...applied, ...changes.map((x) => x.file)])];
            (missionData as Record<string, unknown>).last_tool_status = `apply_success:${changes.length}`;
            (missionData as Record<string, unknown>).tool_result_present = true;
          }
          for (const change of changes) {
            if (!LAST_EDITED_FILES.includes(change.file)) LAST_EDITED_FILES.push(change.file);
            add({ role: "user", input: `I accepted changes for ${change.file}.` });
          }

          const diffSummaries = preApply.map((item) => {
            const full = path.resolve(process.cwd(), item.file);
            const next = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
            const counts = countDiffLines(item.prev, next);
            return { file: item.file, added: counts.added, removed: counts.removed };
          });
          const summaryLines = diffSummaries.map((x) => `- ${x.file}: +${x.added} / -${x.removed}`);
          recordDiffBatch(text, diffSummaries);
          printPanel(summaryLines.join("\n"), "Files Changed", THEME.primary, true);
          if (MISSION_BOARD) {
            MISSION_BOARD.update({
              status: "CHANGES APPLIED",
              status_style: THEME.success,
              log: "File changes applied successfully.",
            });
          }
        }
      }

      if (commands.length) {
        const policy = cfg.getRunPolicy();
        if (policy === "never" && !inMission) {
          printWarning("Command execution skipped (Run Policy: NEVER)");
        } else if (policy === "always" || safeArgs.yes || inMission) {
          for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            printActivity(`Running command ${i + 1}/${commands.length}: ${command.command}`);
            printInfo(`[${i + 1}/${commands.length}] Running: ${command.command}`);
            if (MISSION_BOARD) {
              MISSION_BOARD.update({
                status: "RUNNING COMMAND",
                status_style: THEME.accent,
                log: `(${i + 1}/${commands.length}) ${command.command}`,
              });
            }
            const result = await runCommand(command.command, {
              timeoutMs: Number(cfg.get("command_timeout_ms", 30_000)),
              logEnabled: Boolean(cfg.get("command_log_enabled", true)),
              onStdout: (chunk) => {
                LAST_TERMINAL_OUTPUT = `${LAST_TERMINAL_OUTPUT}${chunk}`.slice(-10_000);
                if (chunk.trim()) console.print(chunk);
              },
              onStderr: (chunk) => {
                LAST_TERMINAL_OUTPUT = `${LAST_TERMINAL_OUTPUT}${chunk}`.slice(-10_000);
                if (chunk.trim()) console.print(chunk);
              },
            });
            printInfo(`Exit code: ${result.exit_code} (${result.success ? "success" : "failure"})`);

            if (missionData) {
              const key = "command_results";
              const current = String((missionData as Record<string, unknown>)[key] || "");
              const status = result.success ? "SUCCESS" : "FAILED";
              (missionData as Record<string, unknown>)[key] =
                `${current}\n\n[Step Results - ${status}]\nCommand: ${command.command}\nReturn Code: ${result.exit_code}\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`;
              (missionData as Record<string, unknown>).tool_result_present = true;
              (missionData as Record<string, unknown>).last_tool_status = `command:${status.toLowerCase()}`;
            }

            if (i < commands.length - 1) {
              const stop = await askInput(chalk.yellow(`\nCommand ${i + 1} complete. Press Enter to continue, or 's' to stop sequence: `));
              if (stop.toLowerCase().startsWith("s")) {
                printWarning("Remaining commands cancelled.");
                break;
              }
            }
          }
        } else {
          for (const command of commands) {
            const answer = await askInput(`Run ${command.command}? (y/n): `);
            if (toBoolean(answer)) {
              const result = await runCommand(command.command, {
                timeoutMs: Number(cfg.get("command_timeout_ms", 30_000)),
                logEnabled: Boolean(cfg.get("command_log_enabled", true)),
                onStdout: (chunk) => {
                  LAST_TERMINAL_OUTPUT = `${LAST_TERMINAL_OUTPUT}${chunk}`.slice(-10_000);
                  if (chunk.trim()) console.print(chunk);
                },
                onStderr: (chunk) => {
                  LAST_TERMINAL_OUTPUT = `${LAST_TERMINAL_OUTPUT}${chunk}`.slice(-10_000);
                  if (chunk.trim()) console.print(chunk);
                },
              });
              printInfo(`Exit code: ${result.exit_code} (${result.success ? "success" : "failure"})`);
            }
          }
        }
      }

      const completionSummary = [
        `Status: complete`,
        `Files applied: ${changes.length}`,
        `Commands proposed: ${commands.length}`,
      ].join("\n");
      if (!MISSION_BOARD) {
        printPanel(completionSummary, "Finished", THEME.success, true);
      }
      eventBus.emit({
        phase: "finished",
        status: "end",
        message: `Task finished. files=${changes.length} commands=${commands.length}`,
        success: true,
      });

      add({ input: text, response: responseMsg, changes: changes.length, plan: String(planText) });
      stopEditingSpinner();
      return data;
    }

    if (inputAction.toLowerCase() === "r" || inputAction.toLowerCase() === "reject") {
      printInfo("Action rejected.");
      if (MISSION_BOARD) {
        MISSION_BOARD.update({
          status: "REJECTED",
          status_style: THEME.warning,
          log: "User rejected the proposed action.",
        });
      }
      stopEditingSpinner();
      return null;
    }

    const nextData = missionData || {};
    (nextData as Record<string, unknown>).user_refinement = inputAction;
    return handle(text, safeArgs, nextData);
  }
}

export async function missionLoop(text: string, args: HandleArgs) {
  MISSION_BOARD = new MissionBoard("Agent CLI Mission Board");
  MISSION_BOARD.update({
    status: "MISSION START",
    status_style: THEME.accent,
    log: `Objective: ${text}`,
    tasks: [],
    thought: "",
  });
  const missionData: MissionData = { is_mission: true };
  let stepCount = 1;
  let idleSteps = 0;
  let completionData: Record<string, any> = {};

  while (true) {
    if (stepCount > MISSION_MAX_STEPS) {
      printWarning(`Mission stopped: reached max step limit (${MISSION_MAX_STEPS}).`);
      if (MISSION_BOARD) {
        MISSION_BOARD.update({
          status: "MISSION STOPPED",
          status_style: THEME.warning,
          log: `Max step limit reached (${MISSION_MAX_STEPS}).`,
        });
      }
      break;
    }
    printInfo(`Mission step ${stepCount}`);
    if (MISSION_BOARD) {
      MISSION_BOARD.update({
        status: `MISSION STEP ${stepCount}`,
        status_style: THEME.accent,
        log: `Step ${stepCount} started`,
      });
    }
    printActivity(`Mission step ${stepCount}: planning pass.`);
    const planningData = await handle(
      text,
      {
        ...args,
        plan: true,
        __planningPass: true,
        __planningPassStep: true,
        __executionFromPlan: false,
      },
      missionData,
    );
    let stepPlan = "";
    if (planningData && typeof planningData === "object") {
      const pd = planningData as Record<string, unknown>;
      stepPlan = String(pd.plan || pd.response || "").trim();
      const stepThought = String(pd.thought || "").trim();
      const planFilePath = writePlanArtifact(`MISSION STEP ${stepCount}\n${text}`, stepPlan, stepThought);
      (missionData as Record<string, unknown>).step_plan_file = planFilePath;
      printActivity(`Mission step ${stepCount}: plan saved to ${planFilePath}`);
    }
    printActivity(`Mission step ${stepCount}: execution pass.`);
    const executionText = [
      text,
      "",
      `Mission step ${stepCount} plan:`,
      stepPlan || "(no explicit plan text provided by model)",
    ].join("\n");
    const data = await handle(
      executionText,
      {
        ...args,
        plan: false,
        __planningPass: false,
        __planningPassStep: false,
        __executionFromPlan: true,
        __autoPlanDone: true,
      },
      missionData,
    );
    if (!data) {
      printWarning("Mission stopped.");
      if (MISSION_BOARD) {
        MISSION_BOARD.update({
          status: "MISSION STOPPED",
          status_style: THEME.warning,
          log: "Mission loop stopped or aborted.",
        });
      }
      break;
    }
    let planValue = data.plan || "";
    if (Array.isArray(planValue)) planValue = planValue.map((x) => String(x)).join("\n");
    const complete = Boolean(data.mission_complete) || String(planValue).trim().toUpperCase() === "MISSION COMPLETE";
    if (complete) {
      completionData = {
        response: stripResponseWrapperText(String(data.response || "Mission completed successfully.")),
        thought: data.thought || "Objective achieved.",
      };
      if (MISSION_BOARD) {
        MISSION_BOARD.update({
          status: "MISSION COMPLETE",
          status_style: THEME.success,
          thought: completionData.thought || "",
          log: "Objective achieved.",
        });
      }
      break;
    }

    const toolKeys = [
      "request_files",
      "web_search",
      "web_browse",
      "search_project",
      "detailed_map",
      "find_symbol",
      "terminal_spawn",
      "terminal_input",
      "terminal_read",
      "terminal_kill",
      "changes",
      "commands",
      "tool_result_present",
      "tool_activity_count",
      "command_results",
      "edited_files",
      "applied_files",
      "project_search",
      "file_list",
      "files",
      "indexing_result",
      "lint_result",
      "mcp_results",
    ];
    const dataObj = data as Record<string, any>;
    const toolUsed = toolKeys.some((key) => Boolean(dataObj[key])) || Boolean((missionData as Record<string, unknown>).tool_result_present);
    if (toolUsed) {
      idleSteps = 0;
      stepCount += 1;
      (missionData as Record<string, unknown>).step = stepCount;
      (missionData as Record<string, unknown>).tool_result_present = false;
      (missionData as Record<string, unknown>).tool_activity_count = 0;
      printInfo(`Action turn complete. Moving to step ${stepCount}.`);
      if (MISSION_BOARD) {
        MISSION_BOARD.update({
          status: "ACTION COMPLETE",
          status_style: THEME.secondary,
          log: `Continuing to step ${stepCount}.`,
        });
      }
      continue;
    }

    idleSteps += 1;
    const lastToolStatus = String((missionData as Record<string, unknown>).last_tool_status || "no_tools");
    const status = `No tool action detected (${idleSteps}/${MISSION_IDLE_LIMIT}) [${lastToolStatus}].`;
    printWarning(status);
    if (MISSION_BOARD) {
      MISSION_BOARD.update({
        status: "MISSION IDLE",
        status_style: THEME.warning,
        log: status,
      });
    }

    if (idleSteps >= MISSION_IDLE_LIMIT) {
      printWarning("Mission aborted to prevent stalling. Try a clearer objective or /plan first.");
      if (MISSION_BOARD) {
        MISSION_BOARD.update({
          status: "MISSION ABORTED",
          status_style: THEME.error,
          log: "Autonomous idle limit reached.",
        });
      }
      break;
    }

    (missionData as Record<string, unknown>).force_action = true;
    (missionData as Record<string, unknown>).idle_steps = idleSteps;
    printInfo("Continuing mission autonomously...");
    stepCount += 1;
    (missionData as Record<string, unknown>).step = stepCount;
  }

  if (MISSION_BOARD) {
    MISSION_BOARD.update({
      status: "MISSION FINISHED",
      status_style: THEME.success,
      log: `Finished at step ${stepCount}.`,
    });
    MISSION_BOARD.close();
  }
  MISSION_BOARD = null;
  if (completionData.response) {
    printPanel(String(completionData.response), "MISSION RESULT", THEME.success);
    if (completionData.thought) printPanel(String(completionData.thought), "THOUGHT", THEME.secondary);
  }
  printSuccess(`Mission finished at step ${stepCount}.`);
  return null;
}
