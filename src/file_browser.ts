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
