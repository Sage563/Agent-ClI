import chalk from "chalk";
import boxen from "boxen";
import Table from "cli-table3";
import logUpdate from "log-update";
import readline from "readline";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { cfg } from "../config";
import { appendChat, appendTool, isTuiEnabled, setStatus, teardownTui, clearTui } from "./tui";
export { isTuiEnabled, appendChat, setStatus, teardownTui, clearTui };
import { getActiveSessionName } from "../memory";

marked.setOptions({
  gfm: true,
  breaks: true,
});

const termOpts = markedTerminal({
  emoji: false,
  tab: 2,
  reflowText: true,
  get width() {
    return Math.max(40, (process.stdout.columns || 80) - 4);
  },
  codespan: (text: string) => chalk.bgGray.black(text),
  code: (text: string) => themeColor(THEME.accent)(text),
  firstHeading: (text: string) => chalk.bold(themeColor(THEME.primary)(`> ${text}`)),
  heading: (text: string) => chalk.bold(themeColor(THEME.secondary)(`- ${text}`)),
  strong: (text: string) => chalk.bold.cyan(text),
  em: (text: string) => chalk.italic.gray(text),
  href: (text: string) => chalk.underline.magenta(text),
  listitem: (text: string) => `* ${text}`,
});

marked.use(termOpts);
marked.use({
  renderer: {
    code(token: any) {
      if (typeof token !== "object" || !token.text) return "";
      const language = token.lang || "";
      const content = token.text || "";
      const formatted = colorByName(THEME.accent || "cyan")(content);
      return (
        "\n" +
        boxen(formatted, {
          title: language ? chalk.bold(language) : "",
          borderStyle: "round",
          padding: { left: 1, right: 1 },
          borderColor: normalizeColorName(THEME.accent || "cyan"),
        }) +
        "\n"
      );
    },
  },
});

export let THEME = cfg.getTheme();
let PROMPT_INPUT_ACTIVE = false;

export function reloadTheme() {
  THEME = cfg.getTheme();
}

/**
 * Robust ANSI-aware string truncation and padding.
 * @param text The input text (potentially containing ANSI escape codes)
 * @param width The target display width
 * @param truncateWithEllipsis Whether to add '...' if truncated
 */
export function fit(text: string, width: number, truncateWithEllipsis = true): string {
  if (width <= 0) return "";
  const ANSI_REGEX = /\x1B\[[0-9;]*[JKmsu]/g;
  const visible = text.replace(ANSI_REGEX, "");

  if (visible.length <= width) {
    return text + " ".repeat(width - visible.length);
  }

  if (!truncateWithEllipsis || width <= 3) return visible.slice(0, width);

  // ANSI-aware truncation
  let result = "";
  let visibleCount = 0;
  let i = 0;
  const target = width - 3;

  while (i < text.length && visibleCount < target) {
    if (text[i] === "\x1B" && text[i + 1] === "[") {
      let j = i + 2;
      while (j < text.length && !/[JKmsu]/.test(text[j])) j++;
      result += text.slice(i, j + 1);
      i = j + 1;
    } else {
      result += text[i];
      visibleCount++;
      i++;
    }
  }
  return result + "..." + "\x1B[0m";
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
    const raw = String(content || "");
    if (!raw.trim()) return "";
    // Avoid blowing the stack on extremely large or pathological inputs.
    if (raw.length > 40000) return raw;
    return marked.parse(raw) as string;
  } catch {
    return String(content || "");
  }
}

function normalizeResponseText(content: string) {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "");
}

function stripUiInstructionNoise(content: string) {
  const raw = String(content || "");
  if (!raw.trim()) return raw;
  const lines = raw.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^Output format\s*:/i.test(trimmed)) return false;
    if (/^Return strict JSON only/i.test(trimmed)) return false;
    return true;
  });
  return filtered.join("\n").trim();
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
      width: width,
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
  if (isTuiEnabled()) {
    const rendered = renderPanel(content, title, style, fullWidth, fullHeight, boxed);
    appendChat(rendered);
    return;
  }
  console.log(renderPanel(content, title, style, fullWidth, fullHeight, boxed));
}

export function printError(msg: string) {
  if (isTuiEnabled()) {
    appendChat(styleMarkdownLine(`Error: ${msg}`, THEME.error));
    return;
  }
  console.error(styleMarkdownLine(`Error: ${msg}`, THEME.error));
}

export async function printImage(filePath: string) {
  try {
    const cols = Math.max(40, process.stdout.columns || 80);
    const useAscii = Boolean(cfg.get("image_to_ascii"));

    if (useAscii) {
      const asciify = (await (new Function("return import('asciify-image')"))()) as any;
      const asciifyFn = asciify.default && typeof asciify.default === "function" ? asciify.default : (typeof asciify === "function" ? asciify : asciify.default || asciify);

      const opts = {
        fit: "original" as const,
        width: cols,
        height: Math.max(10, (process.stdout.rows || 30) - 2),
        color: true,
      };
      const result = await asciifyFn(filePath, opts);
      console.log(result);
      return;
    }

    const ti = (await (new Function("return import('terminal-image')"))()) as any;
    const terminalImage = ti.default && typeof ti.default.file === "function" ? ti.default : (ti.file ? ti : ti.default || ti);
    console.log(await terminalImage.file(filePath, { width: "100%", height: "100%" }));
  } catch (error) {
    console.log(`[Image could not be rendered in terminal: ${filePath}] (${String(error)})`);
  }
}

export function printSuccess(msg: string) {
  if (isTuiEnabled()) {
    appendChat(styleMarkdownLine(msg, THEME.success));
    return;
  }
  console.log(styleMarkdownLine(msg, THEME.success));
}

export function printInfo(msg: string) {
  if (isTuiEnabled()) {
    appendChat(styleMarkdownLine(msg, THEME.accent));
    return;
  }
  console.log(styleMarkdownLine(msg, THEME.accent));
}

export function printWarning(msg: string) {
  if (isTuiEnabled()) {
    appendChat(styleMarkdownLine(`Warning: ${msg}`, THEME.warning));
    return;
  }
  console.log(styleMarkdownLine(msg, THEME.warning));
}

export function printActivity(text: string) {
  if (isTuiEnabled()) {
    setStatus(text);
    appendTool(text);
    return;
  }
  if (PROMPT_INPUT_ACTIVE) return;
  if (MISSION_ACTIVITY_SINK) {
    MISSION_ACTIVITY_SINK(text);
    return;
  }
  process.stdout.write(chalk.cyan(`[BUSY] `) + text + "\n");
}

export function printRule(label = "", style?: string) {
  const width = Math.max(20, (process.stdout.columns || 80) - 1);
  const color = colorByName(style || THEME.dim || "gray");
  const line = "\u2500".repeat(Math.max(0, width - (label ? label.length + 2 : 0)));
  const text = label ? `${label} ${line}` : line;
  console.log(color(text));
}

export const consoleApi = {
  log: (...args: unknown[]) => globalThis.console.log(...args),
  error: (...args: unknown[]) => globalThis.console.error(...args),
  print: (msg: string) => {
    const normalized = stripUiInstructionNoise(normalizeResponseText(msg));
    if (isTuiEnabled()) {
      appendChat(normalized);
      return;
    }
    try {
      globalThis.console.log(renderMarkdown(normalized));
    } catch {
      globalThis.console.log(normalized);
    }
  },
  input: async (promptText: string) => {
    // Avoid readline prompt corruption when any live logUpdate animation is active.
    try {
      resetScrollRegion();
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

export function setPromptInputActive(active: boolean) {
  PROMPT_INPUT_ACTIVE = active;
}

export const consoleShim = consoleApi;
export const consoleObj = consoleApi;
export const consoleUI = consoleApi;
export const console = consoleApi;

export function clearScreen() {
  if (isTuiEnabled()) {
    clearTui();
    return;
  }
  logUpdate.clear();
  process.stdout.write("\x1Bc");
  consoleApi.clear();
}

let thinkingTimer: NodeJS.Timeout | null = null;
let MISSION_ACTIVITY_SINK: ((text: string) => void) | null = null;

export function setMissionActivitySink(sink: ((text: string) => void) | null) {
  MISSION_ACTIVITY_SINK = sink;
}

export function startThinking() {
  if (thinkingTimer || PROMPT_INPUT_ACTIVE) return;
  let frame = 0;
  const chars = 12;
  const equals = 6;
  const rows = process.stdout.rows || 24;
  const statusRow = rows - 4; // reserve row above input box

  thinkingTimer = setInterval(() => {
    const pos = Math.abs((frame % ((chars - equals) * 2)) - (chars - equals));
    const leftSpace = " ".repeat(pos);
    const rightSpace = " ".repeat(chars - equals - pos);
    const bar = `[${leftSpace}${"=".repeat(equals)}${rightSpace}]`;
    const text = `${chalk.bold(themeColor(THEME.secondary)("AI THINKING"))} ${chalk.bold(themeColor(THEME.primary)(bar))}`;

    // Position cursor and write
    process.stdout.write(`\x1b[${statusRow};1H\x1b[2K${text}`);
    frame += 1;
  }, 100);
}

export function stopThinking() {
  if (thinkingTimer) {
    clearInterval(thinkingTimer);
    thinkingTimer = null;
    const rows = process.stdout.rows || 24;
    const statusRow = rows - 4;
    process.stdout.write(`\x1b[${statusRow};1H\x1b[2K`);
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
  private spinnerFrames = ["|", "/", "-", "\\"];
  private spinnerFrameIdx = 0;
  private liveDirty = false;
  private liveActive = false;
  private renderTimer: NodeJS.Timeout | null = null;
  private readonly renderIntervalMs: number;
  private progressDoneCount = 0;

  constructor(title = "Mission Board") {
    this.title = title;
    const fpsRaw = Number(cfg.get("mission_render_fps", cfg.get("stream_render_fps", 30)));
    const fps = Number.isFinite(fpsRaw) ? Math.max(1, Math.floor(fpsRaw)) : 30;
    this.renderIntervalMs = Math.max(16, Math.floor(1000 / fps));
    if (process.stdout.isTTY) {
      this.renderTimer = setInterval(() => {
        if (!this.streaming) {
          if (this.liveDirty) this.renderLive(false, true);
          return;
        }
        this.spinnerFrameIdx = (this.spinnerFrameIdx + 1) % this.spinnerFrames.length;
        this.renderLive(true);
      }, this.renderIntervalMs);
    }
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
    const normalizeStatus = (value: string | undefined) => String(value || "").trim().toUpperCase();
    const isTransientStatus = (value: string | undefined) => {
      const normalized = normalizeStatus(value);
      return normalized === "STREAMING" || normalized === "STREAM EDITING" || normalized === "THINKING..." || normalized.startsWith("APPLYING ");
    };

    const nextStatus = typeof args.status === "string" ? args.status : this.status;
    const nextStatusStyle = String(args.status_style || this.statusStyle || THEME.primary);
    const hasNewStatus = Boolean(args.status) && nextStatus !== this.status && !isTransientStatus(nextStatus);
    const hasNewLog = Boolean(args.log) && args.log !== this.logs[this.logs.length - 1];
    const normalizedNext = normalizeStatus(nextStatus);
    if (normalizedNext === "STREAMING" || normalizedNext === "STREAM EDITING" || normalizedNext === "THINKING...") {
      this.streaming = true;
    } else if (args.status) {
      this.streaming = false;
    }

    // Check if a task was just finished
    let taskFinishedText = "";
    if (args.tasks && this.tasks.length > 0) {
      const oldDone = this.tasks.filter(t => t.done).length;
      const newDone = args.tasks.filter(t => t.done).length;
      if (newDone > oldDone) {
        // Find the newly finished task
        const finishedTask = args.tasks.find((t, i) => t.done && !this.tasks[i]?.done);
        if (finishedTask) taskFinishedText = finishedTask.text;
      }
    }

    // Update internal state before deciding what to render.
    this.status = nextStatus;
    if (args.tasks) {
      const prior = this.tasks;
      this.tasks = args.tasks.map((task, idx) => ({
        ...task,
        done: Boolean(task.done) || Boolean(prior[idx]?.done) || idx < this.progressDoneCount,
      }));
      const doneNow = this.tasks.filter((t) => t.done).length;
      if (doneNow > this.progressDoneCount) this.progressDoneCount = doneNow;
    }
    if (typeof args.thought === "string") this.thought = args.thought;
    if (typeof args.status_style === "string") this.statusStyle = args.status_style;
    if (typeof args.live_field === "string") this.liveField = args.live_field;
    if (typeof args.live_text === "string") this.liveText = args.live_text;
    this.liveDirty = true;

    const permanentLines: string[] = [];
    if (taskFinishedText) {
      permanentLines.push(chalk.green(`[DONE] Task: ${taskFinishedText}`));
    }
    if (hasNewStatus) {
      permanentLines.push(chalk.bold(themeColor(nextStatusStyle)(`[*] ${this.status}`)));
    }
    if (hasNewLog && args.log) {
      this.logs.push(args.log);
      permanentLines.push(themeColor(THEME.dim)(` - ${args.log}`));
      if (this.logs.length > 100) this.logs.shift();
    }

    if (permanentLines.length > 0) {
      this.clearLiveArea();
      if (!isTuiEnabled()) {
        for (const line of permanentLines) {
          console.log(line);
        }
      }
    }
    this.renderLive();
  }

  private clearLiveArea() {
    if (!this.liveActive) return;
    const rows = process.stdout.rows || 24;
    // We don't know exactly how many lines were there, so we clear the max possible (progress + status)
    process.stdout.write(`\x1b[${rows - 4};1H\x1b[2K`);
    process.stdout.write(`\x1b[${rows - 5};1H\x1b[2K`);
    this.liveActive = false;
  }

  getHeight() {
    let h = 0;
    if (this.tasks.length > 0) h += 1; // Progress bar
    if (this.liveText) h += 1; // Status/Live text
    return h;
  }

  private renderLive(tick = false, force = false) {
    if (PROMPT_INPUT_ACTIVE && !force) return;
    if (tick && !this.liveDirty && !this.liveText) return;

    const liveLines: string[] = [];
    if (this.tasks.length > 0) {
      const done = this.tasks.filter((t) => t.done).length;
      const progress = this.renderProgressBar(done, this.tasks.length, 24);
      liveLines.push(chalk.bold(" \u2503 ") + chalk.white("Progress: ") + progress);
    }
    if (this.liveText) {
      const waitingForUser = String(this.status || "").trim().toUpperCase() === "WAITING FOR USER";
      const frame = this.spinnerFrames[this.spinnerFrameIdx % this.spinnerFrames.length];
      const text = waitingForUser ? this.liveText : `${this.liveText} ${frame}`;
      const statusColor = waitingForUser ? THEME.warning : (THEME.accent || "cyan");
      liveLines.push(chalk.bold(" \u2503 ") + themeColor(statusColor)(`Status: ${text}`));
    }

    if (liveLines.length === 0) {
      this.clearLiveArea();
      this.liveDirty = false;
      return;
    }

    const rows = process.stdout.rows || 24;
    const startRow = rows - (liveLines.length - 1);

    // Position cursor and write each line
    for (let i = 0; i < liveLines.length; i++) {
      const row = startRow + i;
      if (row > 0 && row <= rows) {
        if (!isTuiEnabled()) {
          process.stdout.write(`\x1b[${row};1H\x1b[2K${liveLines[i]}`);
        }
      }
    }

    this.liveActive = true;
    this.liveDirty = false;
  }

  refresh() {
    this.renderLive(false, true);
  }

  private shouldLogProgress(newTasks: Array<{ text: string; done?: boolean }>) {
    if (!newTasks || newTasks.length === 0) return false;
    const oldDone = this.tasks.filter(t => t.done).length;
    const totalDone = newTasks.filter(t => t.done).length;
    return totalDone > oldDone || newTasks.length !== this.tasks.length;
  }

  setStreaming(active: boolean) {
    this.streaming = Boolean(active);
    this.liveDirty = true;
    this.renderLive(false, true);
  }

  setProgressDone(doneCount: number) {
    const normalized = Math.max(0, Math.floor(doneCount || 0));
    this.progressDoneCount = normalized;
    if (this.tasks.length) {
      this.tasks = this.tasks.map((task, idx) => ({ ...task, done: idx < normalized || Boolean(task.done) }));
    }
    this.liveDirty = true;
    this.renderLive();
  }

  markTaskDone(taskIndex: number) {
    if (this.tasks[taskIndex]) {
      this.tasks[taskIndex].done = true;
      this.liveDirty = true;
      const total = this.tasks.length;
      const done = this.tasks.filter(t => t.done).length;
      const progress = this.renderProgressBar(done, total, 20);
      if (!isTuiEnabled()) {
        console.log(chalk.green(`✅ Task Completed: ${this.tasks[taskIndex].text}`));
        console.log(chalk.bold(`Task Progress: ${progress} (${done}/${total})`));
      }
    }
  }

  private renderProgressBar(done: number, total: number, width = 20) {
    if (total <= 0) return chalk.dim("Initializing...");
    const ratio = Math.max(0, Math.min(1, done / total));
    const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
    const bar = themeColor(THEME.success)("\u2588".repeat(filled)) + chalk.gray("\u2591".repeat(Math.max(0, width - filled)));
    const percent = chalk.bold(themeColor(THEME.success)(`${Math.round(ratio * 100)}%`));
    return `${bar} ${percent} (${done}/${total})`;
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
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }
    this.clearLiveArea();
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
  if (!isTuiEnabled()) {
    process.stdout.write(color(`"${fieldName}": `));
    process.stdout.write(text);
    process.stdout.write("\n");
  }
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
  if (!isTuiEnabled()) {
    console.log(`\n${table.toString()}\n`);
  }
}

export function getToolbar() {
  const sessionName = getActiveSessionName();
  const provider = cfg.getActiveProvider();
  const model = String(cfg.getModel(provider) || "default").split("/").pop() || "default";
  const truncModel = model.length > 20 ? model.slice(0, 17) + "..." : model;

  // Agent badge
  let agentBadge = "";
  try {
    const { getActiveAgentName } = require("../core/agents");
    const agentName = getActiveAgentName();
    if (agentName === "plan") {
      agentBadge = chalk.bold.bgBlue.white(` PLAN `) + " ";
    } else if (agentName === "explore") {
      agentBadge = chalk.bold.bgMagenta.white(` EXPLORE `) + " ";
    } else {
      agentBadge = chalk.bold.bgGreen.black(` BUILD `) + " ";
    }
  } catch { agentBadge = ""; }

  const mode = cfg.isFastMode() ? chalk.bold.cyan(" FAST") : "";
  const see = cfg.isSeeMode() ? chalk.bold.magenta(" SEE") : "";

  const providerStyle = chalk.bold(themeColor(THEME.success)(provider));
  const modelStyle = chalk.dim(`(${truncModel})`);

  const text = ` ${agentBadge}${providerStyle} ${modelStyle} | ${chalk.cyan(sessionName)}${mode}${see} | Tab:agent @:files !:shell /help `;

  const cols = process.stdout.columns || 80;
  // Calculate plain text length for padding
  const plainBadge = agentBadge.replace(/\u001b\[.*?m/g, "");
  const plainMode = mode.replace(/\u001b\[.*?m/g, "");
  const plainSee = see.replace(/\u001b\[.*?m/g, "");
  const plainText = ` ${plainBadge}${provider} (${truncModel}) | ${sessionName}${plainMode}${plainSee} | Tab:agent @:files !:shell /help `;
  const padding = Math.max(0, cols - plainText.length);

  const bg = themeBgColor("dim" as any) || chalk.bgGray;
  return bg(chalk.white(text + " ".repeat(padding)));
}

/**
 * Sets the terminal scrolling region to exclude the last line.
 * This allows a persistent toolbar at the very bottom.
 */
export function setupScrollRegion(reservedRows = 5) {
  const rows = process.stdout.rows || 24;
  if (reservedRows <= 0) {
    // Reset to full screen
    process.stdout.write("\x1b[r");
    return;
  }
  if (rows > 10) {
    const availableRows = Math.max(1, rows - reservedRows);
    process.stdout.write(`\x1b[1;${availableRows}r`);
    // Position cursor at the very last visible line of the scroll region
    process.stdout.write(`\x1b[${availableRows};1H`);
  }
}

/**
 * Resets the terminal scrolling region to the full window.
 */
export function resetScrollRegion() {
  process.stdout.write("\x1b[r");
}

/**
 * Print formatted tool result with bordered output.
 */
export function printToolResult(toolName: string, results: string[], maxLines = 15) {
  const color = colorByName(THEME.accent || "cyan");
  const dimColor = colorByName(THEME.dim || "gray");
  
  if (isTuiEnabled()) {
    const header = dimColor("[TOOL] ") + color(toolName) + dimColor(` (${results.length})`);
    const lines = results.slice(0, maxLines);
    appendTool(header);
    for (const line of lines) appendTool(`  ${line}`);
    if (results.length > maxLines) appendTool(dimColor(`  ... and ${results.length - maxLines} more`));
    return;
  }
  const width = Math.max(40, (process.stdout.columns || 80) - 4);
  const count = results.length;
  const header = `[TOOL] ${toolName}: ${count} result${count !== 1 ? "s" : ""}`;
  const headerLine = `\u250C\u2500\u2500 ${color(chalk.bold(header))} ${dimColor("\u2500".repeat(Math.max(0, width - header.length - 5)))}${dimColor("\u2510")}`;

  const lines = results.slice(0, maxLines);
  const bodyLines = lines.map((line) => {
    const truncated = line.length > width - 4 ? line.slice(0, width - 7) + "..." : line;
    return `${dimColor("\u2502")} ${truncated}${" ".repeat(Math.max(0, width - truncated.length - 3))}${dimColor("\u2502")}`;
  });
  if (results.length > maxLines) {
    const moreText = `... and ${results.length - maxLines} more`;
    bodyLines.push(`${dimColor("\u2502")} ${chalk.dim(moreText)}${" ".repeat(Math.max(0, width - moreText.length - 3))}${dimColor("\u2502")}`);
  }
  const footer = `${dimColor("\u2514")}${dimColor("\u2500".repeat(Math.max(0, width - 1)))}${dimColor("\u2518")}`;

  if (!isTuiEnabled()) {
    console.log(`\n${headerLine}`);
    for (const line of bodyLines) console.log(line);
    console.log(footer);
  }
}

/**
 * Print inline diff with colored + / - lines.
 */
export function printDiffInline(filePath: string, original: string, edited: string) {
  const color = colorByName(THEME.accent || "cyan");
  const baseName = filePath.split(/[\\/]/).pop() || filePath;
  const header = `\u2500\u2500 ${chalk.bold(baseName)} `;
  const width = Math.max(40, (process.stdout.columns || 80) - 4);
  
  if (isTuiEnabled()) {
    appendChat(color(`\n\u2500\u2500 ${chalk.bold(baseName)} \u2500\u2500\u2500`));
  } else {
    console.log(color(header + "\u2500".repeat(Math.max(0, width - header.length + 5))));
  }

  const oldLines = (original || "").split("\n");
  const newLines = (edited || "").split("\n");
  const contextLines = 3;
  const maxLen = Math.max(oldLines.length, newLines.length);
  const diffs: Array<{ type: "context" | "remove" | "add"; line: string }> = [];

  // Simple line-by-line diff
  let i = 0, j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      diffs.push({ type: "context", line: oldLines[i] });
      i++; j++;
    } else if (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      diffs.push({ type: "remove", line: oldLines[i] });
      i++;
      if (j < newLines.length) {
        diffs.push({ type: "add", line: newLines[j] });
        j++;
      }
    } else if (j < newLines.length) {
      diffs.push({ type: "add", line: newLines[j] });
      j++;
    }
  }

  // Show only context around changes
  let lastPrintedChange = -999;
  for (let k = 0; k < diffs.length; k++) {
    const d = diffs[k];
    if (d.type !== "context") {
      // Print context before
      for (let c = Math.max(lastPrintedChange + 1, k - contextLines); c < k; c++) {
        if (diffs[c].type === "context") {
          if (!isTuiEnabled()) console.log(chalk.dim(`  ${diffs[c].line}`));
        }
      }
      if (d.type === "remove") {
        const outLine = chalk.red(`- ${d.line}`);
        if (isTuiEnabled()) appendChat(outLine); else console.log(outLine);
      } else {
        const outLine = chalk.green(`+ ${d.line}`);
        if (isTuiEnabled()) appendChat(outLine); else console.log(outLine);
      }
      lastPrintedChange = k;
    } else if (k - lastPrintedChange <= contextLines && lastPrintedChange >= 0) {
      const outLine = chalk.dim(`  ${d.line}`);
      if (isTuiEnabled()) appendChat(outLine); else console.log(outLine);
    } else if (k - lastPrintedChange === contextLines + 1 && lastPrintedChange >= 0) {
      const remaining = diffs.slice(k).findIndex((dd) => dd.type !== "context");
      if (remaining > 0) {
        const outLine = chalk.dim(`  ... (${remaining} lines)`);
        if (isTuiEnabled()) appendChat(outLine); else console.log(outLine);
      }
    }
  }
  if (!isTuiEnabled()) console.log("");
}

/**
 * Print file operation header with icon and line count.
 */
export function printFileHeader(filePath: string, lineCount?: number, icon = "\u2261") {
  const color = colorByName(THEME.accent || "cyan");
  const width = Math.max(40, (process.stdout.columns || 80) - 4);
  const baseName = filePath.split(/[\\/]/).pop() || filePath;
  const info = lineCount !== undefined ? ` (${lineCount} lines)` : "";
  const header = `[${icon}] ${baseName}${info}`;
  
  if (isTuiEnabled()) {
    appendChat(color(header));
  } else {
    console.log(color(header + " " + "\u2500".repeat(Math.max(0, width - header.length - 1))));
  }
}

/**
 * Print rich mission completion summary.
 */
export function printMissionSummary(stats: {
  tasksCompleted: number;
  totalTasks: number;
  durationMs: number;
  filesModified: string[];
  filesCreated: string[];
  commandsRun: number;
  tokensUsed: number;
  cost: number;
}) {
  const duration = stats.durationMs > 60000
    ? `${Math.floor(stats.durationMs / 60000)}m ${Math.floor((stats.durationMs % 60000) / 1000)}s`
    : `${Math.floor(stats.durationMs / 1000)}s`;

  const lines = [
    `[\u2713] ${stats.tasksCompleted}/${stats.totalTasks} tasks completed in ${duration}`,
    `[\u2261] ${stats.filesModified.length} files modified, ${stats.filesCreated.length} created`,
    `[>] ${stats.commandsRun} commands executed`,
    `[\u03A3] ${stats.tokensUsed.toLocaleString()} tokens used ($${stats.cost.toFixed(4)})`,
  ];

  if (stats.filesModified.length > 0 && stats.filesModified.length <= 5) {
    lines.push("");
    lines.push(chalk.dim("Modified:"));
    for (const f of stats.filesModified) {
      lines.push(chalk.dim(`  \u2022 ${f}`));
    }
  }
  if (stats.filesCreated.length > 0 && stats.filesCreated.length <= 5) {
    if (stats.filesModified.length === 0) lines.push("");
    lines.push(chalk.dim("Created:"));
    for (const f of stats.filesCreated) {
      lines.push(chalk.dim(`  \u2022 ${f}`));
    }
  }

  printPanel(lines.join("\n"), "Mission Complete", THEME.success, true, false, true);
}

/**
 * Render a compact token usage bar for display.
 */
export function renderTokenBar(used: number, total: number, width = 12): string {
  if (total <= 0) return "";
  const ratio = Math.max(0, Math.min(1, used / total));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const pct = Math.round(ratio * 100);
  const barColor = pct > 90 ? chalk.red : pct > 70 ? chalk.yellow : chalk.green;
  return `${barColor("\u2588".repeat(filled))}${chalk.dim("\u2591".repeat(empty))} ${pct}%`;
}
