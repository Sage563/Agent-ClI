import fs from "fs-extra";
import path from "path";
import { createPatch } from "diff";
import { printPanel, THEME } from "./console";

export function showDiff(filePath: string, original: string, edited: string) {
  const abs = path.resolve(process.cwd(), filePath);
  if (!original && edited) {
    const lines = edited.split(/\r?\n/);
    if (lines.length > 20) {
      printPanel(`LARGE FILE CREATED\n\nLines: ${lines.length}\nPreview:\n${(lines[0] || "").slice(0, 100)}...`, `New File: ${filePath}`, THEME.success);
      return;
    }
    printPanel(edited, `New File: ${filePath}`, THEME.success);
    return;
  }

  const diff = createPatch(filePath, original || "", edited || "", `a/${filePath}`, `b/${filePath}`);
  const actualChanges = diff
    .split(/\r?\n/)
    .filter((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"));
  if (!actualChanges.length) return;

  if (actualChanges.length > 15) {
    printPanel(
      `[dim]First edit:[/dim]\n${(actualChanges[0] || "").slice(0, 100)}...`,
      `[bold red]BIGG DIF[/bold red] - ${filePath}`,
      THEME.warning,
    );
    return;
  }

  printPanel(diff, `Edit: ${filePath}`, THEME.primary);
  if (!fs.existsSync(abs) && edited) {
    // noop: matches original behavior of displaying only.
  }
}

export function displayThinking(
  rawModelThinking: string,
  structuredThought: string,
  showUi: boolean,
  missionBoardActive: boolean,
) {
  if (!(showUi && !missionBoardActive)) return;
  const blocks: string[] = [];
  if (rawModelThinking) blocks.push(`#### Raw Model Thinking\n\n${rawModelThinking}`);
  if (structuredThought) blocks.push(`#### Agent Strategy\n\n${structuredThought}`);
  if (!blocks.length) return;
  printPanel(blocks.join("\n\n---\n\n"), "Deep Reasoning", THEME.secondary, true);
}
