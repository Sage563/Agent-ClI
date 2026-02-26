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
  if (!value) return "";
  // Handle literal escaped \n strings that might come from JSON if not properly parsed
  let val = String(value).replace(/\\n/g, "\n");
  return val.replace(/\r?\n/g, "\n");
}

function replaceByTrimmedLineBlock(current: string, original: string, edited: string) {
  const lines = current.split(/\r?\n/);
  const needleLines = original.split(/\r?\n/).map((x) => x.trim()).filter((x) => x.length > 0);
  if (!needleLines.length) return null;

  let outLines = [...lines];
  let replacedCount = 0;

  for (let i = 0; i <= outLines.length - needleLines.length; i += 1) {
    let matched = true;
    for (let j = 0; j < needleLines.length; j += 1) {
      if (outLines[i + j].trim() !== needleLines[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      const replacement = edited.split(/\r?\n/);
      outLines.splice(i, needleLines.length, ...replacement);
      replacedCount += 1;
      // Skip over the replacement to avoid re-matching or overlaps if suitable
      i += replacement.length - 1;
    }
  }

  return replacedCount > 0 ? outLines.join("\n") : null;
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
        let current = previousContent || "";
        if (change.original) {
          // 1. Exact match attempt (multi-replacement via split/join)
          if (current.includes(change.original)) {
            nextContent = current.split(change.original).join(change.edited);
          } else {
            // 2. Whitespace-insensitive fallback
            const normalizedCurrent = normalizeNewlines(current);
            const normalizedOriginal = normalizeNewlines(change.original);

            if (normalizedCurrent.includes(normalizedOriginal)) {
              nextContent = normalizedCurrent.split(normalizedOriginal).join(normalizeNewlines(change.edited));
            } else {
              // 3. Trimmed line-by-line fallback for minor indentation drift (multi-replace)
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
