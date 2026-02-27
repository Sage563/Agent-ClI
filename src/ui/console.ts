import chalk from "chalk";
import boxen from "boxen";
import Table from "cli-table3";
import logUpdate from "log-update";
import readline from "readline";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { cfg } from "../config";

marked.use(
  markedTerminal({
    codespan: (text: string) => chalk.bgGray.black(text),
    code: (text: string) => colorByName(THEME.accent || "cyan")(text),
    firstHeading: (text: string) => chalk.bold(colorByName(THEME.primary || "cyan")(text)),
    heading: (text: string) => chalk.bold(colorByName(THEME.secondary || "magenta")(text)),
    strong: (text: string) => chalk.bold(colorByName(THEME.warning || "yellow")(text)),
    em: (text: string) => chalk.italic(colorByName(THEME.dim || "gray")(text)),
    href: (text: string) => chalk.underline(colorByName(THEME.accent || "cyan")(text)),
  })
);

export let THEME = cfg.getTheme();
let PROMPT_INPUT_ACTIVE = false;

export function reloadTheme() {
  THEME = cfg.getTheme();
}

export const ROUNDED = "round";

function colorByName(color: string) {
  const c = color.toLowerCase();
  if (c.includes("red")) return chalk.red;
  if (c.includes("green")) return chalk.green;
  if (c.includes("yellow")) return chalk.yellow;
  if (c.includes("blue")) return chalk.blue;
  if (c.includes("magenta")) return chalk.magenta;
  if (c.includes("cyan")) return chalk.cyan;
  if (c.includes("gray")) return chalk.gray;
  return (text: string) => text;
}

function bgColorByName(color: string) {
  const c = color.toLowerCase();
  if (c.includes("red")) return chalk.bgRed;
  if (c.includes("green")) return chalk.bgGreen;
  if (c.includes("yellow")) return chalk.bgYellow;
  if (c.includes("blue")) return chalk.bgBlue;
  if (c.includes("magenta")) return chalk.bgMagenta;
  if (c.includes("cyan")) return chalk.bgCyan;
  if (c.includes("gray")) return chalk.bgGray;
  if (c.includes("white")) return chalk.bgWhite;
  return (text: string) => text;
}

export function themeColor(name?: string) {
  return colorByName(name || THEME.primary);
}

export function themeBgColor(name?: string) {
  return bgColorByName(name || THEME.primary);
}

function renderMarkdown(content: string) {
  try {
    return marked.parse(content || "") as string;
  } catch {
    return content || "";
  }
}

function terminalWidth() {
  return Math.max(40, (process.stdout.columns || 100) - 2);
}

function terminalHeight() {
  return Math.max(10, (process.stdout.rows || 30) - 2);
}

function styleMarkdownLine(content: string, colorName?: string) {
  const parsed = renderMarkdown(content).trimEnd();
  return themeColor(colorName)(parsed);
}

function normalizeColorName(color?: string) {
  const c = String(color || "").toLowerCase();
  if (c.includes("red")) return "red";
  if (c.includes("green")) return "green";
  if (c.includes("yellow")) return "yellow";
  if (c.includes("blue")) return "blue";
  if (c.includes("magenta")) return "magenta";
  if (c.includes("cyan")) return "cyan";
  if (c.includes("gray") || c.includes("grey") || c.includes("dim")) return "gray";
  if (c.includes("white")) return "white";
  return "cyan";
}

function titleByStyle(title: string, style?: string) {
  const color = colorByName(style || THEME.primary);
  return chalk.bold(color(` ${title} `));
}

export function renderPanel(content: string, title = "", style?: string, _fullWidth = false, _fullHeight = false, boxed = false) {
  const color = colorByName(style || THEME.primary);
  const width = Math.max(20, (process.stdout.columns || 80) - 2);
  const body = renderMarkdown(content);

  if (boxed) {
    return boxen(body, {
      title: title ? titleByStyle(title, style) : undefined,
      titleAlignment: "left",
      borderStyle: "round",
      borderColor: normalizeColorName(style || THEME.primary),
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      width: Math.min(width + 2, 100),
    });
  }

  if (!title) {
    return `${color("\u2500".repeat(width))}\n${body}`;
  }
  const label = ` ${title} `;
  const remaining = Math.max(0, width - label.length - 2);
  const left = "\u2500\u2500";
  const right = "\u2500".repeat(Math.max(0, remaining));
  return `${color(`${left}${chalk.bold(label)}${right}`)}\n${body}`;
}

export function printPanel(content: string, title = "", style?: string, fullWidth = false, fullHeight = false, boxed = false) {
  console.log(renderPanel(content, title, style, fullWidth, fullHeight, boxed));
}

export function printError(msg: string) {
  console.error(styleMarkdownLine(`Error: ${msg}`, THEME.error));
}

export function printSuccess(msg: string) {
  console.log(styleMarkdownLine(msg, THEME.success));
}

export function printInfo(msg: string) {
  console.log(styleMarkdownLine(msg, THEME.accent));
}

export function printWarning(msg: string) {
  console.log(styleMarkdownLine(msg, THEME.warning));
}

export function printActivity(msg: string) {
  console.log(chalk.bold.italic(styleMarkdownLine(`Activity: ${msg}`, THEME.dim)));
}

export function printRule(label = "", style?: string) {
  const width = Math.max(20, (process.stdout.columns || 80) - 2);
  const color = colorByName(style || THEME.dim || "gray");
  const line = "\u2500".repeat(Math.max(0, width - (label ? label.length + 2 : 0)));
  const text = label ? `${label} ${line}` : line;
  console.log(color(text));
}

export const consoleApi = {
  log: (...args: unknown[]) => globalThis.console.log(...args),
  error: (...args: unknown[]) => globalThis.console.error(...args),
  print: (msg: string) => globalThis.console.log(renderMarkdown(msg)),
  input: async (promptText: string) => {
    // Avoid readline prompt corruption when any live logUpdate animation is active.
    try {
      PROMPT_INPUT_ACTIVE = true;
      logUpdate.clear();
      process.stdout.write("\x1b[?25h");
    } catch {
      // best effort only
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise<string>((resolve) => {
      rl.question(promptText, (answer) => {
        rl.close();
        try {
          // Clean prompt line tail after answer so later UI renders start from a clean state.
          process.stdout.write("\x1b[2K\x1b[G");
        } catch {
          // ignore
        }
        PROMPT_INPUT_ACTIVE = false;
        resolve(answer);
      });
    });
  },
  clear: () => globalThis.console.clear(),
};

export function isPromptInputActive() {
  return PROMPT_INPUT_ACTIVE;
}

export const consoleShim = consoleApi;
export const consoleObj = consoleApi;
export const consoleUI = consoleApi;
export const console = consoleApi;

export function clearScreen() {
  logUpdate.clear();
  process.stdout.write("\x1Bc");
  consoleApi.clear();
}

let thinkingTimer: NodeJS.Timeout | null = null;

export function startThinking() {
  if (thinkingTimer || PROMPT_INPUT_ACTIVE) return;
  let frame = 0;
  const chars = 12;
  const equals = 6;
  thinkingTimer = setInterval(() => {
    const pos = Math.abs((frame % ((chars - equals) * 2)) - (chars - equals));
    const leftSpace = " ".repeat(pos);
    const rightSpace = " ".repeat(chars - equals - pos);
    const bar = `[${leftSpace}${"=".repeat(equals)}${rightSpace}]`;
    logUpdate(`${chalk.bold(themeColor(THEME.secondary)("AI THINKING"))} ${chalk.bold(themeColor(THEME.primary)(bar))}`);
    frame += 1;
  }, 100);
}

export function stopThinking() {
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
    logUpdate.clear();
  }
}

export async function liveStatus(msg: string, title = "Working", fn?: () => Promise<void>) {
  const text = `[${title}] ${msg}`;
  const spinnerFrames = ["-", "\\", "|", "/"];
  let idx = 0;
  let active = true;
  const timer = setInterval(() => {
    if (!active) return;
    logUpdate(`${spinnerFrames[idx % spinnerFrames.length]} ${text}`);
    idx += 1;
  }, 90);
  try {
    if (fn) await fn();
  } finally {
    active = false;
    clearInterval(timer);
    logUpdate.clear();
  }
}

export class MissionBoard {
  title: string;
  tasks: Array<{ text: string; done?: boolean }> = [];
  thought = "";
  liveField = "";
  liveText = "";
  status = "Thinking...";
  statusStyle = THEME.primary;
  logs: string[] = [];
  streaming = false;

  constructor(title = "Mission Board") {
    this.title = title;
  }

  update(args: {
    tasks?: Array<{ text: string; done?: boolean }>;
    thought?: string;
    status?: string;
    status_style?: string;
    log?: string;
    live_field?: string;
    live_text?: string;
  }) {
    if (args.tasks) {
      const oldDone = this.tasks.filter(t => t.done).length;
      const newDone = args.tasks.filter(t => t.done).length;
      if (newDone > oldDone || args.tasks.length !== this.tasks.length) {
        const total = args.tasks.length;
        const progress = this.renderProgressBar(newDone, total, 20);
        console.log(chalk.bold(`\nTask Progress: ${progress} (${newDone}/${total})`));
      }
      this.tasks = args.tasks;
    }
    if (typeof args.thought === "string" && args.thought !== this.thought) {
      this.thought = args.thought;
    }
    if (typeof args.status === "string" && args.status !== this.status) {
      this.status = args.status;
      console.log(chalk.bold(themeColor(args.status_style || THEME.primary)(`[MISSION STATUS] ${this.status}`)));
    }
    if (typeof args.status_style === "string") this.statusStyle = args.status_style;
    if (typeof args.live_field === "string") this.liveField = args.live_field;
    if (typeof args.live_text === "string") this.liveText = args.live_text;
    if (args.log) {
      this.logs.push(args.log);
      console.log(themeColor(THEME.dim)(` \u2022 ${args.log}`));
      if (this.logs.length > 50) this.logs.shift();
    }
  }

  setStreaming(_active: boolean) {
    // No-op for appended mode
  }

  markTaskDone(taskIndex: number) {
    if (this.tasks[taskIndex]) {
      this.tasks[taskIndex].done = true;
      const total = this.tasks.length;
      const done = this.tasks.filter(t => t.done).length;
      const progress = this.renderProgressBar(done, total, 20);
      console.log(chalk.green(`\u2713 Task Completed: ${this.tasks[taskIndex].text}`));
      console.log(chalk.bold(`Task Progress: ${progress} (${done}/${total})`));
    }
  }

  private renderProgressBar(done: number, total: number, width = 24) {
    if (total <= 0) return `${"\u2591".repeat(width)} 0%`;
    const ratio = Math.max(0, Math.min(1, done / total));
    const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
    return `${"\u2588".repeat(filled)}${"\u2591".repeat(Math.max(0, width - filled))} ${Math.round(ratio * 100)}%`;
  }

  flush() {
    // No-op for appended mode
  }

  activate() {
    return {
      [Symbol.dispose]: () => logUpdate.clear(),
      [Symbol.asyncDispose]: async () => logUpdate.clear(),
    };
  }

  close() {
    logUpdate.clear();
  }
}

export async function promptMissionReply(question: string) {
  printPanel(
    `AI Clarification Required\n\n${question}\n\nThis response is required before the agent can continue.`,
    "AI Clarification Required",
    THEME.error,
    true,
  );
  const answer = await consoleApi.input("Reply > ");
  if (!answer.trim()) {
    return await consoleApi.input("Reply > ");
  }
  return answer;
}

export function streamJsonField(fieldName: string, value: unknown, style?: string) {
  const color = colorByName(style || THEME.primary);
  const text = typeof value === "string" ? value : JSON.stringify(value);
  process.stdout.write(color(`"${fieldName}": `));
  process.stdout.write(text);
  process.stdout.write("\n");
}

export function printSessionStats(stats: Record<string, unknown>) {
  const table = new Table({
    head: ["Metric", "Value"],
    style: { head: [normalizeColorName(THEME.primary)] },
  });
  if (stats.provider) table.push(["Provider", String(stats.provider)]);
  table.push(["Model", String(stats.model || "unknown")]);
  table.push(["Turns", String(stats.turns || 0)]);
  table.push(["Input Tokens", String(stats.input_tokens || 0)]);
  table.push(["Output Tokens", String(stats.output_tokens || 0)]);
  if (stats.context_window) {
    table.push(["Context Used", String(stats.context_used || 0)]);
    table.push(["Context Window", String(stats.context_window || 0)]);
    table.push(["Context Left", String(stats.context_left || 0)]);
  }
  table.push(["Total Cost", `$${Number(stats.total_cost || 0).toFixed(4)}`]);
  console.log(`\n${table.toString()}\n`);
}
