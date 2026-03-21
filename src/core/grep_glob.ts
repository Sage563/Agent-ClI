/**
 * Grep and Glob tools for AI-directed codebase search.
 */
import fs from "fs-extra";
import path from "path";
import { spawnSync } from "child_process";

const IGNORE_DIRS = new Set([
    ".git", "venv", "node_modules", "__pycache__", ".pytest_cache", ".vscode",
    "dist", "build", ".idea", ".next", ".expo", "out", "target", ".cache",
]);

const MAX_RESULTS = 100;
const MAX_LINE_LENGTH = 500;

interface GrepMatch {
    file: string;
    line: number;
    content: string;
}

interface GrepOptions {
    include?: string;   // file pattern filter, e.g. "*.ts"
    maxResults?: number;
    caseSensitive?: boolean;
}

/**
 * Search files using regex pattern. Uses ripgrep if available, falls back to manual search.
 */
export function grepProject(pattern: string, options: GrepOptions = {}): GrepMatch[] {
    const maxResults = options.maxResults || MAX_RESULTS;

    // Try ripgrep first (much faster)
    try {
        const rgArgs = [
            "--json",
            "--max-count", String(maxResults),
            pattern,
        ];
        if (!options.caseSensitive) rgArgs.unshift("-i");
        if (options.include) rgArgs.push("--glob", options.include);
        for (const dir of IGNORE_DIRS) rgArgs.push("--glob", `!${dir}`);

        const result = spawnSync("rg", rgArgs, {
            cwd: process.cwd(),
            encoding: "utf8",
            timeout: 30000,
            stdio: ["ignore", "pipe", "pipe"],
        });

        if (result.status === 0 && result.stdout) {
            const matches: GrepMatch[] = [];
            for (const line of result.stdout.split("\n")) {
                if (!line.trim()) continue;
                try {
                    const entry = JSON.parse(line);
                    if (entry.type === "match" && entry.data?.submatches?.length) {
                        matches.push({
                            file: entry.data.path?.text || "",
                            line: entry.data.line_number || 0,
                            content: (entry.data.lines?.text || "").trimEnd().slice(0, MAX_LINE_LENGTH),
                        });
                    }
                } catch { /* skip malformed lines */ }
                if (matches.length >= maxResults) break;
            }
            return matches;
        }
    } catch { /* ripgrep not available, fall back */ }

    // Fallback: manual recursive search
    const matches: GrepMatch[] = [];
    const regex = new RegExp(pattern, options.caseSensitive ? "g" : "gi");
    const includeRegex = options.include
        ? new RegExp(options.include.replace(/\*/g, ".*").replace(/\?/g, "."), "i")
        : null;

    function walk(dir: string) {
        if (matches.length >= maxResults) return;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch { return; }

        for (const entry of entries) {
            if (matches.length >= maxResults) return;
            if (entry.name.startsWith(".") && IGNORE_DIRS.has(entry.name)) continue;
            if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;

            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile()) {
                if (includeRegex && !includeRegex.test(entry.name)) continue;
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.size > 1024 * 1024) continue; // Skip files > 1MB
                    const raw = fs.readFileSync(fullPath);
                    if (raw.subarray(0, 512).includes(0)) continue; // Skip binary
                    const text = raw.toString("utf8");
                    const lines = text.split("\n");
                    for (let i = 0; i < lines.length; i++) {
                        if (matches.length >= maxResults) return;
                        if (regex.test(lines[i])) {
                            matches.push({
                                file: path.relative(process.cwd(), fullPath).replace(/\\/g, "/"),
                                line: i + 1,
                                content: lines[i].trimEnd().slice(0, MAX_LINE_LENGTH),
                            });
                        }
                        regex.lastIndex = 0;
                    }
                } catch { /* skip unreadable files */ }
            }
        }
    }

    walk(process.cwd());
    return matches;
}

/**
 * Format grep results for the AI.
 */
export function formatGrepResults(matches: GrepMatch[]): string {
    if (!matches.length) return "No matches found.";
    const lines = matches.map((m) => `${m.file}:${m.line}: ${m.content}`);
    let result = lines.join("\n");
    if (matches.length >= MAX_RESULTS) {
        result += `\n\n(Results capped at ${MAX_RESULTS} matches)`;
    }
    return result;
}

/**
 * Find files matching a glob pattern, sorted by modification time (newest first).
 */
export function globFiles(pattern: string, maxResults = 50): string[] {
    const results: Array<{ file: string; mtime: number }> = [];

    // Try using the system find/fd if available
    try {
        const isWindows = process.platform === "win32";
        const args = isWindows
            ? ["--type", "f", "--glob", pattern, "--max-results", String(maxResults * 2)]
            : ["--type", "f", "--glob", pattern, "--max-results", String(maxResults * 2)];
        for (const dir of IGNORE_DIRS) {
            args.push("--exclude", dir);
        }

        const result = spawnSync("fd", args, {
            cwd: process.cwd(),
            encoding: "utf8",
            timeout: 15000,
            stdio: ["ignore", "pipe", "pipe"],
        });

        if (result.status === 0 && result.stdout) {
            for (const line of result.stdout.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const stat = fs.statSync(path.resolve(process.cwd(), trimmed));
                    results.push({ file: trimmed, mtime: stat.mtimeMs });
                } catch { results.push({ file: trimmed, mtime: 0 }); }
            }
        }
    } catch { /* fd not available, fall back */ }

    // Fallback: manual walk with simple glob matching
    if (!results.length) {
        const globRegex = new RegExp(
            "^" + pattern
                .replace(/\*\*/g, "<<GLOBSTAR>>")
                .replace(/\*/g, "[^/\\\\]*")
                .replace(/\?/g, "[^/\\\\]")
                .replace(/<<GLOBSTAR>>/g, ".*") + "$",
            "i",
        );

        function walk(dir: string) {
            if (results.length >= maxResults * 2) return;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch { return; }

            for (const entry of entries) {
                if (results.length >= maxResults * 2) return;
                if (IGNORE_DIRS.has(entry.name)) continue;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else if (entry.isFile()) {
                    const rel = path.relative(process.cwd(), fullPath).replace(/\\/g, "/");
                    if (globRegex.test(rel) || globRegex.test(entry.name)) {
                        try {
                            const stat = fs.statSync(fullPath);
                            results.push({ file: rel, mtime: stat.mtimeMs });
                        } catch { results.push({ file: rel, mtime: 0 }); }
                    }
                }
            }
        }

        walk(process.cwd());
    }

    // Sort by modification time (newest first)
    results.sort((a, b) => b.mtime - a.mtime);
    return results.slice(0, maxResults).map((r) => r.file);
}

/**
 * Format glob results for the AI.
 */
export function formatGlobResults(files: string[]): string {
    if (!files.length) return "No files found matching the pattern.";
    return files.join("\n");
}
