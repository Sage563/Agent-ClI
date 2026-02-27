import chalk from "chalk";
import path from "path";
import { createPatch } from "diff";
import { THEME, themeColor, consoleUI } from "./console";

export function showDiff(filePath: string, original: string, edited: string) {
  if (!original && edited) {
    const lines = edited.split(/\r?\n/);
    console.log(`\n${chalk.bold.green(`\u271a New File: ${filePath}`)} (${lines.length} lines)`);
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

  console.log(`\n${chalk.bold(themeColor(THEME.primary)(`\u25b6 Edit: ${filePath}`))}`);
  if (actualChanges.length > 20) {
    console.log(chalk.gray(`  (Large diff: ${actualChanges.length} changes)`));
  } else {
    console.log(diff);
  }
}

export async function displayThinking(
  rawModelThinking: string,
  structuredThought: string,
  _showUi: boolean,
  _missionBoardActive: boolean,
) {
  if (rawModelThinking) {
    console.log(`\n${chalk.dim("—".repeat(20))} ${chalk.bold.magenta("AI THOUGHT")} ${chalk.dim("—".repeat(20))}`);
    console.log(chalk.gray(rawModelThinking));
  }
  if (structuredThought) {
    console.log(`\n${chalk.dim("—".repeat(20))} ${chalk.bold.magenta("STRATEGY")} ${chalk.dim("—".repeat(20))}`);
    console.log(chalk.gray(structuredThought));
  }
}

/**
 * Interactively prompts the user to accept or reject a file edit.
 */
export async function promptConfirmEdit(filePath: string): Promise<boolean> {
  const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  console.log(chalk.gray(`\nFile: ${relPath}`));
  const prompt = `${chalk.bold.cyan("?")} ${chalk.bold("Accept this edit? (y/n)")} > `;
  const answer = (await consoleUI.input(prompt)).toLowerCase().trim();
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  return false;
}
