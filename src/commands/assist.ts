import path from "path";
import { registry } from "./registry";
import { printError, printInfo, printPanel } from "../ui/console";

type AssistAction = "explain" | "fix" | "tests" | "docs" | "review" | "commit";

const ACTIONS: AssistAction[] = ["explain", "fix", "tests", "docs", "review", "commit"];

function usageText() {
  return [
    "Copilot-inspired assistant actions:",
    "- /assist explain <target>",
    "- /assist fix <target>",
    "- /assist tests <target>",
    "- /assist docs <target>",
    "- /assist review <target>",
    "- /assist commit <summary>",
  ].join("\n");
}

function normalizeTarget(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "the current task";
  return text
    .split(/\s+/)
    .map((token) => {
      if (!token.startsWith("@")) return token;
      const rel = token.slice(1).replace(/\\/g, "/");
      const abs = path.resolve(process.cwd(), rel);
      return `file \`${rel}\` (${abs})`;
    })
    .join(" ");
}

function promptFor(action: AssistAction, targetRaw: string) {
  const target = normalizeTarget(targetRaw);
  if (action === "explain") return `Explain ${target} clearly. Include architecture and risks.`;
  if (action === "fix") return `Diagnose and fix ${target}. Keep edits minimal and safe.`;
  if (action === "tests") return `Create or improve tests for ${target}. Cover edge cases.`;
  if (action === "docs") return `Write concise developer docs for ${target} with examples.`;
  if (action === "review") return `Review ${target} with a code-review mindset. Prioritize bugs and regressions.`;
  return `Write a conventional commit message for ${target}. Include title and bullet body.`;
}

registry.register("/assist", "Copilot-inspired quick actions: explain, fix, tests, docs, review, commit")(
  async (_, args) => {
    const actionRaw = String(args[1] || "").toLowerCase();
    if (!actionRaw || actionRaw === "help") {
      printPanel(usageText(), "Assist Actions", "cyan", true);
      return true;
    }
    if (!ACTIONS.includes(actionRaw as AssistAction)) {
      printError(`Unknown assist action: ${actionRaw}`);
      printInfo("Use `/assist help` for usage.");
      return true;
    }

    const target = args.slice(2).join(" ").trim();
    if (!target) {
      printError(`Usage: /assist ${actionRaw} <target>`);
      return true;
    }

    const { handle } = await import("../core/agent");
    printInfo(`Assist mode: ${actionRaw}`);
    await handle(promptFor(actionRaw as AssistAction, target), { yes: false, fast: false, plan: false });
    return true;
  },
);

export function registerAssist() {
  return true;
}