import { exec } from "child_process";
import { getProjectFiles } from "./file_browser";
import { cfg } from "./config";
import { THEME, console as consoleUi, setupScrollRegion, getToolbar, themeColor, setPromptInputActive } from "./ui/console";
import { isTuiEnabled, refreshFileList, setInput as setTuiInput, setPreviewFromPath, tuiScrollUp, tuiScrollDown, setInputHeight, forceRender } from "./ui/tui";
import { openContextPicker } from "./ui/context_picker";
import { registry } from "./commands/registry";
import { toggleAgent, getActiveAgentName } from "./core/agents";
import { MISSION_BOARD } from "./core/agent";
import chalk from "chalk";
import readline from "readline";
import logUpdate from "log-update";

let isRawMode = false;
let lastInputRenderRows = 0;
const promptQueue: string[] = [];

const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;
function visibleLength(text: string) {
  return String(text || "").replace(ANSI_RE, "").length;
}

function cursorLineCol(text: string, cursorPos: number) {
  const clamped = Math.max(0, Math.min(text.length, cursorPos));
  const before = text.slice(0, clamped);
  const parts = before.split("\n");
  const line = Math.max(0, parts.length - 1);
  const col = parts[parts.length - 1]?.length || 0;
  return { line, col };
}

function wrapLine(line: string, width: number) {
  const safeWidth = Math.max(1, width);
  if (!line.length) return [""];
  const out: string[] = [];
  for (let i = 0; i < line.length; i += safeWidth) {
    out.push(line.slice(i, i + safeWidth));
  }
  return out.length ? out : [""];
}

function stripAnsi(text: string) {
  return String(text || "").replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

function buildInputHint(inputBuffer: string) {
  const text = String(inputBuffer || "").trim();
  if (!text) {
    return "Tip: /assist fix <issue> | /config -h | @ attach file | ! run shell command | Use ';;' to queue prompts";
  }
  if (text.startsWith("/")) {
    const cmd = String(text.split(/\s+/)[0] || "").toLowerCase();
    if (registry.hasCommand(cmd)) {
      if (cmd === "/skills") {
        return "Skills: /skills list | /skills init <name> | /skills where";
      }
      return `Command ready: ${cmd}`;
    }
    const suggestions = registry.suggestCommands(cmd, 4);
    if (suggestions.length) {
      return `Unknown command. Try: ${suggestions.join("  ")}`;
    }
    return "Unknown command. Use /commands or /help.";
  }
  if (text.startsWith("!")) {
    return "Shell mode: the command after ! executes in your terminal";
  }
  if (text.startsWith("/queue")) {
    return "Queue mode: /queue prompt1 ;; prompt2 ;; prompt3";
  }
  if (text.includes("@")) {
    return "Context mode: @path attaches files to the prompt";
  }
  return "Enter submits. Use /assist for guided workflows.";
}

function splitQueuedPrompts(input: string, allowNewlines = false) {
  const raw = String(input || "").trim();
  if (!raw) return [];
  const parts = allowNewlines
    ? raw.split(/(?:;;|\r?\n)+/g)
    : raw.split(/;;/g);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function render(promptText: string, inputBuffer: string, cursorOffset: number) {
  if (isTuiEnabled()) {
    setTuiInput(inputBuffer, cursorOffset);
    const cols = Math.max(20, process.stdout.columns || 80);
    const fullText = promptText + inputBuffer;
    const maxContentWidth = cols - 4;
    const inputLines = Math.max(1, Math.ceil(fullText.length / maxContentWidth) || 1);
    setInputHeight(inputLines + 2); 
    forceRender();
    return;
  }
  const cols = Math.max(20, process.stdout.columns || 80);
  const rows = Math.max(10, process.stdout.rows || 24);
  const promptStyled = chalk.bold(themeColor(THEME.primary)(promptText));
  const fullText = promptText + inputBuffer;
  const cursorIdx = promptText.length + inputBuffer.length - cursorOffset;
  const lines: string[] = [];
  const maxContentWidth = cols - 4;
  let currentLine = "";
  let cursorRow = 0;
  let cursorCol = 0;
  for (let i = 0; i < fullText.length; i++) {
    if (i === cursorIdx) {
      cursorRow = lines.length;
      cursorCol = currentLine.length;
    }
    currentLine += fullText[i];
    if (currentLine.length >= maxContentWidth) {
      lines.push(currentLine);
      currentLine = "";
    }
  }
  if (currentLine.length > 0 || fullText.length === 0 || cursorIdx === fullText.length) {
    if (cursorIdx === fullText.length) {
      cursorRow = lines.length;
      cursorCol = currentLine.length;
    }
    lines.push(currentLine);
  }
  const inputRowsCount = lines.length;
  const hintText = buildInputHint(inputBuffer);
  const toolbar = getToolbar();
  const missionHeight = MISSION_BOARD ? MISSION_BOARD.getHeight() : 0;
  const totalReserved = inputRowsCount + 4 + missionHeight;
  setupScrollRegion(totalReserved);
  const startRow = rows - (totalReserved - 1);
  process.stdout.write("\x1b7\x1b[?25l"); 
  process.stdout.write(`\x1b[${startRow};1H\x1b[2K`);
  process.stdout.write(chalk.gray("\u2554" + "\u2550".repeat(cols - 2) + "\u2557"));
  for (let i = 0; i < lines.length; i++) {
    process.stdout.write(`\x1b[${startRow + 1 + i};1H\x1b[2K`);
    const content = lines[i];
    const padding = " ".repeat(Math.max(0, maxContentWidth - content.length));
    let lineOutput = content;
    if (i === 0 && content.startsWith(promptText)) {
      lineOutput = promptStyled + content.substring(promptText.length);
    }
    process.stdout.write(chalk.gray("\u2551 ") + lineOutput + padding + chalk.gray(" \u2551"));
  }
  const hintRow = startRow + 1 + inputRowsCount;
  process.stdout.write(`\x1b[${hintRow};1H\x1b[2K`);
  const hintClipped = stripAnsi(hintText).slice(0, cols - 4);
  const hintPadding = " ".repeat(Math.max(0, cols - 4 - hintClipped.length));
  process.stdout.write(chalk.gray("\u2551 ") + chalk.dim(hintClipped) + hintPadding + chalk.gray(" \u2551"));
  const bottomRow = hintRow + 1;
  process.stdout.write(`\x1b[${bottomRow};1H\x1b[2K`);
  const bottomPaddingLen = Math.max(0, cols - 2 - stripAnsi(toolbar).length);
  process.stdout.write(chalk.gray("\u255a") + toolbar + chalk.gray("\u2550".repeat(bottomPaddingLen) + "\u255d"));
  process.stdout.write("\x1b8");
  if (MISSION_BOARD) { try { MISSION_BOARD.refresh(); } catch { } }
  process.stdout.write(`\x1b[${startRow + 1 + cursorRow};${3 + cursorCol}H\x1b[?25h`);
}

export async function promptMultiline(message = "Enter input:") {
  process.stdout.write(`${message}\n`);
  return await customInputLoop("> ");
}

async function customInputLoop(promptStr: string = "agent-cli> "): Promise<string> {
  return new Promise((resolve) => {
    let inputBuffer = "";
    let cursorOffset = 0;
    let suppressNextLf = false;
    let pickerActive = false;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    isRawMode = true;

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener("data", onData);
      process.stdout.removeListener("resize", onResize);
      isRawMode = false;
      process.stdin.resume();
      if (!isTuiEnabled()) setupScrollRegion(0);
      process.stdout.write("\n\x1b[?25h");
    };

    const onResize = () => {
      if (!isTuiEnabled()) setupScrollRegion();
      try { render(promptStr, inputBuffer, cursorOffset); } catch { }
    };
    process.stdout.on("resize", onResize);

    const splitKey = (chunk: string): string[] => {
      const out: string[] = [];
      let i = 0;
      while (i < chunk.length) {
        if (chunk[i] === "\x1b" && i + 1 < chunk.length && (chunk[i+1] === "[" || chunk[i+1] === "O")) {
          let j = i + 2;
          while (j < chunk.length) {
            const char = chunk[j++];
            if ((char >= "A" && char <= "Z") || (char >= "a" && char <= "z") || char === "~" || char === "u") break;
          }
          out.push(chunk.substring(i, j)); i = j;
        } else { out.push(chunk[i++]); }
      }
      return out;
    };

    const onData = (chunk: string) => {
      if (!chunk || chunk === "\x1b[I" || chunk === "\x1b[O") return;
      for (const key of splitKey(chunk)) {
        if (pickerActive) continue;
        const realCursorPos = inputBuffer.length - cursorOffset;
        if (key === "\u0003") { // Ctrl+C
          inputBuffer = ""; cursorOffset = 0;
          try { render(promptStr, inputBuffer, 0); } catch { }
          continue;
        }
        if (key === "\x1b[17~") { // F6
          exec("code .", (err) => {
            if (err) consoleUi.print(themeColor(THEME.error)("Failed to open IDE."));
            else consoleUi.print(themeColor(THEME.success)("Opened IDE."));
          });
          continue;
        }
        if (key === "\n" && suppressNextLf) { suppressNextLf = false; continue; }
        if (key === "\r" || key === "\n") {
          if (key === "\r") suppressNextLf = true;
          try { render(promptStr, inputBuffer, 0); } catch { }
          cleanup(); resolve(inputBuffer); return;
        }
        if (key === "\t") {
          toggleAgent();
          try { render(promptStr, inputBuffer, cursorOffset); } catch { }
        } else if (key === "\x7f" || key === "\b") { // Backspace
          if (realCursorPos > 0) {
            inputBuffer = inputBuffer.substring(0, realCursorPos - 1) + inputBuffer.substring(realCursorPos);
            try { render(promptStr, inputBuffer, cursorOffset); } catch { }
          }
        } else if (key.startsWith("\x1b[<")) { // Mouse
          if (isTuiEnabled()) {
            const m = key.match(/\x1b\[<(\d+);/);
            if (m && m[1] === "64") tuiScrollUp(3);
            if (m && m[1] === "65") tuiScrollDown(3);
          }
        } else if (key === "\x1b[5~") { if (isTuiEnabled()) tuiScrollUp(10); } 
        else if (key === "\x1b[6~") { if (isTuiEnabled()) tuiScrollDown(10); }
        else if (key === "\x1b[D" || key === "\x1bOD") { // Left
          if (cursorOffset < inputBuffer.length) { cursorOffset++; try { render(promptStr, inputBuffer, cursorOffset); } catch { } }
        } else if (key === "\x1b[C" || key === "\x1bOC") { // Right
          if (cursorOffset > 0) { cursorOffset--; try { render(promptStr, inputBuffer, cursorOffset); } catch { } }
        } else if (key === "@") {
          pickerActive = true; setPromptInputActive(false);
          void (async () => {
            try {
              const res = await openContextPicker();
              if (res.action === "confirm" && res.selected.length > 0) {
                const tokens = res.selected.map(p => `@${p}`).join(" ") + " ";
                inputBuffer = inputBuffer.substring(0, realCursorPos) + tokens + inputBuffer.substring(realCursorPos);
              }
            } finally {
              pickerActive = false; setPromptInputActive(true);
              process.stdin.setRawMode(true); process.stdin.resume();
              try { render(promptStr, inputBuffer, cursorOffset); } catch { }
            }
          })();
        } else if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) <= 126) {
          inputBuffer = inputBuffer.substring(0, realCursorPos) + key + inputBuffer.substring(realCursorPos);
          try { render(promptStr, inputBuffer, cursorOffset); } catch { }
        }
      }
    };
    process.stdin.on("data", onData);
    process.stdin.resume();
    try { render(promptStr, inputBuffer, cursorOffset); } catch { }
  });
}

async function fallbackInputLoop(promptStr: string = "agent-cli > "): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  consoleUi.print(getToolbar());
  return new Promise<string>((resolve) => {
    rl.question(promptStr, (answer) => { rl.close(); resolve(answer); });
  });
}

export async function loop(cb: (text: string) => Promise<unknown> | unknown) {
  try {
    if (isTuiEnabled()) refreshFileList(".");
    while (true) {
      setPromptInputActive(true);
      if (!isTuiEnabled()) setupScrollRegion();
      let value = "";
      if (promptQueue.length) {
        value = promptQueue.shift() || "";
        consoleUi.print(themeColor(THEME.dim)(`Queued prompt (${promptQueue.length} remaining)...`));
      } else {
        value = process.stdin.isTTY ? await customInputLoop("agent-cli> ") : await fallbackInputLoop("agent-cli> ");
      }
      setPromptInputActive(false);
      const stripped = (value || "").trim();
      if (!stripped) continue;
      if (["exit", "quit", "/exit", "/quit"].includes(stripped.toLowerCase())) break;

      if (stripped.startsWith("/queue")) {
        const rest = stripped.substring(6).trim();
        const queued = splitQueuedPrompts(rest, true);
        if (queued.length > 0) { promptQueue.push(...queued); continue; }
      } else if (!stripped.startsWith("/") && stripped.includes(";;")) {
        const queued = splitQueuedPrompts(stripped, false);
        if (queued.length > 1) { promptQueue.push(...queued.slice(1)); value = queued[0]; }
      }

      const finalInput = (value || "").trim();
      if (!finalInput) continue;

      if (finalInput.startsWith("!")) {
        const cmd = finalInput.substring(1).trim();
        if (cmd) {
          await new Promise<void>((resolve) => {
            exec(cmd, (err, stdout, stderr) => {
              if (stdout) consoleUi.print(stdout);
              if (stderr) consoleUi.print(stderr);
              if (err) consoleUi.print(chalk.red(`Error: ${err.message}`));
              resolve();
            });
          });
        }
        continue;
      }

      try { await cb(finalInput); } catch (err) {
        consoleUi.print(themeColor(THEME.error)(`Error: ${String(err)}`));
      }
    }
  } finally {
    if (isRawMode) { process.stdin.setRawMode(false); process.stdout.write("\x1b[?25h"); }
    process.stdin.pause();
  }
}
