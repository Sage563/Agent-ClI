import type { StreamHealthState } from "../types";

function extractJsonStringAt(buffer: string, start: number) {
  const isLikelyTerminator = (idx: number) => {
    for (let j = idx + 1; j < buffer.length; j += 1) {
      const next = buffer[j];
      if (next === " " || next === "\n" || next === "\r" || next === "\t") continue;
      // If the next char is a quote, it's likely a new key starting (missing comma case)
      return next === "," || next === "}" || next === "]" || next === '"';
    }
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

  constructor(
    private readonly streamToolKeys: string[],
  ) {}

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

      if (objectDepth !== 1 || arrayDepth !== 0) continue;

      const parsed = extractJsonStringAt(this.buffer, i + 1);
      if (!parsed.complete) continue;
      const key = decodeJsonStringFragment(parsed.raw, true).trim();
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
    for (const key of this.streamToolKeys) {
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

export function createRenderThrottler(fps: number, callback: () => void) {
  const safeFps = Math.max(1, Math.floor(fps || 24));
  const minIntervalMs = Math.max(8, Math.floor(1000 / safeFps));
  let pending = false;
  let lastRun = 0;
  let timer: NodeJS.Timeout | null = null;
  let throttledRenders = 0;

  const flush = () => {
    pending = false;
    lastRun = Date.now();
    callback();
  };

  return {
    request() {
      const now = Date.now();
      if (now - lastRun >= minIntervalMs && !pending) {
        flush();
        return;
      }
      throttledRenders += 1;
      if (pending) return;
      pending = true;
      const wait = Math.max(0, minIntervalMs - (now - lastRun));
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, wait);
    },
    forceFlush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    },
    getThrottledCount() {
      return throttledRenders;
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function callWithStreamRecovery<T>(params: {
  streamRetryCount: number;
  streamTimeoutMs: number;
  run: (streamEnabled: boolean) => Promise<T>;
}) {
  const attempts = Math.max(0, Math.floor(params.streamRetryCount || 0));
  const timeoutMs = Math.max(1_000, Math.floor(params.streamTimeoutMs || 90_000));
  const health: StreamHealthState = {
    attempts: 0,
    timeout_ms: timeoutMs,
    fallback_used: false,
    throttled_renders: 0,
  };

  for (let i = 0; i <= attempts; i += 1) {
    try {
      health.attempts = i + 1;
      const result = await withTimeout(
        params.run(true),
        timeoutMs,
        `Streaming timed out after ${timeoutMs}ms.`,
      );
      return { result, health };
    } catch (error) {
      health.last_error = String(error);
      if (i >= attempts) break;
    }
  }

  health.fallback_used = true;
  const fallback = await withTimeout(
    params.run(false),
    timeoutMs,
    `Fallback response timed out after ${timeoutMs}ms.`,
  );
  return { result: fallback, health };
}

