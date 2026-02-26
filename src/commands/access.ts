import path from "path";
import { registry } from "./registry";
import { printError, printInfo, printPanel, printSuccess, printWarning } from "../ui/console";
import {
  ensureSessionAccessMode,
  getSessionAccessGrant,
  resetSessionAccessGrant,
  setSelectivePathDecision,
  setSessionAccessMode,
} from "../core/session_access";
import { readCommandLogs } from "../core/command_runner";
import { eventBus } from "../core/events";
import { formatSearchCitations, webSearchStructured } from "../core/tools";

registry.register("/access", "Review or change session file access mode")(
  async (_, args) => {
    const sub = String(args[1] || "status").trim().toLowerCase();

    if (sub === "status") {
      const grant = getSessionAccessGrant();
      const lines = [
        `Mode: **${grant.mode}**`,
        `Allowed paths: ${grant.allowlist.length}`,
        `Denied paths: ${grant.denylist.length}`,
      ];
      if (grant.allowlist.length) {
        lines.push("", "Allowed:");
        lines.push(...grant.allowlist.slice(0, 20).map((x) => `- \`${path.relative(process.cwd(), x).replace(/\\/g, "/")}\``));
      }
      if (grant.denylist.length) {
        lines.push("", "Denied:");
        lines.push(...grant.denylist.slice(0, 20).map((x) => `- \`${path.relative(process.cwd(), x).replace(/\\/g, "/")}\``));
      }
      printPanel(lines.join("\n"), "Session Access", "yellow", true);
      return true;
    }

    if (sub === "prompt") {
      const mode = await ensureSessionAccessMode();
      printSuccess(`Session access set to: ${mode}`);
      return true;
    }

    if (sub === "full") {
      setSessionAccessMode("full");
      printSuccess("Session access mode: full");
      return true;
    }

    if (sub === "selective") {
      setSessionAccessMode("selective");
      printSuccess("Session access mode: selective");
      return true;
    }

    if (sub === "reset") {
      resetSessionAccessGrant();
      printInfo("Session access reset. You will be prompted on the next file action.");
      return true;
    }

    if (sub === "allow" || sub === "deny") {
      const target = args.slice(2).join(" ").trim();
      if (!target) {
        printError(`Usage: /access ${sub} <file-path>`);
        return true;
      }
      setSelectivePathDecision([target], sub === "allow");
      printSuccess(`${sub === "allow" ? "Allowed" : "Denied"} path: ${target}`);
      return true;
    }

    printWarning("Usage: /access [status|prompt|full|selective|reset|allow <path>|deny <path>]");
    return true;
  },
);

registry.register("/logs", "Show recent command/event execution logs")(
  (_, args) => {
    const limitRaw = Number(args[1] || 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 10;
    const commands = readCommandLogs(limit);
    const events = eventBus.getRecent(limit);

    let content = "## Commands\n";
    if (!commands.length) {
      content += "- No command logs found for current day.\n";
    } else {
      for (const record of commands) {
        const stamp = new Date(record.ended_at).toISOString();
        content += `- ${stamp} | \`${record.command}\` | exit=${record.exit_code} | ${record.success ? "SUCCESS" : "FAIL"} | ${record.duration_ms}ms\n`;
      }
    }

    content += "\n## Events\n";
    if (!events.length) {
      content += "- No execution events captured yet.\n";
    } else {
      for (const event of events) {
        const stamp = new Date(event.timestamp).toISOString();
        content += `- ${stamp} | ${event.phase} | ${event.message}\n`;
      }
    }

    printPanel(content, "Execution Logs", "cyan", true);
    return true;
  },
);

registry.register("/search", "Run web search with visible citations. Usage: /search <query>")(
  async (_, args) => {
    const query = args.slice(1).join(" ").trim();
    if (!query) {
      printError("Usage: /search <query>");
      return true;
    }
    const grouped = await webSearchStructured(query, "text", 8);
    const rendered = formatSearchCitations(grouped, "text");
    printPanel(rendered, "Web Search Results", "yellow", true);
    return true;
  },
);

