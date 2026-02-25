import fs from "fs-extra";
import os from "os";
import path from "path";
import say from "say";

export function shortId() {
  return Math.random().toString(36).slice(2, 9);
}

export async function speakText(text: string) {
  try {
    await new Promise<void>((resolve) => {
      say.speak(text, undefined, undefined, () => resolve());
    });
  } catch {
    // ignore
  }
}

function scanForJson(value: string) {
  let start: number | null = null;
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (start === null) {
      if (ch === "{" || ch === "[") {
        start = i;
        stack.push(ch);
      }
      continue;
    }
    if (ch === '"' && !escape) inString = !inString;
    if (!inString) {
      if (ch === "{" || ch === "[") {
        stack.push(ch);
      } else if (ch === "}" || ch === "]") {
        const open = stack.pop();
        if (!open) continue;
        if ((open === "{" && ch !== "}") || (open === "[" && ch !== "]")) {
          start = null;
          stack.length = 0;
          inString = false;
          escape = false;
          continue;
        }
        if (!stack.length && start !== null) return value.slice(start, i + 1);
      }
    }
    escape = ch === "\\" && !escape;
  }
  return start !== null ? value.slice(start) : value;
}

function stripCodeFences(text: string) {
  return String(text || "")
    .replace(/```json\s*/gi, "")
    .replace(/```javascript\s*/gi, "")
    .replace(/```js\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

function balanceJsonDelimiters(value: string) {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '"' && !escape) inString = !inString;
    if (!inString) {
      if (ch === "{") stack.push("}");
      if (ch === "[") stack.push("]");
      if ((ch === "}" || ch === "]") && stack.length && stack[stack.length - 1] === ch) stack.pop();
    }
    escape = ch === "\\" && !escape;
  }
  return value + stack.reverse().join("");
}

function repairJsonLike(value: string) {
  let v = String(value || "");
  v = stripCodeFences(v);
  v = v
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^\uFEFF/, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
    .trim();

  if (!v.startsWith("{") && !v.startsWith("[")) {
    const candidate = scanForJson(v);
    if (candidate && (candidate.startsWith("{") || candidate.startsWith("["))) v = candidate;
  }

  // Convert single-quoted scalar strings to double-quoted JSON strings.
  v = v.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, p1) => `"${String(p1).replace(/"/g, '\\"')}"`);
  v = balanceJsonDelimiters(v);
  return v;
}

function findFirstValidJson(value: string): string | null {
  for (let start = 0; start < value.length; start += 1) {
    const first = value[start];
    if (first !== "{" && first !== "[") continue;
    const stack = [first];
    let inString = false;
    let escape = false;
    for (let i = start + 1; i < value.length; i += 1) {
      const ch = value[i];
      if (ch === '"' && !escape) inString = !inString;
      if (!inString) {
        if (ch === "{" || ch === "[") stack.push(ch);
        if (ch === "}" || ch === "]") {
          const open = stack.pop();
          if (!open) break;
          if ((open === "{" && ch !== "}") || (open === "[" && ch !== "]")) break;
          if (!stack.length) {
            const candidate = value.slice(start, i + 1);
            try {
              JSON.parse(candidate);
              return candidate;
            } catch {
              break;
            }
          }
        }
      }
      escape = ch === "\\" && !escape;
    }
  }
  return null;
}

export function extractJson(text: string) {
  const raw = text || "";
  const fenced = [...raw.matchAll(/```[^\r\n]*\r?\n([\s\S]*?)\r?\n```/g)];
  for (const match of fenced) {
    const block = (match[1] || "").trim();
    if (!block) continue;
    const valid = findFirstValidJson(block);
    if (valid) return valid;
  }
  const valid = findFirstValidJson(raw);
  if (valid) return valid;
  return scanForJson(raw);
}

export function parseJsonBestEffort(text: string): Record<string, unknown> | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const candidates = [raw, extractJson(raw), stripCodeFences(raw)];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // keep trying
    }
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const repaired = repairJsonLike(candidate);
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // keep trying
    }
  }
  return null;
}

export function sanitizeAiEditedContent(text: string) {
  if (typeof text !== "string") return text;
  const full = text.match(/^\s*```[^\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (full) return full[1];

  const lines = text.split(/\r?\n/);
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim().startsWith("```")) start += 1;
  while (end > start && lines[end - 1].trim().startsWith("```")) end -= 1;
  if (start !== 0 || end !== lines.length) {
    let cleaned = lines.slice(start, end).join("\n");
    if (text.endsWith("\n") && cleaned) cleaned += "\n";
    return cleaned;
  }
  return text;
}

export function saveCheckpoint(missionId: string, history: unknown[], missionData: Record<string, unknown>) {
  const dir = path.resolve(process.cwd(), ".agent_checkpoints");
  fs.ensureDirSync(dir);
  const payload = {
    history,
    mission_data: missionData,
    timestamp: Date.now() / 1000,
  };
  const p = path.join(dir, `${missionId}.json`);
  fs.writeJsonSync(p, payload, { spaces: 2 });
  return p;
}

export function loadCheckpoint(missionId: string) {
  const p = path.resolve(process.cwd(), ".agent_checkpoints", `${missionId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readJsonSync(p);
  } catch {
    return null;
  }
}

export function listCheckpoints() {
  const dir = path.resolve(process.cwd(), ".agent_checkpoints");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/i, ""));
}

export function silenceStderr<T>(fn: () => T): T {
  return fn();
}

export function isWindows() {
  return os.platform() === "win32";
}
