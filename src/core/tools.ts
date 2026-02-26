import fs from "fs-extra";
import path from "path";
import { search, searchNews } from "duck-duck-scrape";
import { spawnSync } from "child_process";
import type { SearchCitation } from "../types";

const IGNORE_DIRS = new Set([
  ".git", "venv", "node_modules", "__pycache__", ".pytest_cache", ".vscode",
  "dist", "build", ".idea", ".next", ".expo", "out", "target", ".cache"
]);
const MAX_PROJECT_RESULTS = 50;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractTitle(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return "Unknown";
  return decodeHtmlEntities(m[1].replace(/\s+/g, " ").trim()) || "Unknown";
}

function extractReadableText(html: string, maxChars: number) {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  const bodyMatch = withoutScripts.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch?.[1] || withoutScripts;

  let text = body
    .replace(/<\/(p|div|article|section|h1|h2|h3|h4|h5|h6|li|tr|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  text = decodeHtmlEntities(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 5)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  if (text.length > maxChars) return `${text.slice(0, maxChars)}\n\n... (content truncated for length)`;
  return text;
}

export async function webBrowse(urls: string[] | string) {
  const list = Array.isArray(urls) ? urls : [urls];
  const MAX_BROWSE_CHARS = 15000;

  const tasks = list.map(async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        return `### Browse Report: ${url}\nError: HTTP ${response.status} ${response.statusText}`;
      }
      const html = await response.text();
      const title = extractTitle(html);
      const content = extractReadableText(html, MAX_BROWSE_CHARS);
      if (!content) {
        return `### Browse Report: ${url}\nFailed to extract readable content from this page.`;
      }
      return `### Browse Report: ${url}\nTitle: ${title}\n\n${content}`;
    } catch (error) {
      return `### Browse Report: ${url}\nError browsing: ${String(error)}`;
    }
  });
  return (await Promise.all(tasks)).join("\n\n---\n\n");
}

export async function webSearch(queries: string[] | string, searchType: "text" | "news" = "text", limit = 10) {
  const structured = await webSearchStructured(queries, searchType, limit);
  return formatSearchCitations(structured, searchType);
}

export async function webSearchStructured(queries: string[] | string, searchType: "text" | "news" = "text", limit = 10) {
  const list = Array.isArray(queries) ? queries : [queries];
  const maxResults = Math.min(Math.max(limit, 1), 20);
  const out: Record<string, SearchCitation[]> = {};

  const tasks = list.map(async (query) => {
    try {
      const results = searchType === "news" ? await searchNews(query) : await search(query, { safeSearch: 0 });
      const items = (results as any).results || [];
      if (!items.length) {
        out[query] = [];
        return;
      }

      const deduped: any[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const href = String(item?.url || item?.href || "").trim();
        const title = String(item?.title || "").trim();
        const key = `${href}::${title}`.toLowerCase();
        if (!href || seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }

      out[query] = deduped.slice(0, maxResults).map((item: any, idx: number) => ({
        index: idx + 1,
        title: String(item?.title || "No Title").trim(),
        url: String(item?.url || item?.href || "No URL").trim(),
        snippet: String(item?.description || item?.body || item?.snippet || item?.excerpt || "No snippet available.").trim(),
        source: item?.source ? String(item.source).trim() : undefined,
        date: item?.date ? String(item.date).trim() : undefined,
      }));
    } catch (error) {
      out[query] = [
        {
          index: 1,
          title: "Search error",
          url: "",
          snippet: String(error),
        },
      ];
    }
  });
  await Promise.all(tasks);
  return out;
}

export function formatSearchCitations(
  grouped: Record<string, SearchCitation[]>,
  searchType: "text" | "news" = "text",
) {
  const chunks: string[] = [];
  for (const [query, citations] of Object.entries(grouped)) {
    if (!citations.length) {
      chunks.push(`### Search Results for: ${query} (${searchType})\nNo results found.`);
      continue;
    }
    let block = `### Search Results for: ${query} (${searchType})\n\n`;
    citations.forEach((citation) => {
      const date = citation.date ? ` [${citation.date}]` : "";
      const source = citation.source ? `\n   - Source: ${citation.source}` : "";
      block += `${citation.index}. **${citation.title}**${date}\n   - URL: ${citation.url}${source}\n   - Snippet: ${citation.snippet}\n\n`;
    });
    chunks.push(block.trimEnd());
  }
  return chunks.join("\n\n---\n\n");
}

function isBinary(filePath: string) {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(1024);
  const size = fs.readSync(fd, buf, 0, 1024, 0);
  fs.closeSync(fd);
  return buf.slice(0, size).includes(0);
}

export function searchProject(pattern: string) {
  const trimmed = String(pattern || "").trim();
  if (!trimmed) return "No results found for ''.";
  const cwd = process.cwd();

  // Prefer ripgrep for speed and better relevance if available.
  const rgGlobs: string[] = [];
  for (const dir of IGNORE_DIRS) {
    rgGlobs.push("--glob", `!**/${dir}/**`);
  }
  const rgArgs = [
    "-n",
    "--no-heading",
    "--color",
    "never",
    "--max-count",
    String(MAX_PROJECT_RESULTS + 20),
    "--max-filesize",
    "2M",
    ...rgGlobs,
    "-i",
    "-S",
    trimmed,
    ".",
  ];
  const rg = spawnSync("rg", rgArgs, { encoding: "utf8", cwd });
  if (!rg.error) {
    const lines = String(rg.stdout || "")
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, MAX_PROJECT_RESULTS);
    if (lines.length) return lines.join("\n");
    if (rg.status === 1) return `No results found for '${trimmed}'.`;
  }

  const results: string[] = [];
  let regex: RegExp | null = null;
  try {
    regex = new RegExp(trimmed, "i");
  } catch {
    regex = null;
  }

  const stack: string[] = [cwd];

  while (stack.length && results.length <= MAX_PROJECT_RESULTS) {
    const dirPath = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        stack.push(full);
        continue;
      }

      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        if (st.size > MAX_FILE_BYTES) continue;
        if (isBinary(full)) continue;
        const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
        for (let idx = 0; idx < lines.length; idx += 1) {
          const line = lines[idx];
          const content = line.trim();
          const matched = regex ? regex.test(content) : content.toLowerCase().includes(trimmed.toLowerCase());
          if (matched) {
            const rel = path.relative(cwd, full).replace(/\\/g, "/");
            results.push(`${rel}:${idx + 1}: ${content}`);
            if (results.length > MAX_PROJECT_RESULTS) break;
          }
        }
        if (results.length > MAX_PROJECT_RESULTS) break;
      } catch {
        // ignore
      }
    }
  }

  if (!results.length) return `No results found for '${trimmed}'.`;
  if (results.length > MAX_PROJECT_RESULTS) return `${results.slice(0, MAX_PROJECT_RESULTS).join("\n")}\n... (truncated)`;
  return results.join("\n");
}

import { intel } from "./intelligence";

export async function indexProject() {
  const result = await intel.indexProject();
  return result;
}

import { execSync } from "child_process";
import { cfg } from "../config";

export async function lintProject() {
  const cmd = cfg.get("lint_command", "npm run lint");
  try {
    const out = execSync(cmd, { encoding: "utf8", stdio: "pipe" });
    return `Lint Passed:\n${out}`;
  } catch (error: any) {
    return `Lint Failed:\n${error.stdout || ""}\n${error.stderr || ""}`;
  }
}
