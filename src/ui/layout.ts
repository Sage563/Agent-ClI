import chalk from "chalk";
import boxen from "boxen";

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

function panel(title: string, body: string, borderColor = "cyan", width?: number) {
  return boxen(body || "_empty_", {
    title: chalk.bold(title),
    titleAlignment: "left",
    borderStyle: "single",
    borderColor,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    margin: 0,
    width,
  });
}

function truncate(text: string, maxChars: number) {
  const t = String(text || "");
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function renderWorkspaceLayout(params: WorkspaceLayoutParams) {
  const cols = Math.max(80, process.stdout.columns || 120);
  const half = Math.max(38, Math.floor((cols - 4) / 2));
  const right = Math.max(38, cols - half - 3);
  const activity = (params.activity || []).slice(-8).map((x) => `- ${x}`).join("\n") || "_none_";
  const fileTree = (params.fileTree || []).slice(-12).map((x) => `- ${x}`).join("\n") || "_none_";
  const terminalOutput = truncate(params.terminalOutput || "", 1800) || "_none_";
  const thought = truncate(params.thought || "", 1200) || "_none_";
  const response = truncate(params.response || "", 2200) || "_waiting_";

  const statusColor = colorByName(params.statusColor || "cyan");
  const header = `${chalk.bold(params.title)}  ${statusColor(`[ ${params.status} ]`)}`;
  const headerMeta = params.meta ? chalk.gray(params.meta) : "";

  const leftPanels = [
    panel("Output", response, "green", half),
    panel("Thought", thought, "magenta", half),
  ].join("\n");

  const rightPanels = [
    panel("Activity Log", activity, "yellow", right),
    panel("File Tree", fileTree, "blue", right),
    panel("Terminal", terminalOutput, "cyan", right),
  ].join("\n");

  const leftLines = leftPanels.split("\n");
  const rightLines = rightPanels.split("\n");
  const total = Math.max(leftLines.length, rightLines.length);
  const rows: string[] = headerMeta ? [header, headerMeta] : [header];
  for (let i = 0; i < total; i += 1) {
    const l = leftLines[i] || " ".repeat(half);
    const r = rightLines[i] || "";
    rows.push(`${l} ${r}`);
  }
  return rows.join("\n");
}
