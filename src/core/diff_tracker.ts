import fs from "fs-extra";
import path from "path";
import { appDataDir } from "../app_dirs";

export type DiffFileSummary = {
  file: string;
  added: number;
  removed: number;
};

export type DiffBatchRecord = {
  at: number;
  task: string;
  files: DiffFileSummary[];
};

const MAX_MEMORY = 200;
const DIFF_HISTORY: DiffBatchRecord[] = [];

function diffLogPath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(appDataDir(), "logs", `diffs-${date}.ndjson`);
}

function appendDiffLog(record: DiffBatchRecord) {
  const p = diffLogPath();
  fs.ensureDirSync(path.dirname(p));
  fs.appendFileSync(p, `${JSON.stringify(record)}\n`, "utf8");
}

export function recordDiffBatch(task: string, files: DiffFileSummary[]) {
  if (!files.length) return;
  const rec: DiffBatchRecord = {
    at: Date.now(),
    task: String(task || "").trim().slice(0, 400),
    files: files.map((f) => ({
      file: String(f.file || "").replace(/\\/g, "/"),
      added: Math.max(0, Number(f.added || 0)),
      removed: Math.max(0, Number(f.removed || 0)),
    })),
  };
  DIFF_HISTORY.push(rec);
  if (DIFF_HISTORY.length > MAX_MEMORY) {
    DIFF_HISTORY.splice(0, DIFF_HISTORY.length - MAX_MEMORY);
  }
  appendDiffLog(rec);
}

export function listRecentDiffBatches(limit = 20) {
  const max = Math.max(1, Math.floor(limit));
  return DIFF_HISTORY.slice(-max);
}

export function readDiffBatchesFromDisk(limit = 40) {
  const p = diffLogPath();
  if (!fs.existsSync(p)) return [] as DiffBatchRecord[];
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
  const recent = lines.slice(-Math.max(1, Math.floor(limit)));
  const out: DiffBatchRecord[] = [];
  for (const line of recent) {
    try {
      out.push(JSON.parse(line) as DiffBatchRecord);
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

