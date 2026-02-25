import fs from "fs-extra";
import path from "path";
import type { SessionEntry, SessionFile } from "./types";
import { APP_SESSIONS_DIR, APP_ACTIVE_SESSION } from "./app_dirs";

const DEFAULT_SESSION = "default";

function ensureSessionsDir() {
  fs.ensureDirSync(APP_SESSIONS_DIR());
}

export function getActiveSessionName() {
  try {
    if (fs.existsSync(APP_ACTIVE_SESSION())) {
      const value = fs.readFileSync(APP_ACTIVE_SESSION(), "utf8").trim();
      return value || DEFAULT_SESSION;
    }
  } catch {
    // ignore
  }
  return DEFAULT_SESSION;
}

export function setActiveSessionName(name: string) {
  fs.writeFileSync(APP_ACTIVE_SESSION(), name);
}

function getSessionPath(name: string) {
  return path.join(APP_SESSIONS_DIR(), `${name}.json`);
}

export function load(name?: string): SessionFile {
  ensureSessionsDir();
  const sessionName = name || getActiveSessionName();
  const p = getSessionPath(sessionName);
  if (!fs.existsSync(p)) {
    return { name: sessionName, session: [], metadata: { created_at: Date.now() / 1000 } };
  }
  try {
    return fs.readJsonSync(p) as SessionFile;
  } catch {
    return { name: sessionName, session: [], metadata: { created_at: Date.now() / 1000 } };
  }
}

export function save(data: SessionFile, name?: string) {
  ensureSessionsDir();
  const sessionName = name || data.name || getActiveSessionName();
  fs.writeJsonSync(getSessionPath(sessionName), data, { spaces: 2 });
}

export function add(entry: Record<string, unknown>, name?: string) {
  const data = load(name);
  if (!Array.isArray(data.session)) data.session = [];
  if (!entry.role) entry.role = entry.input ? "user" : "assistant";

  const role = String(entry.role || "user");
  const content =
    role === "user" ? String(entry.input || "") : String(entry.response || entry.plan || "");

  const storedEntry: SessionEntry = {
    role,
    content,
    changes: Number(entry.changes || 0),
    time: Number(entry.time || Date.now() / 1000),
  };
  data.session.push(storedEntry);
  save(data, name);
}

export function estimateTokens(text: string): number {
  return Math.floor((text || "").length / 4);
}

export function inject(limit?: number, tokenLimit = 16000): Array<{ role: string; content: string }> {
  const data = load();
  let session = data.session || [];
  if (limit && limit > 0) session = session.slice(-limit);

  const reversed: Array<{ role: string; content: string }> = [];
  let total = 0;
  for (const item of [...session].reverse()) {
    const role = String(item.role || "user");
    const content = String(item.content || "");
    const msgTokens = estimateTokens(content);
    if (tokenLimit && total + msgTokens > tokenLimit) break;
    reversed.push({ role, content });
    total += msgTokens;
  }
  return reversed.reverse();
}

export function listSessions() {
  ensureSessionsDir();
  return fs
    .readdirSync(APP_SESSIONS_DIR())
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/i, ""));
}

export function deleteSession(name: string) {
  const p = getSessionPath(name);
  if (fs.existsSync(p)) fs.removeSync(p);
  if (getActiveSessionName() === name) setActiveSessionName(DEFAULT_SESSION);
}

export function clear() {
  const name = getActiveSessionName();
  save({ name, session: [], metadata: { created_at: Date.now() / 1000 } }, name);
}

export function renameSession(oldName: string, newName: string): boolean {
  const oldPath = getSessionPath(oldName);
  if (!fs.existsSync(oldPath)) return false;
  const data = load(oldName);
  data.name = newName;
  save(data, newName);
  fs.removeSync(oldPath);
  if (getActiveSessionName() === oldName) setActiveSessionName(newName);
  return true;
}

export function snapshot() {
  const name = getActiveSessionName();
  save(load(name), `${name}_backup`);
}

export function restore() {
  const name = getActiveSessionName();
  const backup = `${name}_backup`;
  const p = getSessionPath(backup);
  if (!fs.existsSync(p)) return false;
  const data = load(backup);
  data.name = name;
  save(data, name);
  return true;
}

export function readSession(name: string) {
  const p = getSessionPath(name);
  if (!fs.existsSync(p)) return null;
  return fs.readJsonSync(p);
}

export function writeSession(name: string, data: unknown) {
  ensureSessionsDir();
  fs.writeJsonSync(getSessionPath(name), data, { spaces: 2 });
}

export function compactSession(name?: string, keepRecentTurns = 8, maxSummaryEntries = 24) {
  const data = load(name);
  keepRecentTurns = Math.max(1, Number(keepRecentTurns || 8));
  maxSummaryEntries = Math.max(5, Number(maxSummaryEntries || 24));
  if (data.session.length <= keepRecentTurns + 2) return "Session too small to compact.";

  const toSummary = data.session.slice(0, -keepRecentTurns);
  const recent = data.session.slice(-keepRecentTurns);
  const focus = toSummary
    .slice(0, maxSummaryEntries)
    .map((e, idx) => `${idx + 1}. [${String(e.role || "user")}] ${String(e.content || "").replace(/\s+/g, " ").trim().slice(0, 180)}`)
    .join("\n");
  const summaryText = [
    "### SESSION COMPACTED",
    `Previously: ${toSummary.length} turns.`,
    `Kept recent raw turns: ${recent.length}.`,
    "",
    "#### Summary of earlier turns",
    focus || "(no summary entries)",
  ].join("\n");

  data.session = [
    {
      role: "assistant",
      content: summaryText,
      changes: 0,
      time: Number(toSummary[toSummary.length - 1]?.time || Date.now() / 1000),
    },
    ...recent,
  ];

  save(data, name);
  return `Compacted ${toSummary.length} turns into a summary. Kept ${recent.length} recent turns.`;
}

export function getSessionMetadata(name?: string): Record<string, unknown> {
  const data = load(name);
  const metadata = (data.metadata || {}) as Record<string, unknown>;
  return metadata;
}

export function updateSessionMetadata(patch: Record<string, unknown>, name?: string) {
  const data = load(name);
  const metadata = (data.metadata || {}) as Record<string, unknown>;
  data.metadata = { ...metadata, ...patch };
  save(data, name);
}

export function getOllamaSessionContext(model?: string, name?: string): number[] {
  const metadata = getSessionMetadata(name);
  const storedModel = String(metadata.ollama_context_model || "");
  if (model && storedModel && storedModel !== model) return [];
  const isValid = metadata.ollama_context_valid;
  if (isValid === false) return [];
  const ctx = metadata.ollama_context_tokens;
  if (!Array.isArray(ctx)) return [];
  const tokens = ctx
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x >= 0)
    .map((x) => Math.floor(x));
  return tokens;
}

export function setOllamaSessionContext(tokens: number[], model: string, name?: string) {
  const clean = (tokens || [])
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x >= 0)
    .map((x) => Math.floor(x));
  updateSessionMetadata(
    {
      ollama_context_tokens: clean,
      ollama_context_model: model || "",
      ollama_context_saved_at: Date.now() / 1000,
      ollama_context_valid: clean.length > 0,
    },
    name,
  );
}

export function clearOllamaSessionContext(name?: string) {
  updateSessionMetadata(
    {
      ollama_context_tokens: [],
      ollama_context_model: "",
      ollama_context_saved_at: 0,
      ollama_context_valid: false,
      ollama_prompt_fingerprint: "",
    },
    name,
  );
}

export function invalidateOllamaContext(name?: string) {
  updateSessionMetadata(
    {
      ollama_context_valid: false,
      ollama_context_tokens: [],
      ollama_context_saved_at: Date.now() / 1000,
    },
    name,
  );
}

export function getOllamaPromptFingerprint(name?: string) {
  const metadata = getSessionMetadata(name);
  return String(metadata.ollama_prompt_fingerprint || "");
}

export function setOllamaPromptFingerprint(hash: string, name?: string) {
  updateSessionMetadata({ ollama_prompt_fingerprint: String(hash || "") }, name);
}
