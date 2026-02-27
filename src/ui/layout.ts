import chalk from "chalk";

type WorkspaceLayoutParams = {
  title: string;
  status: string;
  statusColor?: "green" | "yellow" | "red" | "cyan" | "magenta" | "blue" | "gray";
  meta?: string;
  response: string;
  thought?: string;
  activity?: string[];
  fileTree?: string[];
  terminalOutput?: string;
};

function colorByName(name: string) {
  const key = String(name || "cyan").toLowerCase();
  if (key.includes("green")) return chalk.green;
  if (key.includes("yellow")) return chalk.yellow;
  if (key.includes("red")) return chalk.red;
  if (key.includes("magenta")) return chalk.magenta;
  if (key.includes("blue")) return chalk.blue;
  if (key.includes("gray")) return chalk.gray;
  return chalk.cyan;
}

function section(title: string, body: string, color: (s: string) => string, width: number) {
  const label = ` ${title} `;
  const remaining = Math.max(0, width - label.length - 2);
  const header = color(`\u2500\u2500${chalk.bold(label)}${"\u2500".repeat(remaining)}`);
  return `${header}\n${body || chalk.gray("_empty_")}`;
}

export function renderWorkspaceLayout(params: WorkspaceLayoutParams) {
  const cols = Math.max(60, process.stdout.columns || 120);
  const activity = (params.activity || []).slice(-12).map((x) => `  ${x}`).join("\n") || chalk.gray("_none_");
  const fileTree = (params.fileTree || []).slice(-12).map((x) => `  ${x}`).join("\n") || chalk.gray("_none_");
  const terminalOutput = params.terminalOutput || chalk.gray("_none_");
  const thought = params.thought || "";
  const response = params.response || chalk.gray("_waiting_");

  const statusColor = colorByName(params.statusColor || "cyan");
  const header = `${chalk.bold(params.title)}  ${statusColor(`[ ${params.status} ]`)}`;
  const headerMeta = params.meta ? chalk.gray(params.meta) : "";

  const rows: string[] = headerMeta ? [header, headerMeta, ""] : [header, ""];
  rows.push(section("Output", response, chalk.green, cols));
  if (thought) {
    rows.push(section("Thought", thought, chalk.magenta, cols));
  }
  rows.push(section("Activity", activity, chalk.yellow, cols));
  if ((params.fileTree || []).length) {
    rows.push(section("Files", fileTree, chalk.blue, cols));
  }
  if (params.terminalOutput) {
    rows.push(section("Terminal", terminalOutput, chalk.cyan, cols));
  }
  return rows.join("\n");
}
