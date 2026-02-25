import fs from "fs-extra";
import os from "os";
import path from "path";
import { registry } from "./registry";
import { cfg } from "../config";
import { clearScreen, printError, printInfo, printPanel, printSuccess, printWarning, console } from "../ui/console";
import logUpdate from "log-update";
import { listSessions, estimateTokens, load, compactSession } from "../memory";
import { undoLastApply } from "../applier";
import { printSessionStats } from "../ui/console";
import { intel } from "../core/intelligence";
let PREV_CWD = process.cwd();

const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  o1: 200000,
  "o1-mini": 128000,
  "o3-mini": 200000,
  "claude-sonnet-4-20250514": 200000,
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-5-haiku-20241022": 200000,
  "claude-3-opus-20240229": 200000,
  "gemini-2.5-pro-preview-06-05": 1048576,
  "gemini-2.5-flash-preview-05-20": 1048576,
  "gemini-2.0-flash": 1048576,
  "deepseek-chat": 64000,
  "deepseek-reasoner": 64000,
};

function estimateContextWindow(provider: string, model: string) {
  if (provider === "ollama") {
    const generation = (cfg.getProviderConfig("ollama").generation || {}) as Record<string, unknown>;
    return Number(generation.num_ctx || 32768);
  }
  return Number(MODEL_CONTEXT_WINDOWS[model] || 0);
}

registry.register("/help", "Show available commands")(async () => {
  const categories: Record<string, Set<string>> = {
    General: new Set(["/help", "/exit", "/cls", "/cd", "/read", "/ls", "/tree", "/undo", "/see"]),
    "AI & Context": new Set(["/model", "/provider", "/think", "/compact", "/cost", "/unlimited", "/status"]),
    "Git Integration": new Set(["/diff", "/review", "/commit", "/pr"]),
    "Intelligence & Ops": new Set(["/index", "/lint", "/scan", "/intel"]),
    Configuration: new Set(["/config"]),
    Modes: new Set(["/fast", "/plan", "/mission", "/voice"]),
    "Session & Dev": new Set(["/session", "/reset", "/mcp", "/debug", "/code", "/init"]),
    Runtime: new Set(["/checkpoint", "/resume", "/budget", "/ps", "/kill"]),
  };

  const byName = new Map(registry.listCommands().map(([name, desc]) => [name, desc]));
  const aliasesByCmd = new Map<string, string[]>();
  for (const [alias, cmd] of registry.listAliases()) {
    if (!aliasesByCmd.has(cmd)) aliasesByCmd.set(cmd, []);
    aliasesByCmd.get(cmd)?.push(alias);
  }

  const grouped = new Map<string, Array<[string, string]>>();
  for (const [cmd, desc] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let bucket = "Other";
    for (const [category, names] of Object.entries(categories)) {
      if (names.has(cmd)) {
        bucket = category;
        break;
      }
    }
    if (!grouped.has(bucket)) grouped.set(bucket, []);
    grouped.get(bucket)?.push([cmd, desc]);
  }

  let text = "# Agent CLI - Command Reference\n\n_Auto-generated from the command registry._\n\n";
  for (const category of ["General", "AI & Context", "Git Integration", "Configuration", "Modes", "Session & Dev", "Runtime", "Other"]) {
    const rows = grouped.get(category) || [];
    if (!rows.length) continue;
    text += `## ${category}\n`;
    for (const [cmd, desc] of rows) {
      const aliases = (aliasesByCmd.get(cmd) || []).sort();
      const aliasSuffix = aliases.length ? ` (aliases: ${aliases.map((a) => `\`${a}\``).join(", ")})` : "";
      text += `- \`${cmd}\`: ${desc}${aliasSuffix}\n`;
    }
    text += "\n";
  }
  text += "## Shell\n- `!<command>`: Execute shell commands inline (e.g., `!git status`)\n\n";
  text += "## Project\n- **AGENTS.md**: Place in project root for custom instructions\n";
  printPanel(text, "Agent CLI - Help", "blue", true);
  return true;
});

registry.register("/commands", "Search/list commands. Usage: /commands [query]")((_, args) => {
  const query = String(args.slice(1).join(" ") || "").trim().toLowerCase();
  const commands = registry.listCommands();
  const aliases = registry.listAliases();
  const aliasByCommand = new Map<string, string[]>();
  for (const [alias, command] of aliases) {
    if (!aliasByCommand.has(command)) aliasByCommand.set(command, []);
    aliasByCommand.get(command)?.push(alias);
  }

  const rows = commands
    .filter(([name, desc]) => {
      if (!query) return true;
      if (name.toLowerCase().includes(query)) return true;
      if (desc.toLowerCase().includes(query)) return true;
      return (aliasByCommand.get(name) || []).some((a) => a.toLowerCase().includes(query));
    })
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (!rows.length) {
    printWarning(`No commands matched: ${query}`);
    return true;
  }

  const text = rows
    .map(([name, desc]) => {
      const a = (aliasByCommand.get(name) || []).sort();
      const aliasText = a.length ? ` (aliases: ${a.map((x) => `\`${x}\``).join(", ")})` : "";
      return `- \`${name}\`: ${desc}${aliasText}`;
    })
    .join("\n");
  printPanel(text, query ? `Commands matching "${query}"` : "All Commands", "blue", true);
  return true;
});

registry.register("/exit", "Exit the agent", ["/quit"])(() => {
  process.exit(0);
});

registry.register("/cls", "Clear the terminal screen", ["/clear_screen"])(() => {
  clearScreen();
  return true;
});

registry.register("/donut", "Show an animated donut and exit")(
  async () => {
    printInfo("You found my little secret... Hmm I don't know what to do with this donut. WAIT WHY  ARE YOU HERE .... goodbye! 🍩");
    const frames = [
      "   ***   \n *     * \n*  o o  *\n*   -   *\n *     * \n   ***   ",
      "   ***   \n *     * \n*  o o  *\n*   ~   *\n *     * \n   ***   ",
      "   ***   \n *     * \n*  o o  *\n*   _   *\n *     * \n   ***   ",
      "   ***   \n *     * \n*  o o  *\n*   -   *\n *     * \n   ***   ",
    ];
    for (let i = 0; i < 180; i += 1) {
      logUpdate(frames[i % frames.length]);
      await new Promise((resolve) => setTimeout(resolve, 90));
    }
    logUpdate.clear();
    process.exit(0);
  },
);

registry.register("/index", "Perform a deep scan and index the project for scalable context management")(async () => {
  printInfo("Starting deep project scan...");
  const result = await intel.indexProject();
  printSuccess(result);
  return true;
});

registry.register("/scan", "Perform a detailed project structure scan without indexing")(async () => {
  printInfo("Scanning project structure...");
  const result = intel.getDetailedStructure(".");
  printPanel(result, "Project Structure Scan", "blue");
  return true;
});

registry.register("/compact", "Compact the current session history to save context space")(() => {
  const keepRecent = Number(cfg.get("auto_compact_keep_recent_turns", 8));
  const result = compactSession(undefined, keepRecent, 24);
  printSuccess(result);
  return true;
});

registry.register("/intel", "Show the current status of the agent's project mapping and intelligence")(() => {
  const indexPath = path.join(process.cwd(), ".agent", "project_index.json");
  const indexed = fs.existsSync(indexPath);
  let detail = "No project index found. Run /index to scan.";
  if (indexed) {
    const data = fs.readJsonSync(indexPath);
    detail = `Index Timestamp: ${data.timestamp}\nFiles Tracked: ${data.files.length}`;
  }
  printPanel(detail, "Agent Intelligence Status", "cyan");
  return true;
});

import { lintProject } from "../core/tools";

registry.register("/lint", "Run the configured project lint/verification command")(() => {
  printInfo("Running project verification...");
  lintProject().then(res => {
    if (res.includes("Passed")) printSuccess(res);
    else printError(res);
  });
  return true;
});

registry.register("/cd", "Change current working directory")((_, args) => {
  if (args.length < 2) {
    printPanel(`Current Directory: ${process.cwd()}`, "Directory Info", "blue");
    return true;
  }
  const rawArg = args.slice(1).join(" ").trim();
  const unquoted = rawArg.replace(/^["']|["']$/g, "");
  const target = (() => {
    if (unquoted === "-") return PREV_CWD;
    if (unquoted === "~") return os.homedir();
    if (unquoted.startsWith("~/") || unquoted.startsWith("~\\")) {
      return path.join(os.homedir(), unquoted.slice(2));
    }
    return unquoted;
  })();
  try {
    const resolved = path.resolve(process.cwd(), target);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      printError(`Directory not found: ${target}`);
      return true;
    }
    const before = process.cwd();
    process.chdir(resolved);
    PREV_CWD = before;

    const preview = fs
      .readdirSync(process.cwd(), { withFileTypes: true })
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, 12)
      .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
      .join("\n");
    printPanel(
      `Now in: \`${process.cwd()}\`\nPrevious: \`${PREV_CWD}\`\n\n${preview || "(empty directory)"}`,
      "Directory Changed",
      "green",
      true,
    );
  } catch (error) {
    printError(`Failed to change directory: ${String(error)}`);
  }
  return true;
});

registry.register("/think", "Toggle extended thinking mode")(() => {
  const current = Boolean(cfg.get("think_mode", false));
  cfg.set("think_mode", !current);
  const state = current ? "OFF" : "ON";
  if (!current) {
    printSuccess(`Extended thinking: ${state} - AI will reason more deeply before responding.`);
  } else {
    printInfo(`Extended thinking: ${state}`);
  }
  return true;
});

registry.register("/cost", "Show session token usage, cost, and time", ["/stats"])(() => {
  const provider = cfg.getActiveProvider();
  const model = cfg.getModel(provider);
  const data = load();
  const session = data.session || [];
  const contextUsed = session.reduce((acc, msg) => acc + estimateTokens(msg.content || ""), 0);
  const contextWindow = estimateContextWindow(provider, model);
  const contextLeft = contextWindow > 0 ? Math.max(contextWindow - contextUsed, 0) : null;
  const { SESSION_STATS } = require("../core/agent");
  const stats = {
    ...SESSION_STATS,
    provider,
    model,
    context_used: contextUsed,
    context_window: contextWindow || null,
    context_left: contextLeft,
  };
  printSessionStats(stats);
  return true;
});

registry.register("/read", "Read a file into the console")((_, args) => {
  if (args.length < 2) {
    printError("Usage: /read <path>");
    return true;
  }
  const p = args.slice(1).join(" ");
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    printError(`File not found: ${p}`);
    return true;
  }
  try {
    let raw = fs.readFileSync(p);
    if (raw.subarray(0, 1024).includes(0)) {
      printError("Binary file detected; not displaying.");
      return true;
    }
    const maxBytes = 200_000;
    let truncated = false;
    if (raw.length > maxBytes) {
      raw = raw.subarray(0, maxBytes);
      truncated = true;
    }
    let content = raw.toString("utf8");
    if (truncated) content += "\n\n... (truncated)";
    printPanel(content, p, "cyan");
  } catch (error) {
    printError(`Failed to read file: ${String(error)}`);
  }
  return true;
});

registry.register("/ls", "List directory contents")((_, args) => {
  const target = args.length > 1 ? args.slice(1).join(" ") : ".";
  const p = path.resolve(process.cwd(), target);
  if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
    printError(`Directory not found: ${target}`);
    return true;
  }
  const items = fs
    .readdirSync(p, { withFileTypes: true })
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
  printPanel(items.length ? items.join("\n") : "(empty)", p, "cyan");
  return true;
});

registry.register("/tree", "Recursive file list")((_, args) => {
  const target = args.length > 1 ? args.slice(1).join(" ") : ".";
  const root = path.resolve(process.cwd(), target);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    printError(`Directory not found: ${target}`);
    return true;
  }
  const ignore = new Set([".git", "venv", "node_modules", "__pycache__", ".pytest_cache", ".vscode", "dist", "build"]);
  const lines: string[] = [];
  const walk = (dirPath: string) => {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory() && ignore.has(entry.name)) continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        lines.push(path.relative(root, full).replace(/\\/g, "/"));
      }
      if (lines.length > 5000) return;
    }
  };
  walk(root);
  let content = lines.join("\n");
  if (lines.length > 5000) content += `\n... (truncated ${lines.length - 5000} lines)`;
  printPanel(content || "(no files)", root, "cyan");
  return true;
});

registry.register("/undo", "Undo last applied file change batch")(() => {
  if (undoLastApply()) printSuccess("Reverted last applied changes.");
  else printInfo("Nothing to undo.");
  return true;
});

registry.register("/see", "Toggle full-project scan mode for the agent")((_, args) => {
  if (args.length < 2) {
    printInfo(`See project mode: ${cfg.isSeeMode() ? "ON" : "OFF"}`);
    return true;
  }
  const value = args[1].toLowerCase();
  if (["on", "enable", "true", "1"].includes(value)) {
    cfg.setSeeMode(true);
    printSuccess("See project mode: ON");
  } else if (["off", "disable", "false", "0"].includes(value)) {
    cfg.setSeeMode(false);
    printInfo("See project mode: OFF");
  } else {
    printError("Usage: /see [on|off]");
  }
  return true;
});

export function registerCore() {
  return true;
}
