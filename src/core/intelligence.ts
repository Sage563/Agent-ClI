import fs from "fs-extra";
import path from "path";

const IGNORE_DIRS = new Set([".git", "venv", "node_modules", "__pycache__", ".pytest_cache", ".vscode", "dist", "build"]);
const ALLOWED_EXT = [".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".go", ".rs", ".html", ".css"];

export class ProjectIntel {
  getDetailedStructure(startPath = ".") {
    const base = path.resolve(process.cwd(), startPath);
    const out: string[] = [];

    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          walk(path.join(current, entry.name));
          continue;
        }
        const full = path.join(current, entry.name);
        try {
          const sizeKb = fs.statSync(full).size / 1024;
          out.push(`${path.relative(base, full).replace(/\\/g, "/")} (${sizeKb.toFixed(1)} KB)`);
        } catch {
          // ignore
        }
      }
    };

    walk(base);
    return out.join("\n");
  }

  findSymbol(symbolName: string, startPath = ".", isRegex = false) {
    const query = (symbolName || "").trim();
    if (!query) return "No symbol provided.";

    let regex: RegExp;
    if (isRegex) {
      try {
        regex = new RegExp(query);
      } catch (error) {
        return `Invalid regex '${query}': ${String(error)}`;
      }
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      regex = new RegExp(
        [
          `class\\s+${escaped}\\b`,
          `def\\s+${escaped}\\b`,
          `function\\s+${escaped}\\b`,
          `(const|let|var)\\s+${escaped}\\s*=`,
          `\\b${escaped}\\b`,
        ].join("|"),
      );
    }

    const base = path.resolve(process.cwd(), startPath);
    const matches: string[] = [];
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          walk(full);
          continue;
        }
        if (!ALLOWED_EXT.some((ext) => entry.name.endsWith(ext))) continue;
        try {
          const content = fs.readFileSync(full, "utf8").split(/\r?\n/);
          content.forEach((line, idx) => {
            if (regex.test(line)) {
              matches.push(`${full}:${idx + 1}: ${line.trim()}`);
            }
          });
          if (matches.length >= 200) return;
        } catch {
          // ignore
        }
      }
    };

    walk(base);
    if (!matches.length) {
      return `No matches found for ${isRegex ? "regex" : "symbol"} '${query}'.`;
    }
    const header = `Query: ${isRegex ? "regex" : "symbol"}='${query}'`;
    return `${header}\n${matches.slice(0, 200).join("\n")}${matches.length > 200 ? "\n... (truncated)" : ""}`;
  }

  async indexProject(startPath = ".") {
    const base = path.resolve(process.cwd(), startPath);
    const index: Record<string, any> = {
      root: base,
      timestamp: new Date().toISOString(),
      files: [],
    };

    const walk = (current: string) => {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(current, entry.name);
        const rel = path.relative(base, full).replace(/\\/g, "/");

        if (entry.isDirectory()) {
          if (IGNORE_DIRS.has(entry.name)) continue;
          walk(full);
        } else if (ALLOWED_EXT.some((ext) => entry.name.endsWith(ext))) {
          try {
            const stats = fs.statSync(full);
            index.files.push({
              path: rel,
              size: stats.size,
              mtime: stats.mtime,
            });
          } catch {
            /* ignore */
          }
        }
      }
    };

    walk(base);
    const indexPath = path.join(process.cwd(), ".agent", "project_index.json");
    fs.ensureDirSync(path.dirname(indexPath));
    fs.writeJsonSync(indexPath, index, { spaces: 2 });
    return `Indexed ${index.files.length} files. Saved to .agent/project_index.json`;
  }
}

export const intel = new ProjectIntel();
