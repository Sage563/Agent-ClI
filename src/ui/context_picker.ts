import fs from "fs";
import path from "path";
import chalk from "chalk";
import logUpdate from "log-update";
import { getProjectFiles, searchProjectFiles, type ProjectFileEntry } from "../file_browser";
import { cfg } from "../config";
import { console, fit, isPromptInputActive, resetScrollRegion, setPromptInputActive, setupScrollRegion } from "./console";
import { isTuiEnabled, refreshFileList, teardownTui } from "./tui";

export type ContextPickerResult = {
  action: "confirm" | "cancel";
  selected: string[];
};

export type ContextPickerOptions = {
  initialQuery?: string;
  maxPreviewLines?: number;
  rootDir?: string;
};

type PreviewResult = {
  lines: string[];
  truncated: boolean;
  binary: boolean;
  image: boolean;
  error?: string;
};

function splitChunk(chunk: string) {
  const out: string[] = [];
  let i = 0;
  while (i < chunk.length) {
    const ch = chunk[i];
    if (ch !== "\x1b") {
      out.push(ch);
      i += 1;
      continue;
    }
    if (i + 1 < chunk.length && (chunk[i + 1] === "[" || chunk[i + 1] === "O")) {
      let j = i + 2;
      while (j < chunk.length) {
        const c = chunk[j];
        if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "~" || c === "u") {
          j += 1;
          break;
        }
        j += 1;
      }
      out.push(chunk.slice(i, Math.min(j, chunk.length)));
      i = Math.min(j, chunk.length);
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out;
}

const isUp = (key: string) => key === "\x1b[A" || key === "\x1bOA" || /^\x1b\[\d+;\d+A$/.test(key);
const isDown = (key: string) => key === "\x1b[B" || key === "\x1bOB" || /^\x1b\[\d+;\d+B$/.test(key);

export function readPreviewLines(filePath: string, maxLines = 20, maxBytes = 131072): PreviewResult {
  if (!filePath || typeof filePath !== "string") {
    return { lines: ["[Invalid file path]"], truncated: false, binary: false, image: false, error: "Invalid path" };
  }
  const full = path.resolve(process.cwd(), filePath);
  let fd: number | null = null;
  try {
    const ext = path.extname(full).toLowerCase();
    const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext);

    fd = fs.openSync(full, "r");
    const size = fs.fstatSync(fd).size;

    if (isImage) {
      if (size > 10 * 1024 * 1024) {
        return { lines: [`[Image too large to preview: ${(size / 1024 / 1024).toFixed(2)}MB]`], truncated: false, binary: true, image: true };
      }
      return { lines: [`[Loading Image: ${path.basename(full)} - ${(size / 1024).toFixed(1)}KB]...`], truncated: false, binary: false, image: true };
    }

    const readLen = Math.max(1, Math.min(maxBytes, size || maxBytes));
    const buf = Buffer.alloc(readLen);
    const bytesRead = fs.readSync(fd, buf, 0, readLen, 0);
    const sample = buf.subarray(0, bytesRead);
    if (sample.includes(0)) {
      return { lines: ["[Binary file preview unavailable]"], truncated: false, binary: true, image: false };
    }

    const text = sample.toString("utf8");
    const rawLines = text.split(/\r?\n/);
    const lines = rawLines.slice(0, Math.max(1, maxLines));
    const truncated = rawLines.length > maxLines || bytesRead < size;
    return { lines, truncated, binary: false, image: false };
  } catch (error) {
    return {
      lines: [`[Preview error: ${String(error)}]`],
      truncated: false,
      binary: false,
      image: false,
      error: String(error),
    };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close failures
      }
    }
  }
}

async function loadAsyncImagePreview(filePath: string): Promise<string[]> {
  try {
    if (!filePath || typeof filePath !== "string") return ["[Invalid image path]"];
    const full = path.resolve(process.cwd(), filePath);
    const cols = Math.max(80, (process.stdout.columns || 120) - 2);
    const leftWidth = Math.max(34, Math.floor(cols * 0.52));
    const rightWidth = Math.max(26, cols - leftWidth - 3);
    const listRows = Math.max(8, (process.stdout.rows || 30) - 7);

    const isAscii = Boolean(cfg.get("image_to_ascii"));
    let out: string | string[] = "";

    if (isAscii) {
      const asciify = (await (new Function("return import('asciify-image')"))()) as any;
      const asciifyFn = asciify.default && typeof asciify.default === "function" ? asciify.default : (typeof asciify === "function" ? asciify : asciify.default || asciify);
      out = await asciifyFn(full, { fit: "original" as const, width: Math.max(10, rightWidth - 2), height: listRows, color: true });
    } else {
      const ti = (await (new Function("return import('terminal-image')"))()) as any;
      const terminalImage = ti.default && typeof ti.default.file === "function" ? ti.default : (ti.file ? ti : ti.default || ti);
      // Use both width and height to force bounding box fit
      const safeWidth = Math.max(10, rightWidth - 2);
      const widthPct = Math.floor((safeWidth / cols) * 100) + "%";
      // terminal-image height is in lines if passed as a string/number? 
      // Actually, terminal-image is pixels-first. Using % for both is safest.
      out = await terminalImage.file(full, { width: widthPct, height: "100%" });
    }

    const outString = Array.isArray(out) ? out.join("\n") : String(out);
    return outString.trimEnd().split(/\r?\n/).slice(0, listRows);
  } catch (err) {
    return [`[Preview generation failed]`, String(err)];
  }
}

function renderPicker(params: {
  query: string;
  files: ProjectFileEntry[];
  selected: Set<string>;
  highlighted: number;
  preview: PreviewResult;
  maxPreviewLines: number;
}) {
  const { query, files, selected, highlighted, preview, maxPreviewLines } = params;
  const cols = Math.max(80, (process.stdout.columns || 120) - 2);
  const rows = Math.max(20, process.stdout.rows || 30);
  const leftWidth = Math.max(34, Math.floor(cols * 0.52));
  const rightWidth = Math.max(26, cols - leftWidth - 3);
  const listRows = Math.max(8, rows - 7);

  const title = "Context Files";
  const status = `Files: ${files.length}  Selected: ${selected.size}`;
  const spacer = Math.max(1, cols - title.length - status.length - 2);
  const top = `${chalk.bold.cyan(title)}${" ".repeat(spacer)}${chalk.gray(status)}`;
  const queryLine = `${chalk.bold("Query:")} ${query || chalk.gray("(all files)")}`;
  const border = "-".repeat(Math.max(1, cols));

  const lines: string[] = [top, queryLine, border];

  for (let i = 0; i < listRows; i += 1) {
    const entry = files[i];
    const previewLine = String(preview.lines[i] || "");
    const leftRaw = entry
      ? `${selected.has(entry.path) ? "[x]" : "[ ]"} ${entry.path}`
      : "";
    const left = i === highlighted
      ? chalk.black.bgCyan(fit(leftRaw, leftWidth))
      : fit(leftRaw, leftWidth);
    const right = fit(previewLine, rightWidth);
    lines.push(`${left} | ${chalk.gray(right)}`);
  }

  const previewHint = preview.image
    ? "[image visual context]"
    : preview.binary
      ? "[binary]"
      : preview.truncated
        ? `[showing first ${maxPreviewLines} lines]`
        : "[full preview]";
  lines.push(border);
  lines.push(chalk.gray(`Preview ${previewHint}`));
  lines.push(chalk.gray("Controls: Up/Down move | Space toggle | Enter confirm | Esc cancel | Backspace delete"));
  return lines.join("\n");
}

export async function openContextPicker(opts: ContextPickerOptions = {}): Promise<ContextPickerResult> {
  const priorPromptActive = isPromptInputActive();
  setPromptInputActive(true);
  resetScrollRegion();
  if (isTuiEnabled()) teardownTui();
  try {
    process.stdout.write("\x1b[?25l");
  } catch {
    // ignore
  }
  const maxPreviewLines = Math.max(1, Number(opts.maxPreviewLines || 20));
  const rootDir = opts.rootDir || ".";
  const allFiles = getProjectFiles(rootDir);
  let query = String(opts.initialQuery || "");
  let filtered = query ? searchProjectFiles(allFiles, query, 500) : allFiles.slice(0, 500);
  let highlighted = 0;
  const selected = new Set<string>();
  let preview = filtered.length
    ? readPreviewLines(filtered[0].path, maxPreviewLines)
    : { lines: ["[No files found]"], truncated: false, binary: false, image: false };

  let previewStateId = 0;

  const refresh = () => {
    filtered = query ? searchProjectFiles(allFiles, query, 500) : allFiles.slice(0, 500);
    if (highlighted >= filtered.length) highlighted = Math.max(0, filtered.length - 1);
    if (highlighted < 0) highlighted = 0;

    if (!filtered.length) {
      preview = { lines: ["[No files found]"], truncated: false, binary: false, image: false };
      logUpdate(renderPicker({ query, files: filtered, selected, highlighted, preview, maxPreviewLines }));
      return;
    }

    const currentId = ++previewStateId;
    const item = filtered[highlighted];

    preview = readPreviewLines(item.path, maxPreviewLines);
    logUpdate(renderPicker({ query, files: filtered, selected, highlighted, preview, maxPreviewLines }));

    if (preview.image && !preview.binary) {
      loadAsyncImagePreview(item.path).then((lines) => {
        if (previewStateId === currentId) {
          preview = { ...preview, lines };
          logUpdate(renderPicker({ query, files: filtered, selected, highlighted, preview, maxPreviewLines }));
        }
      });
    }
  };

  try {
    return await new Promise<ContextPickerResult>((resolve) => {
      const onResize = () => refresh();
      const onData = (chunk: string) => {
      for (const key of splitChunk(chunk)) {
        if (key === "\u0003" || key === "\x1b") {
          cleanup();
          resolve({ action: "cancel", selected: [] });
          return;
        }
        if (isUp(key)) {
          highlighted = Math.max(0, highlighted - 1);
          refresh();
          continue;
        }
        if (isDown(key)) {
          highlighted = Math.min(Math.max(0, filtered.length - 1), highlighted + 1);
          refresh();
          continue;
        }
        if (key === "\r" || key === "\n") {
          if (!selected.size && filtered[highlighted]) selected.add(filtered[highlighted].path);
          cleanup();
          resolve({ action: "confirm", selected: [...selected] });
          return;
        }
        if (key === " ") {
          const current = filtered[highlighted];
          if (current) {
            if (selected.has(current.path)) selected.delete(current.path);
            else selected.add(current.path);
            refresh();
          }
          continue;
        }
        if (key === "\x7f" || key === "\b") {
          if (query.length) {
            query = query.slice(0, -1);
            refresh();
          }
          continue;
        }
        if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) <= 126) {
          query += key;
          refresh();
        }
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onData);
      process.stdout.removeListener("resize", onResize);
      logUpdate.clear();
      try {
        process.stdout.write("\x1b[2K\x1b[G");
        process.stdout.write("\x1b[?25h");
      } catch {
        // ignore
      }
      resetScrollRegion();
      setupScrollRegion();
      setPromptInputActive(priorPromptActive);
      if (isTuiEnabled()) refreshFileList(".");
    };

      process.stdin.on("data", onData);
      process.stdout.on("resize", onResize);
      refresh();
    });
  } finally {
    // Ensure prompt state is restored even if the picker throws unexpectedly.
    setPromptInputActive(priorPromptActive);
  }
}
