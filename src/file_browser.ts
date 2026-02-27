import fs from "fs-extra";
import path from "path";

const IGNORE_DIRS = new Set([
  ".git",
  "venv",
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  ".vscode",
  "dist",
  "build",
  ".next",
  "out",
  ".idea",
  "coverage"
]);

export type ProjectFileEntry = {
  path: string;
  basename: string;
  segments: string[];
};

export async function listDir(relative = ".") {
  const p = path.resolve(process.cwd(), relative);
  return fs.readdir(p);
}

export async function readFile(relPath: string) {
  const p = path.resolve(process.cwd(), relPath);
  return fs.readFile(p, "utf8");
}

export async function tree(dir = ".", depth = 2) {
  const base = path.resolve(process.cwd(), dir);
  const out: string[] = [];

  async function walk(current: string, level: number) {
    if (level > depth) return;
    const entries = await fs.readdir(current);
    for (const entry of entries) {
      const full = path.join(current, entry);
      const stat = await fs.stat(full);
      out.push(path.relative(base, full) + (stat.isDirectory() ? "/" : ""));
      if (stat.isDirectory()) await walk(full, level + 1);
    }
  }
  await walk(base, 0);
  return out;
}

export function files() {
  const out: string[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      const rel = path.relative(process.cwd(), full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        out.push(`${rel}/`);
        walk(full);
      } else {
        out.push(rel);
      }
    }
  }

  walk(process.cwd());
  return out.sort();
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/");
}

function scanProjectFiles(rootDir = ".") {
  const root = path.resolve(process.cwd(), rootDir);
  const out: string[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      out.push(normalizePath(path.relative(root, full)));
    }
  }

  walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

export function getProjectFiles(rootDir = "."): ProjectFileEntry[] {
  return scanProjectFiles(rootDir).map((relPath) => {
    const normalized = normalizePath(relPath);
    const segments = normalized.split("/").filter(Boolean);
    return {
      path: normalized,
      basename: segments[segments.length - 1] || normalized,
      segments,
    };
  });
}

function isSubsequence(text: string, query: string) {
  if (!query) return false;
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i += 1) {
    if (text[i] === query[qi]) qi += 1;
  }
  return qi === query.length;
}

export function rankProjectFile(entry: ProjectFileEntry, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const filePath = entry.path.toLowerCase();
  const basename = entry.basename.toLowerCase();
  const segments = entry.segments.map((x) => x.toLowerCase());

  if (basename === q) return 500;
  if (segments.includes(q)) return 400;
  if (basename.startsWith(q) || filePath.startsWith(q)) return 300;
  if (isSubsequence(filePath, q) || isSubsequence(basename, q)) return 200;
  if (basename.includes(q) || filePath.includes(q)) return 100;
  return 0;
}

export function searchProjectFiles(entries: ProjectFileEntry[], query: string, limit = 300): ProjectFileEntry[] {
  const q = query.trim();
  if (!q) return entries.slice(0, Math.max(1, limit));

  const ranked = entries
    .map((entry) => ({ entry, score: rankProjectFile(entry, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.entry.path.length !== b.entry.path.length) return a.entry.path.length - b.entry.path.length;
      return a.entry.path.localeCompare(b.entry.path);
    });
  return ranked.slice(0, Math.max(1, limit)).map((x) => x.entry);
}
