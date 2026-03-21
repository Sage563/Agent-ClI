/**
 * Layout (top to bottom):
 *   Row 1           : Title bar (provider, model, session, agent badge)
 *   Rows 2..H-4     : Body — Chat panel (left ~70%) | Activity panel (right ~30%)
 *   Row H-3         : Status bar (agent state, token usage)
 *   Rows H-2..H     : Input box (fixed, expands upward)
 */

import chalk from "chalk";
import { cfg } from "../config";
import { getProjectFiles } from "../file_browser";
import { getActiveSessionName } from "../memory";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import util from "util";

// ── Markdown pipeline (mirrors console.ts) ───────────────────────────

marked.setOptions({ gfm: true, breaks: true });

const termRenderer = markedTerminal({
  emoji: false,
  tab: 2,
  reflowText: true,
  get width() {
    return Math.max(30, getChatWidth() - 4);
  },
  codespan: (text: string) => chalk.bgGray.white(` ${text} `),
  code: (text: string) => chalk.cyan(text),
  firstHeading: (text: string) => chalk.bold.cyan(`> ${text}`),
  heading: (text: string) => chalk.bold.magenta(`- ${text}`),
  strong: (text: string) => chalk.bold.cyan(text),
  em: (text: string) => chalk.italic.gray(text),
  href: (text: string) => chalk.underline.magenta(text),
  listitem: (text: string) => `  * ${text}`,
});

marked.use(termRenderer);

function renderMarkdownToAnsi(content: string): string {
  try {
    const raw = String(content || "");
    if (!raw.trim()) return "";
    if (raw.length > 40000) return raw;
    return (marked.parse(raw) as string).trimEnd();
  } catch {
    return String(content || "");
  }
}

// ── State ────────────────────────────────────────────────────────────

type TuiState = {
  chatLines: string[];       // rendered lines (may contain ANSI)
  chatScrollOffset: number;  // 0 = bottom (most recent), >0 = scrolled up
  activityLines: string[];
  activityScrollOffset: number;
  statusText: string;
  inputText: string;
  inputCursorOffset: number;
  inputHeight: number;       // how many rows the input box occupies
  streamingBuffer: string;   // raw markdown accumulator for current stream
  isStreaming: boolean;
  files: string[];
  renderTimer: NodeJS.Timeout | null;
  dirty: boolean;
  initialized: boolean;
};

const state: TuiState = {
  chatLines: [],
  chatScrollOffset: 0,
  activityLines: [],
  activityScrollOffset: 0,
  statusText: "Ready",
  inputText: "",
  inputCursorOffset: 0,
  inputHeight: 3,
  streamingBuffer: "",
  isStreaming: false,
  files: [],
  renderTimer: null,
  dirty: true,
  initialized: false,
};

const MAX_CHAT_LINES = 10000;
const MAX_ACTIVITY_LINES = 2000;
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return String(text || "").replace(ANSI_RE, "");
}

function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

// ── Geometry helpers ─────────────────────────────────────────────────

function termWidth(): number {
  return Math.max(40, process.stdout.columns || 80);
}

function termHeight(): number {
  return Math.max(12, process.stdout.rows || 24);
}

function getActivityWidth(): number {
  const w = termWidth();
  if (w < 80) return 0; // hide activity panel on narrow terminals
  return Math.max(24, Math.min(50, Math.floor(w * 0.30)));
}

function getChatWidth(): number {
  const aw = getActivityWidth();
  const w = termWidth();
  return aw > 0 ? w - aw - 1 : w; // -1 for the vertical separator
}

function getBodyHeight(): number {
  // total height minus title(1) + status(1) + input(variable)
  return Math.max(4, termHeight() - 2 - state.inputHeight);
}

// ── Console Interception ─────────────────────────────────────────────

const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
};

let consoleIntercepted = false;

function interceptConsole() {
  if (consoleIntercepted) return;
  consoleIntercepted = true;
  console.log = (...args: any[]) => {
    appendChat(util.format(...args));
  };
  console.error = (...args: any[]) => {
    appendChat(chalk.red(util.format(...args)));
  };
  console.warn = (...args: any[]) => {
    appendChat(chalk.yellow(util.format(...args)));
  };
  console.info = (...args: any[]) => {
    appendChat(chalk.blue(util.format(...args)));
  };
  console.debug = (...args: any[]) => {
    appendChat(chalk.gray(util.format(...args)));
  };
}

function restoreConsole() {
  if (!consoleIntercepted) return;
  consoleIntercepted = false;
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
  console.debug = originalConsole.debug;
}

// ── Public API ─────────────────────────────────────────────────────

export function isTuiEnabled(): boolean {
  return Boolean(cfg.get("tui_enabled", true));
}

export function getTuiInputHeight(): number {
  return state.inputHeight;
}

/**
 * Initialize the TUI — enter alternate screen, hide cursor.
 */
export function initTui(): void {
  if (state.initialized) return;
  if (!isTuiEnabled()) return;
  if (!process.stdout.isTTY) return;

  // Alternate screen buffer
  process.stdout.write("\x1b[?1049h");
  // Hide cursor
  process.stdout.write("\x1b[?25l");
  // Enable mouse for scroll
  process.stdout.write("\x1b[?1000h");
  process.stdout.write("\x1b[?1006h");

  state.initialized = true;
  state.dirty = true;

  // Start render loop
  const fpsRaw = Number(cfg.get("stream_render_fps", 30));
  const fps = Number.isFinite(fpsRaw) ? Math.max(1, Math.floor(fpsRaw)) : 30;
  const intervalMs = Math.max(16, Math.floor(1000 / fps));

  state.renderTimer = setInterval(() => {
    if (state.dirty) {
      performRender();
      state.dirty = false;
    }
  }, intervalMs);

  process.stdout.on("resize", () => {
    state.dirty = true;
  });

  process.stdout.on("resize", () => {
    state.dirty = true;
  });

  interceptConsole();

  // Add initial welcome message
  appendChat(chalk.bold.cyan("Agent CLI"));
  appendChat(chalk.dim("Type a message below or use /help for commands.\n"));
}

/**
 * Tear down the TUI — restore terminal state.
 */
export function teardownTui(): void {
  if (!state.initialized) return;

  if (state.renderTimer) {
    clearInterval(state.renderTimer);
    state.renderTimer = null;
  }

  // Disable mouse
  process.stdout.write("\x1b[?1006l");
  process.stdout.write("\x1b[?1000l");
  // Show cursor
  process.stdout.write("\x1b[?25h");
  // Leave alternate screen
  process.stdout.write("\x1b[?1049l");

  restoreConsole();

  state.initialized = false;
}

// ── Chat ─────────────────────────────────────────────────────────────

function wrapTextToWidth(text: string, width: number): string[] {
  if (width <= 0) return [""];
  const lines: string[] = [];

  for (const rawLine of text.split("\n")) {
    const plain = stripAnsi(rawLine);
    if (plain.length <= width) {
      lines.push(rawLine);
      continue;
    }

    // Naive ANSI-aware wrapping
    let currentLine = "";
    let currentVisible = 0;
    let i = 0;

    while (i < rawLine.length) {
      // Check for ANSI escape
      if (rawLine[i] === "\x1b" && rawLine[i + 1] === "[") {
        let j = i + 2;
        while (j < rawLine.length && !/[A-Za-z]/.test(rawLine[j])) j++;
        const seq = rawLine.slice(i, j + 1);
        currentLine += seq;
        i = j + 1;
        continue;
      }

      currentLine += rawLine[i];
      currentVisible++;
      i++;

      if (currentVisible >= width) {
        lines.push(currentLine);
        currentLine = "";
        currentVisible = 0;
      }
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [""];
}

function stripUiInstructionNoise(content: string): string {
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

export function appendChat(text: string): void {
  if (text === undefined || text === null) return;
  const raw = String(text);
  if (raw === "") return;

  const cleaned = stripUiInstructionNoise(raw);
  if (cleaned === "" && raw !== "") {
    // If noise stripping emptied it but it wasn't empty, it was pure noise.
    return;
  }

  // Render markdown
  let rendered: string;
  try {
    rendered = renderMarkdownToAnsi(cleaned);
  } catch {
    rendered = cleaned;
  }

  const chatW = getChatWidth() - 2; // 1 left pad + 1 right margin
  const wrapped = wrapTextToWidth(rendered, chatW);
  state.chatLines.push(...wrapped);

  // Trim excess
  if (state.chatLines.length > MAX_CHAT_LINES) {
    state.chatLines.splice(0, state.chatLines.length - MAX_CHAT_LINES);
  }

  // Auto-scroll to bottom when new content arrives
  state.chatScrollOffset = 0;
  state.dirty = true;
}

// ── Streaming ────────────────────────────────────────────────────────

export function startStreamingMessage(): void {
  state.isStreaming = true;
  state.streamingBuffer = "";
  // Add a placeholder line that will be updated
  state.chatLines.push(chalk.dim("..."));
  state.dirty = true;
}

export function appendStreamingDelta(delta: string): void {
  if (!delta) return;
  state.streamingBuffer += String(delta || "");

  // Re-render the streaming buffer as markdown and replace the streaming lines
  // First, remove old streaming lines (everything after the placeholder marker)
  // Find the last "..." or streaming content start
  const chatW = getChatWidth() - 2;

  let rendered: string;
  try {
    rendered = renderMarkdownToAnsi(state.streamingBuffer);
  } catch {
    rendered = state.streamingBuffer;
  }

  const wrapped = wrapTextToWidth(rendered, chatW);

  // Remove old streaming output — find from the end
  // We track the streaming start position
  if (!state.isStreaming) return;

  // We'll use a simple approach: track how many lines the previous render had
  const streamLineCount = (state as any).__streamLineCount || 1;
  const startIdx = Math.max(0, state.chatLines.length - streamLineCount);
  state.chatLines.splice(startIdx, streamLineCount, ...wrapped);
  (state as any).__streamLineCount = wrapped.length;

  state.chatScrollOffset = 0;
  state.dirty = true;
}

export function endStreamingMessage(): void {
  if (!state.isStreaming) return;
  state.isStreaming = false;

  // Final render of the complete streaming buffer
  if (state.streamingBuffer.trim()) {
    const chatW = getChatWidth() - 2;
    let rendered: string;
    try {
      rendered = renderMarkdownToAnsi(state.streamingBuffer);
    } catch {
      rendered = state.streamingBuffer;
    }
    const wrapped = wrapTextToWidth(rendered, chatW);

    const streamLineCount = (state as any).__streamLineCount || 1;
    const startIdx = Math.max(0, state.chatLines.length - streamLineCount);
    state.chatLines.splice(startIdx, streamLineCount, ...wrapped);
  }

  (state as any).__streamLineCount = 0;
  state.streamingBuffer = "";
  state.chatScrollOffset = 0;
  state.dirty = true;
}

export function clearTui(): void {
  state.chatLines = [];
  state.activityLines = [];
  state.chatScrollOffset = 0;
  state.activityScrollOffset = 0;
  state.dirty = true;
  appendChat(chalk.bold.cyan("Agent CLI - Cleared"));
}

// ── Activity panel ───────────────────────────────────────────────────

export function appendTool(text: string): void {
  const raw = String(text || "");
  if (!raw.trim()) return;

  const aw = getActivityWidth();
  if (aw <= 0) return;

  const maxW = aw - 2;
  const wrapped = wrapTextToWidth(raw, maxW);
  state.activityLines.push(...wrapped);

  if (state.activityLines.length > MAX_ACTIVITY_LINES) {
    state.activityLines.splice(0, state.activityLines.length - MAX_ACTIVITY_LINES);
  }

  state.activityScrollOffset = 0;
  state.dirty = true;
}

// ── Status ───────────────────────────────────────────────────────────

export function setStatus(text: string): void {
  state.statusText = String(text || "Ready");
  state.dirty = true;
}

// ── Input ────────────────────────────────────────────────────────────

export function setInput(text: string, cursorOffset: number): void {
  state.inputText = String(text || "");
  state.inputCursorOffset = cursorOffset;
  state.dirty = true;
}

export function setInputHeight(h: number): void {
  state.inputHeight = Math.max(3, Math.min(12, h));
  state.dirty = true;
}

// ── Scrolling ────────────────────────────────────────────────────────

export function tuiScrollUp(lines: number = 3): void {
  const bodyH = getBodyHeight();
  const maxScroll = Math.max(0, state.chatLines.length - bodyH);
  state.chatScrollOffset = Math.min(maxScroll, state.chatScrollOffset + lines);
  state.dirty = true;
}

export function tuiScrollDown(lines: number = 3): void {
  state.chatScrollOffset = Math.max(0, state.chatScrollOffset - lines);
  state.dirty = true;
}

// ── Files ────────────────────────────────────────────────────────────

export function refreshFileList(rootDir = "."): void {
  try {
    const files = getProjectFiles(rootDir).map((x) => x.path);
    state.files = files.slice(0, 200);
  } catch {
    state.files = [];
  }
}

export function setPreviewFromPath(_filePath: string, _maxLines = 40): void {
  // Reserved for future file preview support
}

// ── Render engine ────────────────────────────────────────────────────

function moveTo(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

function clearLine(): string {
  return "\x1b[2K";
}

function truncateAnsi(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  const plain = stripAnsi(text);
  if (plain.length <= maxWidth) return text;

  let result = "";
  let visible = 0;
  let i = 0;

  while (i < text.length && visible < maxWidth) {
    if (text[i] === "\x1b" && text[i + 1] === "[") {
      let j = i + 2;
      while (j < text.length && !/[A-Za-z]/.test(text[j])) j++;
      result += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    result += text[i];
    visible++;
    i++;
  }

  return result + "\x1b[0m";
}

function padRight(text: string, width: number, char = " "): string {
  const vis = visibleLength(text);
  if (vis >= width) return text;
  return text + char.repeat(width - vis);
}

function performRender(): void {
  if (!state.initialized) return;

  const W = termWidth();
  const H = termHeight();
  const chatW = getChatWidth();
  const actW = getActivityWidth();
  const bodyH = getBodyHeight();
  const hasActivity = actW > 0;

  const buf: string[] = [];

  // ─── Title Bar ─────────────────────────────────────────
  {
    const provider = cfg.getActiveProvider();
    const model = String(cfg.getModel(provider) || "default").split("/").pop() || "default";
    const session = getActiveSessionName();

    let agentBadge = "";
    try {
      const { getActiveAgentName } = require("../core/agents");
      const agentName = getActiveAgentName();
      if (agentName === "plan") {
        agentBadge = chalk.bold.bgBlue.white(" PLAN ") + " ";
      } else if (agentName === "explore") {
        agentBadge = chalk.bold.bgMagenta.white(" EXPLORE ") + " ";
      } else {
        agentBadge = chalk.bold.bgGreen.black(" BUILD ") + " ";
      }
    } catch { /* ignore */ }

    const fast = cfg.isFastMode() ? chalk.bold.cyan(" FAST") : "";
    const see = cfg.isSeeMode() ? chalk.bold.magenta(" SEE") : "";

    const titleContent = ` ${agentBadge}${chalk.bold.white(provider)} ${chalk.dim(`(${model.length > 20 ? model.slice(0, 17) + "..." : model})`)} ${chalk.dim("|")} ${chalk.cyan(session)}${fast}${see} `;

    buf.push(moveTo(1, 1) + clearLine());
    buf.push(chalk.bgGray.white(padRight(titleContent, W)));
  }

  // ─── Body: Chat + Activity ─────────────────────────────
  {
    // Calculate visible chat lines
    const visibleChatH = bodyH;
    const totalChatLines = state.chatLines.length;
    const scrollEnd = Math.max(0, totalChatLines - state.chatScrollOffset);
    const scrollStart = Math.max(0, scrollEnd - visibleChatH);
    const visibleChat = state.chatLines.slice(scrollStart, scrollEnd);

    // Calculate visible activity lines
    const totalActivityLines = state.activityLines.length;
    const actScrollEnd = Math.max(0, totalActivityLines - state.activityScrollOffset);
    const actScrollStart = Math.max(0, actScrollEnd - visibleChatH);
    const visibleActivity = state.activityLines.slice(actScrollStart, actScrollEnd);

    for (let row = 0; row < bodyH; row++) {
      const screenRow = row + 2; // row 1 is title bar

      // Chat column
      let chatContent = "";
      if (row < visibleChat.length) {
        chatContent = " " + truncateAnsi(visibleChat[row], chatW - 2);
      }
      chatContent = padRight(chatContent, chatW);

      let line = chatContent;

      // Separator + Activity column
      if (hasActivity) {
        let actContent = "";
        if (row < visibleActivity.length) {
          actContent = " " + truncateAnsi(visibleActivity[row], actW - 2);
        }
        actContent = padRight(actContent, actW);

        line = truncateAnsi(chatContent, chatW) + chalk.dim("\u2502") + actContent;
      }

      buf.push(moveTo(screenRow, 1) + clearLine() + line);
    }
  }

  // ─── Scroll indicator ──────────────────────────────────
  if (state.chatScrollOffset > 0) {
    const indicator = chalk.bold.yellow(` [Scrolled: ${state.chatScrollOffset} lines up] `);
    const scrollRow = 2; // overlay on first body row
    buf.push(moveTo(scrollRow, chatW - 30) + indicator);
  }

  // ─── Status Bar ────────────────────────────────────────
  {
    const statusRow = H - state.inputHeight;
    const statusIcon = state.isStreaming
      ? chalk.bold.yellow(" STREAMING ")
      : chalk.bold.green(" READY ");

    const statusContent = ` ${statusIcon} ${chalk.dim(state.statusText)} `;
    buf.push(moveTo(statusRow, 1) + clearLine());
    buf.push(chalk.bgGray.white(padRight(statusContent, W)));
  }

  // ─── Input Box ─────────────────────────────────────────
  {
    const inputStartRow = H - state.inputHeight + 1;
    const innerWidth = W - 4; // borders + padding

    // Top border
    buf.push(moveTo(inputStartRow, 1) + clearLine());
    buf.push(chalk.dim("\u250C" + "\u2500".repeat(W - 2) + "\u2510"));

    // Prompt text
    const provider = cfg.getActiveProvider();
    const model = String(cfg.getModel(provider) || "default").split("/").pop() || "default";
    const promptPrefix = chalk.dim(`${model} `) + chalk.bold.cyan("> ");
    const promptPrefixLen = visibleLength(promptPrefix);
    const inputContentWidth = innerWidth - promptPrefixLen;

    // Wrap input text
    const fullInput = state.inputText;
    const inputLines: string[] = [];
    if (!fullInput) {
      inputLines.push("");
    } else {
      for (let i = 0; i < fullInput.length; i += inputContentWidth) {
        inputLines.push(fullInput.slice(i, i + inputContentWidth));
      }
    }
    if (inputLines.length === 0) inputLines.push("");

    // Render input lines
    const maxInputLines = state.inputHeight - 2; // minus borders
    const displayInputLines = inputLines.slice(0, Math.max(1, maxInputLines));

    for (let i = 0; i < maxInputLines; i++) {
      const row = inputStartRow + 1 + i;
      if (row > H) break;

      buf.push(moveTo(row, 1) + clearLine());
      if (i < displayInputLines.length) {
        const prefix = i === 0 ? promptPrefix : " ".repeat(promptPrefixLen);
        const content = displayInputLines[i] || "";
        const padded = padRight(prefix + content, W - 2);
        buf.push(chalk.dim("\u2502") + " " + truncateAnsi(padded, W - 4) + " " + chalk.dim("\u2502"));
      } else {
        buf.push(chalk.dim("\u2502") + " ".repeat(W - 2) + chalk.dim("\u2502"));
      }
    }

    // Bottom border with help hint
    const bottomRow = inputStartRow + maxInputLines + 1;
    if (bottomRow <= H) {
      const hint = " Enter:submit | Tab:agent | @:files | !:shell | /help ";
      const hintLen = hint.length;
      const remaining = Math.max(0, W - 2 - hintLen);
      const leftPart = Math.floor(remaining / 2);
      const rightPart = remaining - leftPart;

      buf.push(moveTo(bottomRow, 1) + clearLine());
      buf.push(chalk.dim(
        "\u2514" +
        "\u2500".repeat(leftPart) +
        hint +
        "\u2500".repeat(rightPart) +
        "\u2518"
      ));
    }

    // Update input height dynamically
    const neededInputRows = Math.min(10, displayInputLines.length + 2); // lines + borders
    if (neededInputRows !== state.inputHeight && neededInputRows >= 3) {
      state.inputHeight = neededInputRows;
      state.dirty = true; // re-render needed
    }
  }

  // Write everything in one go
  const output = buf.join("");
  process.stdout.write(output);

  // ─── Position cursor inside input box ──────────────────
  {
    const inputStartRow = H - state.inputHeight + 1;
    const provider = cfg.getActiveProvider();
    const model = String(cfg.getModel(provider) || "default").split("/").pop() || "default";
    const promptPrefixLen = model.length + 1 + 2; // "model > "

    const cursorPos = state.inputText.length - state.inputCursorOffset;
    const innerWidth = W - 4 - promptPrefixLen;
    const cursorRow = innerWidth > 0 ? Math.floor(cursorPos / innerWidth) : 0;
    const cursorCol = innerWidth > 0 ? (cursorPos % innerWidth) : 0;

    const finalRow = inputStartRow + 1 + cursorRow;
    const finalCol = 2 + promptPrefixLen + cursorCol + 1;

    process.stdout.write(moveTo(finalRow, finalCol));
    process.stdout.write("\x1b[?25h"); // show cursor
  }
}

// ── Force render ─────────────────────────────────────────────────────

export function forceRender(): void {
  state.dirty = true;
  if (state.initialized) {
    performRender();
    state.dirty = false;
  }
}
