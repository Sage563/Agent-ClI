import { exec } from "child_process";
import { getProjectFiles } from "./file_browser";
import { cfg } from "./config";
import { getActiveSessionName } from "./memory";
import { THEME, console as consoleUi, themeBgColor, themeColor } from "./ui/console";
import { openContextPicker } from "./ui/context_picker";
import chalk from "chalk";
import readline from "readline";
import logUpdate from "log-update";

let isRawMode = false;
let lastInputRenderRows = 0;

function getToolbar() {
  const sessionName = getActiveSessionName();
  const provider = cfg.getActiveProvider();
  const planning = cfg.isPlanningMode() ? ` ${chalk.bold.yellow("PLAN")}` : "";
  const fast = cfg.isFastMode() ? ` ${chalk.bold.cyan("FAST")}` : "";
  const see = cfg.isSeeMode() ? ` ${chalk.bold.magenta("SEE")}` : "";
  const policy = ` ${chalk.bold.blue("RUN:" + cfg.getRunPolicy().toUpperCase())}`;

  const providerStyle = chalk.bold(themeColor(THEME.success)(provider));
  const text = ` \u2699 Provider: ${providerStyle} \u2022 Session: ${chalk.cyan(sessionName)}${planning}${fast}${see}${policy} \u2022 F6 IDE \u2022 @ context picker \u2022 /help `;

  const cols = process.stdout.columns || 80;
  // Use a simpler approach for terminal width padding
  const plainText = ` \u2699 Provider: ${provider} \u2022 Session: ${sessionName}${planning.replace(/\u001b\[.*?m/g, "")}${fast.replace(/\u001b\[.*?m/g, "")}${see.replace(/\u001b\[.*?m/g, "")}${policy.replace(/\u001b\[.*?m/g, "")} \u2022 F6 IDE \u2022 @ context picker \u2022 /help `;
  const padding = Math.max(0, cols - plainText.length);

  const bg = themeBgColor("dim" as any) || chalk.bgGray;
  return bg(chalk.white(text + " ".repeat(padding)));
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

function render(promptText: string, inputBuffer: string, cursorOffset: number) {
  if (lastInputRenderRows > 1) {
    process.stdout.write(`\x1b[${lastInputRenderRows - 1}A`);
  }
  // Clear screen below cursor just in case, then hide cursor during render
  process.stdout.write("\x1b[?25l");

  // Move to a clean line and clear below
  process.stdout.write("\x1b[2K\x1b[G\x1b[J");

  // Render true multiline input without marker artifacts.
  const promptStyled = chalk.bold(themeColor(THEME.primary)(promptText));
  const promptLen = promptText.length;
  const cols = Math.max(20, process.stdout.columns || 80);
  const cursorPos = Math.max(0, inputBuffer.length - cursorOffset);
  const logicalLines = inputBuffer.split("\n");
  const cursor = cursorLineCol(inputBuffer, cursorPos);
  const rows = Math.max(10, process.stdout.rows || 24);
  // Reserve bottom rows so prompt input stays above the status toolbar.
  const inputRows = Math.max(1, rows - 3);
  const firstPrefixLen = promptLen;
  const continuePrefixLen = promptLen;
  const firstWidth = Math.max(1, cols - firstPrefixLen - 1);
  const continueWidth = Math.max(1, cols - continuePrefixLen - 1);

  const visualRows: Array<{ text: string; logicalLine: number; chunkIndex: number; width: number }> = [];
  let cursorVisualRow = 0;
  let cursorVisualCol = 0;

  for (let li = 0; li < logicalLines.length; li += 1) {
    const line = logicalLines[li];
    const firstChunks = wrapLine(line, li === 0 ? firstWidth : continueWidth);
    const chunks = firstChunks.length ? firstChunks : [""];
    for (let ci = 0; ci < chunks.length; ci += 1) {
      const widthForChunk = li === 0 && ci === 0 ? firstWidth : continueWidth;
      visualRows.push({ text: chunks[ci], logicalLine: li, chunkIndex: ci, width: widthForChunk });
    }
  }

  const cursorLineText = logicalLines[cursor.line] || "";
  const cursorChunkIndex = Math.floor(cursor.col / (cursor.line === 0 ? firstWidth : continueWidth));
  const cursorChunkBase = cursorChunkIndex * (cursor.line === 0 ? firstWidth : continueWidth);
  const cursorColInChunk = Math.max(0, Math.min((cursor.line === 0 ? firstWidth : continueWidth), cursor.col - cursorChunkBase));
  let walked = 0;
  for (let li = 0; li < logicalLines.length; li += 1) {
    const w = li === 0 ? firstWidth : continueWidth;
    const chunkCount = wrapLine(logicalLines[li] || "", w).length;
    if (li === cursor.line) {
      cursorVisualRow = walked + Math.min(Math.max(0, chunkCount - 1), cursorChunkIndex);
      break;
    }
    walked += chunkCount;
  }
  cursorVisualCol = Math.min(cursorColInChunk, (cursorLineText.length - cursorChunkBase >= 0 ? (cursorLineText.length - cursorChunkBase) : 0));

  const startRow = Math.max(0, cursorVisualRow - inputRows + 1);
  const endRow = Math.min(visualRows.length, startRow + inputRows);
  const visibleRows = visualRows.slice(startRow, endRow);
  const cursorVisibleRow = Math.max(0, cursorVisualRow - startRow);
  let cursorColumnAbsolute = promptLen;

  for (let i = 0; i < visibleRows.length; i += 1) {
    if (i > 0) process.stdout.write("\n");
    process.stdout.write("\x1b[2K\x1b[G");
    const isFirst = i === 0 && startRow === 0;
    const prefixPlain = isFirst ? promptText : " ".repeat(promptLen);
    const prefixStyled = isFirst ? promptStyled : " ".repeat(promptLen);
    process.stdout.write(prefixStyled + visibleRows[i].text);
    if (i === cursorVisibleRow) {
      cursorColumnAbsolute = prefixPlain.length + Math.max(0, cursorVisualCol);
    }
  }

  // Draw bottom toolbar
  process.stdout.write("\x1b7"); // Save cursor pos (DEC, more compatible)
  process.stdout.write(`\x1b[${rows};1H`); // move to bottom left
  process.stdout.write("\x1b[2K\x1b[G"); // clear toolbar row before redraw
  process.stdout.write(getToolbar()); // draw toolbar
  process.stdout.write("\x1b8"); // Restore cursor pos (DEC, more compatible)

  const totalLinesRendered = visibleRows.length;
  lastInputRenderRows = Math.max(1, totalLinesRendered);
  const linesUp = Math.max(0, totalLinesRendered - 1 - cursorVisibleRow);
  if (linesUp > 0) process.stdout.write(`\x1b[${linesUp}A`);
  process.stdout.write(`\x1b[G\x1b[${Math.max(0, cursorColumnAbsolute)}C`);

  // Show cursor
  process.stdout.write("\x1b[?25h");
}

export async function promptMultiline(message = "Enter input:") {
  process.stdout.write(`${message}\n`);
  return await customInputLoop("> ");
}

async function customInputLoop(promptStr: string = "agent-cli > "): Promise<string> {
  return new Promise((resolve) => {
    let inputBuffer = "";
    let cursorOffset = 0; // offset from end of string (0 = at end)
    let pickerActive = false;
    let suppressNextLf = false;

    // Enable raw mode
    try { logUpdate.clear(); } catch { /* ignore */ }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    isRawMode = true;

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.removeListener('data', onData);
      process.stdout.removeListener('resize', onResize);
      isRawMode = false;
      lastInputRenderRows = 0;
      // Keep stdin resumed so next prompt is immediately interactive.
      process.stdin.resume();
      process.stdout.write("\x1b[2K\x1b[G");
      // Do not re-echo submitted prompt text here; it can duplicate the already-rendered input line.
      process.stdout.write("\n");
      process.stdout.write("\x1b[?25h");
    };

    const onResize = () => {
      try {
        render(promptStr, inputBuffer, cursorOffset);
      } catch {
        // ignore redraw failures during terminal resize races
      }
    };

    process.stdout.on('resize', onResize);

    const splitChunk = (chunk: string) => {
      const out: string[] = [];
      let i = 0;
      while (i < chunk.length) {
        const ch = chunk[i];
        if (ch !== "\x1b") {
          out.push(ch);
          i += 1;
          continue;
        }
        // Parse known CSI/SS3 escape sequences as a single token.
        if (i + 1 < chunk.length && (chunk[i + 1] === "[" || chunk[i + 1] === "O")) {
          let j = i + 2;
          while (j < chunk.length) {
            const c = chunk[j];
            // End on final byte for CSI/SS3 sequence.
            if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "~" || c === "u") {
              j += 1;
              break;
            }
            j += 1;
          }
          out.push(chunk.slice(i, Math.min(j, chunk.length)));
          i = Math.min(j, chunk.length);
          continue;
        }
        out.push(ch);
        i += 1;
      }
      return out;
    };

    const isUp = (key: string) => key === "\x1b[A" || key === "\x1bOA" || /^\x1b\[\d+;\d+A$/.test(key);
    const isDown = (key: string) => key === "\x1b[B" || key === "\x1bOB" || /^\x1b\[\d+;\d+B$/.test(key);
    const isLeft = (key: string) => key === "\x1b[D" || key === "\x1bOD" || /^\x1b\[\d+;\d+D$/.test(key);
    const isRight = (key: string) => key === "\x1b[C" || key === "\x1bOC" || /^\x1b\[\d+;\d+C$/.test(key);
    const isMouseSequence = (key: string) => key.startsWith("\x1b[<") || key.startsWith("\x1b[M");
    const isCtrlEnter = (key: string) =>
      key === "\x1b[13;5u" ||
      key === "\x1b[27;5;13~" ||
      key === "\x1b[13;5~" ||
      key === "\x1b[27;13;5~" ||
      key === "\x1b[1;5M" ||
      /^\x1b\[\d+;5[~u]$/.test(key) ||
      /^\x1b\[\d+;\d+;13~$/.test(key);
    const isF6 = (key: string) => key === "\x1b[17~";

    const onData = (chunk: string) => {
      for (const key of splitChunk(chunk)) {
      if (pickerActive) continue;
      const realCursorPos = inputBuffer.length - cursorOffset;

      // Ctrl+C
      if (key === '\u0003') {
        inputBuffer = "";
        cursorOffset = 0;
        try {
          render(promptStr, inputBuffer, cursorOffset);
        } catch {
          // ignore redraw failure and continue input collection
        }
        continue;
      }

      if (isF6(key)) {
        exec("code .", { timeout: 5_000 }, (error) => {
          if (error) {
            consoleUi.print(themeColor(THEME.error)("Failed to open IDE. Ensure `code` command is available."));
          } else {
            consoleUi.print(themeColor(THEME.success)("Opened IDE (VS Code)."));
          }
        });
        continue;
      }

      // CRLF from some terminals arrives as two events. Ignore the follow-up LF.
      if (key === "\n" && suppressNextLf) {
        suppressNextLf = false;
        continue;
      }

      // Ctrl+Enter / F5 / Enter submit from the prompt line.
      const isForceSubmitKey =
        key === '\x1b[15~' || // F5
        isCtrlEnter(key);
      const isEnterKey = key === '\r' || key === '\n';
      const shouldSubmit =
        isForceSubmitKey ||
        isEnterKey;

      if (shouldSubmit || isEnterKey) {
        if (key === "\r") suppressNextLf = true;
        // Submit
        cleanup();
        resolve(inputBuffer);
        return;
      }
      // Tab
      else if (key === '\t') {
        inputBuffer = inputBuffer.substring(0, realCursorPos) + "\t" + inputBuffer.substring(realCursorPos);
        cursorOffset = inputBuffer.length - (realCursorPos + 1);
      }
      // Backspace
      else if (key === '\x7f' || key === '\b') {
        if (realCursorPos > 0) {
          inputBuffer = inputBuffer.substring(0, realCursorPos - 1) + inputBuffer.substring(realCursorPos);
          cursorOffset = inputBuffer.length - (realCursorPos - 1);
        }
      }
      // Arrow Keys (ANSI sequences)
      else if (key.startsWith('\x1b[') || key.startsWith("\x1bO")) {
        if (isMouseSequence(key)) {
          // Ignore mouse wheel/drag sequences so scrolling doesn't inject input behavior.
        } else if (isRight(key)) { // Right
          if (cursorOffset > 0) cursorOffset--;
        } else if (isLeft(key)) { // Left
          if (cursorOffset < inputBuffer.length) cursorOffset++;
        }
      }
      // ESC: ignore.
      else if (key === "\x1b") {
      }
      // Normal characters
      else if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) <= 126) {
        if (key === '@') {
          pickerActive = true;
          void (async () => {
            try {
              const result = await openContextPicker({ maxPreviewLines: 20 });
              if (result.action === "confirm" && result.selected.length > 0) {
                const invalid = result.selected.filter((p) => /\s/.test(p));
                const safe = result.selected.filter((p) => !/\s/.test(p));
                if (invalid.length) {
                  consoleUi.print(themeColor(THEME.warning)(`Skipped ${invalid.length} path(s) with spaces.`));
                }
                if (safe.length) {
                  const tokens = safe.map((p) => `@${p}`).join(" ") + " ";
                  inputBuffer = inputBuffer.substring(0, realCursorPos) + tokens + inputBuffer.substring(realCursorPos);
                  cursorOffset = inputBuffer.length - (realCursorPos + tokens.length);
                }
              }
            } finally {
              pickerActive = false;
              try {
                render(promptStr, inputBuffer, cursorOffset);
              } catch {
                // ignore redraw failure and continue input collection
              }
            }
          })();
          continue;
        }
        inputBuffer = inputBuffer.substring(0, realCursorPos) + key + inputBuffer.substring(realCursorPos);
        cursorOffset = inputBuffer.length - (realCursorPos + 1);
      }

      try {
        render(promptStr, inputBuffer, cursorOffset);
      } catch {
        // ignore redraw failure and continue input collection
      }
      }
    };

    process.stdin.on('data', onData);
    process.stdin.resume();
    try {
      render(promptStr, inputBuffer, cursorOffset);
    } catch {
      // ignore first-render errors and continue in raw input mode
    }
  });
}

// Ensure clean exit if the process dies while raw mode is active
process.on('SIGINT', () => {
  if (isRawMode && process.stdin.setRawMode) {
    process.stdin.setRawMode(false);
    process.stdout.write("\x1b[?25h"); // Show cursor
  }
  process.stdout.write("\nUse /exit to quit.\n");
});

async function fallbackInputLoop(promptStr: string = "agent-cli > "): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  consoleUi.print(getToolbar());
  return new Promise<string>((resolve) => {
    rl.question(promptStr, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function loop(cb: (text: string) => Promise<unknown> | unknown) {
  try {
    while (true) {
      // Use fallback if not a TTY
      const value = process.stdin.isTTY ? await customInputLoop("agent-cli > ") : await fallbackInputLoop("agent-cli > ");
      const stripped = value.trim();

      if (!stripped) continue;
      if (["exit", "quit", "/exit", "/quit"].includes(stripped.toLowerCase())) break;

      // Handle simple inline shell commands
      if (stripped.startsWith("!")) {
        const shellCommand = stripped.slice(1).trim();
        if (!shellCommand) continue;
        const timeoutRaw = Number(cfg.get("command_timeout_ms", 30_000));
        const timeoutUnlimited = !Number.isFinite(timeoutRaw) || timeoutRaw <= 0;
        await new Promise<void>((resolve) => {
          const execOptions = timeoutUnlimited ? {} : { timeout: Math.floor(timeoutRaw) };
          exec(shellCommand, execOptions, (error, stdout, stderr) => {
            if (stdout) consoleUi.print(stdout);
            if (stderr) consoleUi.print(stderr);
            if (error) consoleUi.print(`Error: ${error.message}`);
            resolve();
          });
        });
        continue;
      }

      // Check attachments
      if (stripped.includes("@")) {
        const allFiles = new Set(getProjectFiles().map((x) => x.path));
        const maybe = stripped
          .split(/\s+/)
          .filter((x) => x.startsWith("@"))
          .map((x) => x.slice(1));
        for (const p of maybe) {
          const likelyNewFile = /[\\/]/.test(p) || /\.[A-Za-z0-9]{1,10}$/.test(p);
          // Basic check if it exists in tracked files
          if (!likelyNewFile && !allFiles.has(p.replace(/\\/g, "/"))) {
            consoleUi.print(themeColor(THEME.warning)(`Warning: attachment might not exist in project view: ${p}`));
          }
        }
      }

      try {
        await cb(stripped);
      } catch (err) {
        consoleUi.print(themeColor(THEME.error)(`Error during execution: ${String(err)}`));
      }
    }
  } finally {
    if (isRawMode && process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
      process.stdout.write("\x1b[?25h"); // ensure cursor is visible
    }
    // Ensure the process can terminate after /exit or /quit.
    process.stdin.pause();
  }
}
