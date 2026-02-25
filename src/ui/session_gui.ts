import { execSync } from "child_process";
import fs from "fs-extra";
import chalk from "chalk";
import logUpdate from "log-update";
import readline from "readline";
import { APP_ONBOARDING_ART } from "../app_dirs";
import { cfg } from "../config";
import { getActiveSessionName, listSessions, readSession, setActiveSessionName } from "../memory";
import { printSuccess } from "./console";

type SessionSummary = {
  name: string;
  created: string;
  title: string;
};

type ThemeMode = "dark" | "white" | "follow_windows";
type SelectOption = { label: string; description?: string };
type ArtTemplate = { dark?: string[]; white?: string[]; night?: string[]; day?: string[] };

const ANSI_RE = /\x1B\[[0-9;]*m/g;

function visibleLength(text: string) {
  return text.replace(ANSI_RE, "").length;
}

function padAnsi(text: string, width: number) {
  const len = visibleLength(text);
  if (len >= width) return text;
  return text + " ".repeat(width - len);
}

function fitAnsi(text: string, width: number) {
  if (width <= 0) return "";
  if (visibleLength(text) <= width) return padAnsi(text, width);
  const plain = text.replace(ANSI_RE, "");
  if (width <= 1) return plain.slice(0, width);
  return `${plain.slice(0, width - 1)}...`;
}

function wrapPlain(text: string, width: number) {
  if (width <= 0) return [""];
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (word.length <= width) {
      current = word;
      continue;
    }
    lines.push(word.slice(0, Math.max(1, width - 3)) + "...");
    current = "";
  }
  if (current) lines.push(current);
  return lines;
}

function formatDate(epochSeconds?: number): string {
  if (!epochSeconds || !Number.isFinite(epochSeconds)) return "unknown";
  const d = new Date(epochSeconds * 1000);
  return d.toISOString().slice(0, 10);
}

function summarizeSession(name: string): SessionSummary {
  const data = (readSession(name) || {}) as Record<string, unknown>;
  const entries = Array.isArray(data.session) ? (data.session as Array<Record<string, unknown>>) : [];
  const metadata = (data.metadata || {}) as Record<string, unknown>;
  const firstUser = entries.find((e) => String(e.role || "") === "user");
  const firstTime = Number(firstUser?.time || entries[0]?.time || metadata.created_at || 0);
  const titleRaw = String(firstUser?.content || "(no prompt)").replace(/\s+/g, " ").trim();
  const title = titleRaw.length > 64 ? `${titleRaw.slice(0, 61)}...` : titleRaw;
  return {
    name,
    created: formatDate(firstTime),
    title,
  };
}

function isWindowsDarkMode() {
  if (process.platform !== "win32") return false;
  try {
    const cmd =
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v AppsUseLightTheme';
    const output = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const match = output.match(/AppsUseLightTheme\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i);
    if (!match) return false;
    const value = Number.parseInt(match[1], 16);
    return value === 0;
  } catch {
    return false;
  }
}

function resolveThemeMode(mode: ThemeMode): "dark" | "white" {
  if (mode === "follow_windows") return isWindowsDarkMode() ? "dark" : "white";
  return mode;
}

function loadArtTemplate(): ArtTemplate | null {
  try {
    if (!fs.existsSync(APP_ONBOARDING_ART())) return null;
    const parsed = fs.readJsonSync(APP_ONBOARDING_ART()) as ArtTemplate;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function replaceTokens(line: string, tokens: Record<string, string>) {
  let out = line;
  for (const [k, v] of Object.entries(tokens)) out = out.split(`{${k}}`).join(v);
  return out;
}

function colorizeTemplateLines(lines: string[], resolved: "dark" | "white", frame: number) {
  const leaf = resolved === "dark" ? chalk.hex("#2fbf4a") : chalk.hex("#1f9d3a");
  const leafHighlight = resolved === "dark" ? chalk.greenBright : chalk.hex("#29b64b");
  const snow = resolved === "dark" ? chalk.hex("#8ec5ff") : chalk.hex("#4ca6ff");
  const trunk = resolved === "dark" ? chalk.hex("#8B5A2B") : chalk.hex("#9b6a36");
  const ground = resolved === "dark" ? chalk.hex("#6d7b8d") : chalk.hex("#5a9fff");
  const skyObject = resolved === "dark" ? chalk.hex("#c8d4ff") : chalk.hex("#ffd65a");
  const skyGlow = resolved === "dark" ? chalk.hex("#e2e9ff") : chalk.hex("#fff08a");
  const ornaments = resolved === "dark"
    ? [chalk.cyanBright, chalk.yellowBright, chalk.magentaBright, chalk.redBright]
    : [chalk.blueBright, chalk.yellow, chalk.magenta, chalk.red];
  const shimmer = ((frame % 6) + 6) % 6;

  return lines.map((line, rowIdx) => {
    let out = "";
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === " ") {
        out += ch;
        continue;
      }
      if (ch === "*" || ch === "o" || ch === "+") {
        out += ornaments[(rowIdx + i + shimmer) % ornaments.length](ch);
        continue;
      }
      if (ch === "." || ch === ":") {
        out += snow(ch);
        continue;
      }
      if (ch === "O") {
        out += ((rowIdx + i + frame) % 4 === 0 ? skyGlow : skyObject)(ch);
        continue;
      }
      if (ch === "^" || ch === "/" || ch === "\\" || ch === "v") {
        out += ((i + rowIdx + frame) % 7 === 0 ? leafHighlight : leaf)(ch);
        continue;
      }
      if (ch === "|" || ch === "_" || ch === "#") {
        out += trunk(ch);
        continue;
      }
      if (ch === "=" || ch === "-") {
        out += ground(ch);
        continue;
      }
      out += ch;
    }
    return out;
  });
}

function defaultArtTemplate(_resolved: "dark" | "white"): string[] {
  return [
    "{shift}            {sky1}      .   .             ",
    "{shift}            {sky2}  .       .             ",
    "{shift}            {sky3}      .                ",
    "{shift}                  /\\                     ",
    "{shift}                 /{px1}{leafA}\\                    ",
    "{shift}                /  *  \\                   ",
    "{shift}               / {px2} {leafB} {px3} \\                  ",
    "{shift}              /  *  o  +  \\                 ",
    "{shift}             / *  +  o  *  \\                ",
    "{shift}            /________________\\               ",
    "{shift}                  |  |                    ",
    "{shift}                  |  |                    ",
    "{shift}                  |  |                    ",
    "{shift}                 _|__|_                   ",
    "{shift}            =================             ",
  ];
}

function treeArt(mode: ThemeMode, frame: number) {
  const resolved = resolveThemeMode(mode);
  const swayPattern = [-2, -1, 0, 1, 2, 1, 0, -1, -2];
  const sway = swayPattern[frame % swayPattern.length];
  const shift = " ".repeat(Math.max(0, 8 + sway));
  const leafFrames = ["*", "o", "+", "o", "*", "+", "o"];
  const leafA = leafFrames[frame % leafFrames.length];
  const leafB = leafFrames[(frame + 2) % leafFrames.length];
  const pixelFrames = [".", ":", "*", ".", "+", ".", ":"];
  const px1 = pixelFrames[frame % pixelFrames.length];
  const px2 = pixelFrames[(frame + 2) % pixelFrames.length];
  const px3 = pixelFrames[(frame + 4) % pixelFrames.length];
  const sky1 = resolved === "dark" ? "OO " : "OOO";
  const sky2 = resolved === "dark" ? "O  " : "OOO";
  const sky3 = resolved === "dark" ? "OO " : "OOO";
  const tokens = { leafA, leafB, px1, px2, px3, shift, sky1, sky2, sky3 };

  const custom = loadArtTemplate();
  const candidate = resolved === "dark" ? custom?.dark || custom?.night || [] : custom?.white || custom?.day || [];
  const templateLines = Array.isArray(candidate) && candidate.length >= 11 ? candidate : defaultArtTemplate(resolved);
  const rendered = templateLines.map((line) => replaceTokens(String(line || ""), tokens));
  return colorizeTemplateLines(rendered, resolved, frame);
}

function renderScreen(params: {
  mode: ThemeMode;
  frame: number;
  title: string;
  description: string[];
  options?: SelectOption[];
  selectedIndex?: number;
  hint?: string;
  stepLabel?: string;
}) {
  const { mode, frame, title, description, options = [], selectedIndex = 0, hint, stepLabel } = params;
  const resolved = resolveThemeMode(mode);
  const accent = resolved === "dark" ? chalk.cyanBright : chalk.blueBright;
  const textColor = resolved === "dark" ? chalk.gray : chalk.yellowBright;
  const border = resolved === "dark" ? chalk.gray : chalk.blue;
  const selectedBg = resolved === "dark" ? chalk.bgCyan.black : chalk.bgBlue.white;

  const art = treeArt(mode, frame);
  const cols = Math.max(60, process.stdout.columns || 120);
  const rows = Math.max(18, process.stdout.rows || 32);
  const contentRows = Math.max(10, rows - 2);
  const inner = Math.max(40, cols - 4);
  const leftWidth = Math.max(20, Math.min(56, Math.floor(inner * 0.36)));
  const rightWidth = Math.max(18, inner - leftWidth - 1);

  const right: string[] = [];
  if (stepLabel) right.push(chalk.bold(textColor(stepLabel)));
  right.push(accent.bold(title));
  for (const line of description) {
    for (const wrapped of wrapPlain(line, rightWidth)) right.push(textColor(wrapped));
  }

  if (options.length) {
    right.push("");
    right.push(accent("> Select an option:"));
    options.forEach((opt, idx) => {
      const selected = idx === selectedIndex;
      const marker = selected ? accent(">") : textColor(" ");
      const label = selected ? selectedBg(` ${opt.label} `) : textColor(opt.label);
      right.push(`${marker} ${label}`);
      if (opt.description) {
        for (const wrapped of wrapPlain(opt.description, Math.max(8, rightWidth - 2))) right.push(`  ${textColor(wrapped)}`);
      }
    });
  }

  right.push("");
  right.push(chalk.gray.bold.italic("Use Up/Down arrows, Enter to continue."));
  if (hint) {
    for (const wrapped of wrapPlain(hint, rightWidth)) right.push(chalk.gray(wrapped));
  }

  const clippedRight = right.length > contentRows ? [...right.slice(0, contentRows - 1), chalk.gray("...")] : right;
  const clippedArt = art.length > contentRows ? [...art.slice(0, contentRows - 1), chalk.gray("...")] : art;

  const TL = "\u250C";
  const TR = "\u2510";
  const BL = "\u2514";
  const BR = "\u2518";
  const T = "\u252C";
  const B = "\u2534";
  const V = "\u2502";
  const H = "\u2500";
  const lines: string[] = [];
  lines.push(`${border(TL)}${border(H.repeat(leftWidth))}${border(T)}${border(H.repeat(rightWidth))}${border(TR)}`);

  for (let i = 0; i < contentRows; i += 1) {
    const l = fitAnsi(clippedArt[i] || "", leftWidth);
    const r = fitAnsi(clippedRight[i] || "", rightWidth);
    lines.push(`${border(V)}${l}${border(V)}${r}${border(V)}`);
  }

  lines.push(`${border(BL)}${border(H.repeat(leftWidth))}${border(B)}${border(H.repeat(rightWidth))}${border(BR)}`);
  return lines.join("\n");
}

async function selectWithArrows(params: {
  mode: ThemeMode;
  title: string;
  description: string[];
  options: SelectOption[];
  initialIndex?: number;
  animate?: boolean;
  hint?: string;
  stepLabel?: string;
}): Promise<number | null> {
  const { mode, title, description, options, initialIndex = 0, animate = true, hint, stepLabel } = params;
  if (!process.stdin.isTTY) return initialIndex;

  return await new Promise<number | null>((resolve) => {
    let index = initialIndex;
    let frame = 0;
    const stdin = process.stdin;
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode?.(true);
    stdin.resume();

    const render = () =>
      logUpdate(
        renderScreen({
          mode,
          frame,
          title,
          description,
          options,
          selectedIndex: index,
          hint,
          stepLabel,
        }),
      );

    const timer = animate
      ? setInterval(() => {
        frame = (frame + 1) % 256;
        render();
      }, 180)
      : null;

    const cleanup = () => {
      if (timer) clearInterval(timer);
      stdin.setRawMode?.(false);
      stdin.removeListener("keypress", onKeypress);
      logUpdate.clear();
    };

    const onKeypress = (_str: string, key: readline.Key) => {
      if (!key) return;
      if (key.name === "up") {
        index = (index - 1 + options.length) % options.length;
        render();
        return;
      }
      if (key.name === "down") {
        index = (index + 1) % options.length;
        render();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(index);
        return;
      }
      if (key.name === "escape" || key.name === "q") {
        cleanup();
        resolve(null);
        return;
      }
      if (key.ctrl && key.name === "c") {
        cleanup();
        resolve(null);
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}

export async function showSessionGui() {
  const names = listSessions().sort((a, b) => a.localeCompare(b));
  const active = getActiveSessionName();
  const summaries = names.map((n) => summarizeSession(n));
  const modeRaw = String(cfg.get("theme_mode", "dark") || "dark").trim().toLowerCase();
  const mode: ThemeMode = modeRaw === "white" || modeRaw === "follow_windows" ? (modeRaw as ThemeMode) : "dark";

  if (!summaries.length) {
    const empty = renderScreen({
      mode,
      frame: 0,
      title: "Session Picker",
      description: ["No sessions found yet.", "Start a new conversation and it will appear here."],
      options: [],
      selectedIndex: 0,
      stepLabel: "Sessions",
      hint: "Use /session new to create one.",
    });
    process.stdout.write(`${empty}\n`);
    return;
  }

  const options: SelectOption[] = summaries.map((s) => ({
    label: `${s.name} (${s.title})`,
    description: `Date: ${s.created}`,
  }));
  const initialIndex = Math.max(0, summaries.findIndex((s) => s.name === active));

  if (!process.stdin.isTTY) {
    const text = summaries
      .map((s) => `${s.name === active ? "*" : " "} ${s.name} (${s.title}) - ${s.created}`)
      .join("\n");
    process.stdout.write(`${text || "(no sessions)"}\n`);
    return;
  }

  const pickedIdx = await selectWithArrows({
    mode,
    title: "Session Picker",
    description: ["Choose a session by Name (first prompt) and Date."],
    options,
    initialIndex,
    animate: true,
    stepLabel: "Sessions",
    hint: "Use Up/Down arrows to move, Enter to select, Esc to close.",
  });
  if (pickedIdx === null) return;

  const picked = summaries[pickedIdx];
  if (!picked) return;
  if (picked.name !== active) {
    setActiveSessionName(picked.name);
    printSuccess(`Switched to session: ${picked.name}`);
  }
}
