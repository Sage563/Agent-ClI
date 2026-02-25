import fs from "fs-extra";
import path from "path";
import type { TaskChange } from "./types";

type UndoEntry = {
  file: string;
  existed_before: boolean;
  previous_content: string | null;
};

const UNDO_STACK: UndoEntry[][] = [];

function normalizeNewlines(value: string) {
  return String(value || "").replace(/\r?\n/g, "\n");
}

function replaceByTrimmedLineBlock(current: string, original: string, edited: string) {
  const lines = current.split(/\r?\n/);
  const needleLines = original.split(/\r?\n/).map((x) => x.trim()).filter((x) => x.length > 0);
  if (!needleLines.length) return null;
  for (let i = 0; i < lines.length; i += 1) {
    let matched = true;
    for (let j = 0; j < needleLines.length && i + j < lines.length; j += 1) {
      if (lines[i + j].trim() !== needleLines[j]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const replacement = edited.split(/\r?\n/);
    const out = [...lines.slice(0, i), ...replacement, ...lines.slice(i + needleLines.length)];
    return out.join("\n");
  }
  return null;
}

export function apply(
  changes: TaskChange[],
  progressCb?: (filePath: string, existedBefore: boolean, idx: number, total: number, phase?: "start" | "done") => void,
) {
  const batchSnapshot: UndoEntry[] = [];
  const total = changes.length;
  let lastFile = "";
  try {
    changes.forEach((change, idx) => {
      lastFile = change.file;
      const filePath = path.resolve(process.cwd(), change.file);
      const existedBefore = fs.existsSync(filePath);
      const previousContent = existedBefore ? fs.readFileSync(filePath, "utf8") : null;

      batchSnapshot.push({
        file: change.file,
        existed_before: existedBefore,
        previous_content: previousContent,
      });

      fs.ensureDirSync(path.dirname(filePath));
      if (progressCb) progressCb(change.file, existedBefore, idx + 1, total, "start");

      let nextContent = "";
      if (existedBefore) {
        const current = previousContent || "";
        if (change.original) {
          // 1. Exact match attempt
          if (current.includes(change.original)) {
            nextContent = current.replace(change.original, change.edited);
          } else {
            // 2. Whitespace-insensitive fallback
            const normalizedCurrent = normalizeNewlines(current);
            const normalizedOriginal = normalizeNewlines(change.original);

            if (normalizedCurrent.includes(normalizedOriginal)) {
              // If normalized match works, we need to find the literal block to replace
              // This is complex, but for now we fallback to direct replace on normalized if strictly necessary,
              // or better yet, we try to match line by line.
              nextContent = normalizedCurrent.replace(normalizedOriginal, normalizeNewlines(change.edited));
            } else {
              // 3. Trimmed line-by-line fallback for minor indentation drift
              const lineFallback = replaceByTrimmedLineBlock(current, change.original, change.edited);
              if (lineFallback !== null) {
                nextContent = lineFallback;
              } else if (normalizeNewlines(current).trim() === normalizeNewlines(change.edited).trim()) {
                // Already in desired state
                nextContent = current;
              } else {
                throw new Error(`CRITICAL: Match failed for ${change.file}. The requested snippet was not found.`);
              }
            }
          }
        } else {
          nextContent = change.edited;
        }
      } else {
        nextContent = change.edited;
      }
      fs.writeFileSync(filePath, nextContent, "utf8");
      if (progressCb) progressCb(change.file, existedBefore, idx + 1, total, "done");
    });
  } catch (error) {
    // Transactional rollback for partial apply failures.
    for (const item of [...batchSnapshot].reverse()) {
      const p = path.resolve(process.cwd(), item.file);
      try {
        if (item.existed_before) {
          fs.ensureDirSync(path.dirname(p));
          fs.writeFileSync(p, item.previous_content || "", "utf8");
        } else if (fs.existsSync(p)) {
          fs.removeSync(p);
        }
      } catch {
        // best-effort rollback
      }
    }
    throw new Error(`Apply failed on '${lastFile}'. Rolled back batch. Root cause: ${String(error)}`);
  }

  UNDO_STACK.push(batchSnapshot);
}

export function undoLastApply() {
  if (!UNDO_STACK.length) return false;
  const lastBatch = UNDO_STACK.pop() as UndoEntry[];
  for (const item of [...lastBatch].reverse()) {
    const p = path.resolve(process.cwd(), item.file);
    if (item.existed_before) {
      fs.ensureDirSync(path.dirname(p));
      fs.writeFileSync(p, item.previous_content || "", "utf8");
    } else if (fs.existsSync(p)) {
      fs.removeSync(p);
    }
  }
  return true;
}
