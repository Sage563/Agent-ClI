import chalk from "chalk";
import path from "path";
import { createPatch } from "diff";
import { THEME, themeColor, consoleUI, isTuiEnabled, appendChat } from "./console";

export function showDiff(filePath: string, original: string, edited: string) {
  if (!original && edited) {
    const lines = edited.split(/\r?\n/);
    const header = `\n${chalk.bold.green(`\u271a New File: ${filePath}`)} (${lines.length} lines)`;
    if (isTuiEnabled()) {
      appendChat(header);
      if (lines.length > 30) {
        appendChat(chalk.gray(`  (Preview: ${(lines[0] || "").slice(0, 100)}...)`));
      } else {
        appendChat(edited);
      }
      return;
    }

    console.log(header);
    if (lines.length > 30) {
      console.log(chalk.gray(`  (Preview: ${(lines[0] || "").slice(0, 100)}...)`));
      return;
    }
    console.log(edited);
    return;
  }

  const diff = createPatch(filePath, original || "", edited || "", `a/${filePath}`, `b/${filePath}`);
  const actualChanges = diff
    .split(/\r?\n/)
    .filter((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"));
  if (!actualChanges.length) return;

  const diffHeader = `\n${chalk.bold(themeColor(THEME.primary)(`${filePath}`))}`;
  if (isTuiEnabled()) {
    appendChat(diffHeader);
    if (actualChanges.length > 20) {
      appendChat(chalk.gray(`  (Large diff: ${actualChanges.length} changes)`));
    } else {
      for (const line of diff.split(/\r?\n/)) {
        if (line.startsWith("+") && !line.startsWith("+++")) appendChat(chalk.green(line));
        else if (line.startsWith("-") && !line.startsWith("---")) appendChat(chalk.red(line));
        else appendChat(line);
      }
    }
    return;
  }

  console.log(diffHeader);
  if (actualChanges.length > 20) {
    console.log(chalk.gray(`  (Large diff: ${actualChanges.length} changes)`));
  } else {
    console.log(diff);
  }
}

export async function displayThinking(
  rawModelThinking: string,
  structuredThought: string,
  showUi: boolean,
  missionBoardActive: boolean,
) {
  if (!showUi || missionBoardActive) return;
  const finalThought = rawModelThinking.trim() || structuredThought.trim();
  if (finalThought) {
    console.log(`\n${chalk.dim("—".repeat(20))} ${chalk.bold.magenta("AI THOUGHT")} ${chalk.dim("—".repeat(20))}`);
    console.log(chalk.gray(finalThought));
  }
}

/**
 * Interactively prompts the user to accept or reject a file edit.
 */
export async function promptConfirmEdit(filePath: string): Promise<boolean> {
  const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  console.log(chalk.gray(`\nFile: ${relPath}`));
  const prompt = `${chalk.bold.cyan("Question : ")} ${chalk.bold("Accept this edit? (y/n)")} > `;
  const answer = (await consoleUI.input(prompt)).toLowerCase().trim();
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  return false;
}
