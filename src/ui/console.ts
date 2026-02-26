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

export function renderPanel(content: string, title = "", style?: string, fullWidth = false, fullHeight = false) {
  const body = renderMarkdown(content);
  const borderColor = normalizeColorName(style || THEME.primary);

  const opts: any = {
    title: title ? titleByStyle(title, style) : undefined,
    titleAlignment: "left",
    borderStyle: "single",
    borderColor,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
    dimBorder: false,
  };

  if (process.stdout.columns) {
    // Default to width-aware rendering for all panels, with optional full-width intent.
    opts.width = fullWidth ? terminalWidth() : Math.min(terminalWidth(), Math.max(48, terminalWidth()));
  }
  if (fullHeight && process.stdout.rows) {
    opts.height = terminalHeight();
  }

  return boxen(body, opts);
}

export function printPanel(content: string, title = "", style?: string, fullWidth = false, fullHeight = false) {
  console.log(renderPanel(content, title, style, fullWidth, fullHeight));
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
  const line = "─".repeat(Math.max(0, width - (label ? label.length + 2 : 0)));
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
    if (args.tasks) this.tasks = args.tasks;
    if (typeof args.thought === "string") this.thought = args.thought;
    if (typeof args.status === "string") this.status = args.status;
    if (typeof args.status_style === "string") this.statusStyle = args.status_style;
    if (typeof args.live_field === "string") this.liveField = args.live_field;
    if (typeof args.live_text === "string") this.liveText = args.live_text;
    if (args.log) {
      this.logs.push(args.log);
      if (this.logs.length > 15) this.logs.shift();
    }
    this.flush();
  }

  setStreaming(active: boolean) {
    this.streaming = active;
    this.flush();
  }

  markTaskDone(taskIndex: number) {
    if (this.tasks[taskIndex]) {
      this.tasks[taskIndex].done = true;
      this.flush();
    }
  }

  private renderProgressBar(done: number, total: number, width = 24) {
    if (total <= 0) return `${"░".repeat(width)} 0%`;
    const ratio = Math.max(0, Math.min(1, done / total));
    const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
    return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))} ${Math.round(ratio * 100)}%`;
  }

  private render() {
    const totalTasks = this.tasks.length;
    const doneTasks = this.tasks.filter((task) => Boolean(task.done)).length;
    const pendingTasks = Math.max(0, totalTasks - doneTasks);
    const taskLines = this.tasks.length
      ? this.tasks
        .slice(0, 12)
        .map((task, idx) => `${task.done ? "✓" : "•"} ${idx + 1}. ${task.text}`)
        .join("\n")
      : "_No tasks yet..._";
    const thoughtPreview = this.thought
      ? String(this.thought).split(/\r?\n/).slice(0, 8).join("\n")
      : "_No thought yet..._";
    const livePreview = this.liveText
      ? String(this.liveText).split(/\r?\n/).slice(-12).join("\n")
      : "_No live content..._";
    const activityLines = this.logs.slice(-8).map((l) => `• ${l}`).join("\n") || "_No activity yet..._";
    const statusBadge = chalk.bold(themeBgColor(this.statusStyle || THEME.primary)(` ${this.status} `));
    const streamingBadge = this.streaming
      ? ` ${chalk.bold(themeBgColor(THEME.accent || "cyan")(" STREAMING "))}`
      : "";
    const progress = this.renderProgressBar(doneTasks, totalTasks, 26);
    const lines = [
      `${chalk.bold(this.title)}  ${statusBadge}${streamingBadge}`,
      `${themeColor(THEME.dim)("Progress")}  ${progress}`,
      `${themeColor(THEME.dim)("Tasks")}  ${doneTasks}/${totalTasks} done  •  ${pendingTasks} pending`,
      "",
      `${themeColor(THEME.primary)("PLAN")}`,
      taskLines,
      "",
      `${themeColor(THEME.secondary)("THOUGHT")}`,
      thoughtPreview,
      "",
      `${themeColor(THEME.warning)(`LIVE ${this.liveField ? `(${this.liveField})` : ""}`.trim())}`,
      livePreview,
      "",
      `${chalk.bold.italic(themeColor(THEME.dim)("ACTIVITY"))}`,
      activityLines,
    ];
    return boxen(renderMarkdown(lines.join("\n")), {
      borderStyle: "single",
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
      borderColor: normalizeColorName(this.statusStyle || THEME.primary),
      margin: 0,
      width: terminalWidth(),
      height: terminalHeight(),
      float: "left",
    });
  }

  flush() {
    if (PROMPT_INPUT_ACTIVE) return;
    logUpdate(this.render());
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
