import { execSync } from "child_process";
import { registry } from "./registry";
import { printError, printInfo, printPanel } from "../ui/console";

function runGit(command: string): [boolean, string] {
  try {
    const output = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
    return [true, output.trim()];
  } catch (error: any) {
    const stderr = String(error?.stderr || error?.message || "").trim();
    const stdout = String(error?.stdout || "").trim();
    return [false, stdout || stderr || "Command failed"];
  }
}

registry.register("/diff", "Show current git diff with syntax highlighting")((_, args) => {
  const target = args[1] || "";
  const [ok, output] = runGit(`git diff ${target}`);
  if (!ok || !output) {
    printInfo("No changes detected (working tree clean).");
    return true;
  }
  printPanel(`\`\`\`diff\n${output}\n\`\`\``, "Git Diff", "cyan");
  return true;
});

registry.register("/review", "AI-powered code review of current changes")(async () => {
  let [, diffOutput] = runGit("git diff");
  if (!diffOutput) {
    [, diffOutput] = runGit("git diff --staged");
  }
  if (!diffOutput) {
    printInfo("No changes to review.");
    return true;
  }
  printInfo(`Reviewing ${diffOutput.length} bytes of changes...`);
  const { handle } = await import("../core/agent");
  await handle(
    [
      "Please review the following git diff. Provide a concise code review with:",
      "1. A brief summary of changes",
      "2. Potential bugs or issues",
      "3. Suggestions for improvement",
      "4. Security concerns if any",
      "",
      "```diff",
      diffOutput.slice(0, 8000),
      "```",
    ].join("\n"),
    { yes: false, fast: false, plan: false },
  );
  return true;
});

registry.register("/commit", "Auto-generate commit message and commit staged changes")(async () => {
  const [, staged] = runGit("git diff --staged --stat");
  if (!staged) {
    printInfo("No staged changes. Stage files first with `git add`.");
    return true;
  }

  const [, diffOutput] = runGit("git diff --staged");
  printInfo("Generating commit message...");
  const { handle } = await import("../core/agent");
  await handle(
    [
      "Based on this git diff, generate ONLY a concise, conventional commit message",
      "(no explanation, just the message). Use conventional commits format",
      "(e.g., feat:, fix:, refactor:, docs:, chore:).",
      "",
      "Staged files:",
      staged,
      "",
      "```diff",
      diffOutput.slice(0, 6000),
      "```",
    ].join("\n"),
    { yes: false, fast: false, plan: false },
  );
  printInfo('Copy the message above and run: git commit -m "<message>"');
  return true;
});

registry.register("/pr", "Draft a PR description from branch diff")(async () => {
  const [okBranch, branch] = runGit("git branch --show-current");
  if (!okBranch || !branch) {
    printError("Could not determine current branch.");
    return true;
  }

  let base = "main";
  let [okBase] = runGit(`git rev-parse --verify ${base}`);
  if (!okBase) {
    base = "master";
    [okBase] = runGit(`git rev-parse --verify ${base}`);
    if (!okBase) {
      printError("Could not find main or master branch.");
      return true;
    }
  }

  const [, diffOutput] = runGit(`git diff ${base}...${branch}`);
  const [, logOutput] = runGit(`git log ${base}..${branch} --oneline`);
  if (!diffOutput) {
    printInfo(`No diff between ${branch} and ${base}.`);
    return true;
  }

  printInfo(`Drafting PR: ${branch} -> ${base}`);
  const { handle } = await import("../core/agent");
  await handle(
    [
      `Draft a GitHub Pull Request description for merging \`${branch}\` into \`${base}\`.`,
      "Include: Title, Summary, Changes, and Testing notes.",
      "",
      "Commits:",
      logOutput,
      "",
      "```diff",
      diffOutput.slice(0, 8000),
      "```",
    ].join("\n"),
    { yes: false, fast: false, plan: false },
  );
  return true;
});
