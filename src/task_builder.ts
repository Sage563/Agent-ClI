import fs from "fs-extra";
import os from "os";
import path from "path";
import mime from "mime-types";
import { cfg } from "./config";
import { getOllamaSessionContext, inject } from "./memory";
import type { MissionData, TaskPayload } from "./types";

const IGNORE_PATTERNS = new Set([
  ".git",
  "venv",
  "__pycache__",
  "node_modules",
  ".pytest_cache",
  ".vscode",
  "dist",
  "build",
]);

export function getProjectMap(startPath = ".", maxDepth = 4, maxEntries = 1000): string {
  const base = path.resolve(process.cwd(), startPath);
  const rows: string[] = [];

  function walk(current: string, depth: number) {
    if (depth > maxDepth || rows.length >= maxEntries) return;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory() && IGNORE_PATTERNS.has(entry.name)) continue;
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else {
        rows.push(path.relative(base, full).replace(/\\/g, "/"));
        if (rows.length >= maxEntries) break;
      }
    }
  }

  walk(base, 0);
  if (rows.length >= maxEntries) {
    rows.push("... (project map truncated due to size)");
  }
  return rows.join("\n");
}

export function getShellProjectListing(startPath = "."): string {
  try {
    if (os.platform() === "win32") {
      const { execSync } = require("child_process");
      const out = execSync(`cmd /c dir /s /b ${startPath}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 });
      const lines = out.split(/\r?\n/).filter(Boolean);
      if (lines.length > 5000) {
        return `${lines.slice(0, 5000).join("\n")}\n... (truncated ${lines.length - 5000} lines)`;
      }
      return out.trim();
    }
    const { execSync } = require("child_process");
    const out = execSync(`ls -laR ${startPath}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 });
    const lines = out.split(/\r?\n/).filter(Boolean);
    if (lines.length > 5000) {
      return `${lines.slice(0, 5000).join("\n")}\n... (truncated ${lines.length - 5000} lines)`;
    }
    return out.trim();
  } catch (error) {
    return `Shell listing failed: ${String(error)}`;
  }
}

function isBinary(filePath: string) {
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(1024);
  const size = fs.readSync(fd, buffer, 0, 1024, 0);
  fs.closeSync(fd);
  return buffer.slice(0, size).includes(0);
}

function addPath(
  p: string,
  contextFiles: Array<Record<string, unknown>>,
  imageFiles: Array<Record<string, unknown>>,
  imageDescriptions: Array<Record<string, unknown>>,
  imageErrors: string[],
  seenPaths: Set<string>,
) {
  if (!fs.existsSync(p)) return;
  const absPath = path.resolve(p);
  if (seenPaths.has(absPath)) return;
  seenPaths.add(absPath);

  const stat = fs.statSync(p);
  if (stat.isFile()) {
    const ext = path.extname(p).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].includes(ext)) {
      try {
        const size = stat.size;
        if (size > 5 * 1024 * 1024) {
          imageErrors.push(`${p} is too large (${size} bytes). Max 5MB.`);
          return;
        }
        const raw = fs.readFileSync(p);
        const b64 = raw.toString("base64");
        const guessed = mime.lookup(p) || "image/png";
        imageFiles.push({
          file: path.resolve(p),
          mime: guessed,
          data_base64: b64,
        });
        imageDescriptions.push({
          file: path.resolve(p),
          mime: guessed,
          size_bytes: size,
        });
      } catch (error) {
        imageErrors.push(`Failed to read image ${p}: ${String(error)}`);
      }
      return;
    }

    try {
      if (isBinary(p)) return;
      contextFiles.push({
        file: absPath,
        content: fs.readFileSync(p, "utf8"),
      });
    } catch (error) {
      contextFiles.push({
        file: absPath,
        error: `Failed to read file: ${String(error)}`,
      });
    }
    return;
  }

  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(p, { withFileTypes: true })) {
      if (child.name.startsWith(".")) continue;
      if (child.isDirectory() && IGNORE_PATTERNS.has(child.name)) continue;
      addPath(path.join(p, child.name), contextFiles, imageFiles, imageDescriptions, imageErrors, seenPaths);
    }
  }
}

function collectMentionedPaths(text: string) {
  const out = new Set<string>();
  if (!text) return out;

  const addCandidate = (candidateRaw: string) => {
    const candidate = candidateRaw.trim().replace(/^[("'`]+|[)"'`.,;:!?]+$/g, "");
    if (!candidate) return;
    if (/^https?:\/\//i.test(candidate)) return;
    if (candidate.startsWith("@")) return;

    const normalized = candidate.replace(/^\.?[\\/]/, (m) => m);
    if (fs.existsSync(normalized)) {
      out.add(normalized);
      return;
    }
    const rel = path.resolve(process.cwd(), normalized);
    if (fs.existsSync(rel)) out.add(normalized);
  };

  for (const match of text.matchAll(/`([^`]+)`/g)) {
    addCandidate(match[1] || "");
  }

  // Improved regex for paths: matches ./foo/bar, C:\foo\bar, /foo/bar, and relative/paths/with.ext
  const pathRegex = /(?:[A-Za-z]:\\|\.{1,2}[\\/]|\/)?(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9]{1,12})?/g;
  for (const match of text.matchAll(pathRegex)) {
    addCandidate(match[0] || "");
  }

  const fileRegex = /\b[A-Za-z0-9_.-]+\.[A-Za-z0-9]{2,12}\b/g;
  for (const match of text.matchAll(fileRegex)) {
    const candidate = match[0] || "";
    // Avoid matching common words that look like files but aren't
    if (!["don.t", "won.t", "can.t", "it.s"].includes(candidate.toLowerCase())) {
      addCandidate(candidate);
    }
  }

  // Plain token fallback: if token itself is an existing file/dir, include it.
  for (const rawToken of text.split(/\s+/)) {
    const token = rawToken.trim().replace(/^[("'`]+|[)"'`.,;:!?]+$/g, "");
    if (!token || token.startsWith("@")) continue;
    if (fs.existsSync(token)) out.add(token);
  }

  return out;
}

export function build(text: string, plan: boolean, fast = false, missionData?: MissionData, options?: BuildOptions): TaskPayload {
  const contextFiles: Array<Record<string, unknown>> = [];
  const imageFiles: Array<Record<string, unknown>> = [];
  const imageDescriptions: Array<Record<string, unknown>> = [];
  const imageErrors: string[] = [];
  const instructionParts: string[] = [];
  const referencedPaths: string[] = [];
  const seenPaths = new Set<string>();

  const extraFiles =
    missionData && typeof missionData === "object" && Array.isArray((missionData as Record<string, unknown>).auto_context_files)
      ? ((missionData as Record<string, unknown>).auto_context_files as string[])
      : [];

  extraFiles.forEach((filePath) => {
    if (fs.existsSync(filePath)) addPath(filePath, contextFiles, imageFiles, imageDescriptions, imageErrors, seenPaths);
  });

  for (const word of text.split(/\s+/)) {
    if (!word.startsWith("@")) {
      instructionParts.push(word);
      continue;
    }
    const candidate = word.slice(1);
    if (fs.existsSync(candidate)) {
      instructionParts.push(word);
      referencedPaths.push(candidate);
      addPath(candidate, contextFiles, imageFiles, imageDescriptions, imageErrors, seenPaths);
    } else {
      instructionParts.push(word);
    }
  }

  // Also attach file contents when user mentions file paths without @.
  const mentioned = collectMentionedPaths(text);
  for (const candidate of mentioned) {
    if (!referencedPaths.includes(candidate)) referencedPaths.push(candidate);
    addPath(candidate, contextFiles, imageFiles, imageDescriptions, imageErrors, seenPaths);
  }

  const instructionText = instructionParts.join(" ").trim();
  const low = instructionText.toLowerCase();
  const buildIntent =
    !plan &&
    [
      "build",
      "implement",
      "create",
      "scaffold",
      "make",
      "ship",
      "code",
      "write code",
      "generate files",
      "develop",
      "feature",
      "fix",
      "bug",
      "refactor",
    ].some((k) => low.includes(k));

  if (buildIntent && !referencedPaths.length) {
    const indexPath = path.join(process.cwd(), ".agent", "project_index.json");
    if (fs.existsSync(indexPath)) {
      try {
        const index = fs.readJsonSync(indexPath);
        // Find top 5 files that might be relevant based on text keywords
        const keywords = low.split(/\s+/).filter(w => w.length > 3);
        const candidates = index.files
          .map((f: any) => {
            let score = 0;
            keywords.forEach(k => { if (f.path.toLowerCase().includes(k)) score += 1; });
            return { ...f, score };
          })
          .filter((f: any) => f.score > 0)
          .sort((a: any, b: any) => b.score - a.score)
          .slice(0, 5);

        candidates.forEach((c: any) => {
          addPath(c.path, contextFiles, imageFiles, imageDescriptions, imageErrors, seenPaths);
        });
      } catch { /* ignore */ }
    }

    // Fallback to defaults if still empty or as base
    for (const candidate of ["AGENTS.md", "README.md", "README", "requirements.txt", "package.json"]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        addPath(candidate, contextFiles, imageFiles, imageDescriptions, imageErrors, seenPaths);
      }
    }
  }

  const seeMode = cfg.isSeeMode();
  const includeProjectMap = plan || seeMode;

  const payload: TaskPayload = {
    mode: plan ? "plan" : "apply",
    fast,
    instruction: instructionText,
    build_intent: buildIntent,
    referenced_paths: referencedPaths,
    execution_contract: {
      phase: plan ? "planning" : "implementation",
      must_use_changes_for_code: !plan && buildIntent,
      must_be_actionable_in_mission: Boolean(missionData && (missionData as Record<string, unknown>).is_mission),
      no_code_blocks_in_response_during_apply: !plan && buildIntent,
      if_missing_requirements: "Use request_files or ask_user instead of guessing.",
    },
    user_os: os.platform(),
    raw_input: text,
    effort_level: cfg.getEffortLevel(),
    reasoning_level: cfg.getReasoningLevel(),
    context_files: contextFiles,
    session_history: cfg.get("include_history", false) ? inject(45) : [],
    mission_data: missionData || null,
    project_map: includeProjectMap ? getProjectMap() : null,
    project_listing: seeMode ? getShellProjectListing() : null,
    image_files: imageFiles,
    image_descriptions: imageDescriptions,
    image_errors: imageErrors,
  };

  if (cfg.getActiveProvider() === "ollama") {
    const ollamaModel = cfg.getModel("ollama");
    const cachedContext = getOllamaSessionContext(ollamaModel);
    if (cachedContext.length) payload._ollama_context = cachedContext;
    if (options?.ollama_context_mode) payload.ollama_context_mode = options.ollama_context_mode;
    if (typeof options?.ollama_include_system === "boolean") payload.ollama_include_system = options.ollama_include_system;
    if (typeof options?.ollama_include_history === "boolean") payload.ollama_include_history = options.ollama_include_history;
  }

  return payload;
}

export async function buildContextFromPaths(paths: string[]) {
  const result: Record<string, string> = {};
  for (const p of paths) {
    try {
      result[p] = await fs.readFile(path.resolve(process.cwd(), p), "utf8");
    } catch (error) {
      result[p] = `ERROR: ${String(error)}`;
    }
  }
  return result;
}
type BuildOptions = {
  ollama_context_mode?: "cold" | "warm";
  ollama_include_system?: boolean;
  ollama_include_history?: boolean;
};
