import { execSync } from "child_process";
import fs from "fs-extra";

import readline from "readline";
import chalk from "chalk";
import logUpdate from "log-update";
import { cfg } from "./config";
import { reloadTheme, console, printPanel, THEME } from "./ui/console";
import { APP_ONBOARDING_ART } from "./app_dirs";
import { BUILTIN_PROVIDERS, getProviderLabel } from "./providers/catalog";

type ThemeMode = "dark" | "white" | "follow_windows";
type AccessScope = "limited" | "full_desktop";
type SelectOption = { label: string; description?: string };
type ArtTemplate = { dark?: string[]; white?: string[]; night?: string[]; day?: string[] };
type TokenChoice = { value: number | null; label: string; description: string };

const THEME_OPTIONS: Array<{ label: string; value: ThemeMode; description: string }> = [
  { label: "Dark", value: "dark", description: "Night colors with darker contrast." },
  { label: "Sun", value: "white", description: "Day colors with brighter contrast." },
  { label: "Follow windows", value: "follow_windows", description: "Auto-follow your Windows light/dark setting." },
];

const DARK_THEME = {
  primary: "cyan",
  secondary: "magenta",
  accent: "cyan",
  success: "green",
  warning: "yellow",
  error: "red",
  dim: "gray",
  bg: "default",
};

const WHITE_THEME = {
  primary: "blue",
  secondary: "cyan",
  accent: "magenta",
  success: "green",
  warning: "yellow",
  error: "red",
  dim: "gray",
  bg: "default",
};

const PROVIDER_TOKEN_MAX: Record<string, number> = {
  ollama: 131072,
  openai: 128000,
  anthropic: 8192,
  gemini: 1048576,
  deepseek: 64000,
};

function buildTokenChoices(provider: string): TokenChoice[] {
  const max = Number(PROVIDER_TOKEN_MAX[provider] || 32768);
  const minBase = 1024;
  const levelTargets = [
    Math.max(minBase, Math.floor(max * 0.1)),
    Math.max(minBase, Math.floor(max * 0.25)),
    Math.max(minBase, Math.floor(max * 0.5)),
    Math.max(minBase, Math.floor(max * 0.75)),
    max,
  ];
  const steps = [...new Set(levelTargets)].sort((a, b) => a - b);
  const out: TokenChoice[] = steps.map((n, idx) => {
    const level = Math.min(5, idx + 1);
    return {
      value: n,
      label: `${level} - ${n.toLocaleString()} tokens`,
      description: level === 5 ? "Provider maximum." : `Level ${level} context/output cap.`,
    };
  });
  out.push({
    value: null,
    label: "Unlimited / model default",
    description: "Remove explicit cap (uses provider/model defaults).",
  });
  return out;
}

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

function setThemePreset(mode: ThemeMode, persist = true) {
  const resolved = resolveThemeMode(mode);
  const preset = resolved === "dark" ? DARK_THEME : WHITE_THEME;
  if (persist) cfg.set("theme_mode", mode);
  cfg.set("theme", preset);
  reloadTheme();
}

export function applyConfiguredThemeMode() {
  const raw = String(cfg.get("theme_mode", "") || "").trim().toLowerCase();
  if (raw !== "dark" && raw !== "white" && raw !== "follow_windows") return;
  setThemePreset(raw as ThemeMode, false);
}

function maskSecret(value: string) {
  if (!value) return "";
  if (value.length <= 6) return "*".repeat(value.length);
  return `${value.slice(0, 3)}${"*".repeat(Math.max(0, value.length - 6))}${value.slice(-3)}`;
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
        const color = ornaments[(rowIdx + i + shimmer) % ornaments.length];
        out += color(ch);
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
  modeFromIndex: (idx: number) => ThemeMode;
  title: string;
  description: string[];
  options: SelectOption[];
  initialIndex?: number;
  animate?: boolean;
  hint?: string;
  stepLabel?: string;
}): Promise<number> {
  const { modeFromIndex, title, description, options, initialIndex = 0, animate = true, hint, stepLabel } = params;
  if (!process.stdin.isTTY) return initialIndex;

  return await new Promise<number>((resolve) => {
    let index = initialIndex;
    let frame = 0;
    const stdin = process.stdin;
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode?.(true);
    stdin.resume();

    const render = () =>
      logUpdate(
        renderScreen({
          mode: modeFromIndex(index),
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
      if (key.ctrl && key.name === "c") {
        cleanup();
        resolve(index);
      }
    };

    stdin.on("keypress", onKeypress);
    render();
  });
}

function applyAccessScope(scope: AccessScope) {
  cfg.set("access_scope", scope);
  if (scope === "full_desktop") {
    cfg.set("permissions_mode", "full_access");
    cfg.set("permission_mode", "full_access");
    cfg.set("permissions", {
      mode: "full_access",
      read: "allow",
      write: "allow",
      execute: "allow",
      web: "allow",
    });
    cfg.setRunPolicy("always");
    cfg.setVisibilityAllowed(true);
    cfg.setWebBrowsingAllowed(true);
    return;
  }

  cfg.set("permissions_mode", "limited");
  cfg.set("permission_mode", "limited");
  cfg.set("permissions", {
    mode: "limited",
    read: "allow",
    write: "ask",
    execute: "ask",
    web: "ask",
  });
  cfg.setRunPolicy("ask");
  cfg.setVisibilityAllowed(false);
  cfg.setWebBrowsingAllowed(true);
}

function showStaticScreen(mode: ThemeMode, title: string, description: string[]) {
  printPanel(description.join("\n\n"), title, THEME.primary, true, false, true);
}

async function configureProvider(provider: string, mode: ThemeMode, alwaysAsk = false) {
  const providerLabel = getProviderLabel(provider);
  showStaticScreen(mode, `Configure Provider: ${providerLabel}`, ["Fill the fields below. Press Enter to keep defaults where shown."]);

  if (provider !== "ollama") {
    const existingKey = cfg.getApiKey(provider) || "";
    if (alwaysAsk || !existingKey) {
      const keyHint = existingKey ? ` [saved: ${maskSecret(existingKey)}]` : "";
      const key = (await console.input(`API key for ${providerLabel}${keyHint} (blank to keep/skip): `)).trim();
      if (key) cfg.setApiKey(provider, key);
    }
  }

  const existingEndpoint = cfg.getEndpoint(provider);
  const existingModel = cfg.getModel(provider);
  const defaultEndpoint = provider === "ollama" ? "http://localhost:11434" : (existingEndpoint || "");
  const defaultModel = provider === "ollama" ? "qwen3:14b" : (existingModel || "");

  const endpointLabel = provider === "ollama" ? "Ollama endpoint" : `Optional endpoint for ${providerLabel}`;
  const endpoint = (await console.input(`${endpointLabel} [${defaultEndpoint}]: `)).trim();
  if (endpoint || provider === "ollama") {
    cfg.setEndpoint(provider, endpoint || defaultEndpoint);
  }

  const modelLabel = provider === "ollama" ? "Ollama model" : `Optional model for ${providerLabel}`;
  const model = (await console.input(`${modelLabel} [${defaultModel}]: `)).trim();
  if (model || provider === "ollama") {
    cfg.setModel(provider, model || defaultModel);
  }

  const tokenKey = provider === "ollama" ? "num_ctx" : provider === "gemini" ? "max_output_tokens" : "max_tokens";
  const generation = (cfg.getProviderConfig(provider).generation || {}) as Record<string, unknown>;
  const existingTokenValue = generation[tokenKey];
  const tokenChoices = buildTokenChoices(provider);
  const existingNumeric = Number(existingTokenValue);
  const initialIndex =
    existingTokenValue === null || existingTokenValue === undefined || Number.isNaN(existingNumeric)
      ? Math.max(0, tokenChoices.length - 1)
      : Math.max(0, tokenChoices.findIndex((x) => x.value === existingNumeric));
  const selectedIndex = await selectWithArrows({
    modeFromIndex: () => mode,
    title: `Select Token Limit: ${providerLabel}`,
    description: [
      provider === "ollama"
        ? "Choose max context window (num_ctx) using arrow keys."
        : provider === "gemini"
          ? "Choose max output tokens using arrow keys."
          : "Choose max tokens using arrow keys.",
      "You can move all the way up to this provider's maximum.",
    ],
    options: tokenChoices.map((x) => ({ label: x.label, description: x.description })),
    initialIndex: initialIndex >= 0 ? initialIndex : 0,
    animate: true,
    stepLabel: "Provider Setup",
  });
  const picked = tokenChoices[selectedIndex] || tokenChoices[tokenChoices.length - 1];
  if (picked.value === null) {
    cfg.setGenerationParam(provider, tokenKey, null);
    if (provider === "ollama") {
      cfg.setGenerationParam("ollama", "num_ctx", PROVIDER_TOKEN_MAX.ollama);
    }
  } else {
    cfg.setGenerationParam(provider, tokenKey, Math.floor(picked.value));
  }
}

async function configureProvidersFirstRun(activeProvider: string, mode: ThemeMode) {
  const normalized = [...BUILTIN_PROVIDERS];
  const ordered = [activeProvider, ...normalized.filter((p) => p !== activeProvider)];

  for (const provider of ordered) {
    const isConfigured = cfg.getApiKey(provider) || (provider === "ollama" && cfg.getEndpoint("ollama"));

    if (provider !== activeProvider && isConfigured) {
      continue; // Skip already configured optional providers
    }

    if (provider !== activeProvider) {
      const providerLabel = getProviderLabel(provider);
      showStaticScreen(mode, "Optional Provider Setup", [`Configure ${providerLabel} now?`, "This provider is currently unconfigured.", "Type y/yes to configure, anything else to skip."]);
      const ask = (await console.input(`Configure ${providerLabel} now? (y/N): `)).trim().toLowerCase();
      if (!["y", "yes"].includes(ask)) continue;
    }
    await configureProvider(provider, mode, provider === activeProvider);
  }
}

export async function runFirstLaunchOnboarding() {
  if (Boolean(cfg.get("onboarding_completed", false))) return;

  const themeIdx = await selectWithArrows({
    modeFromIndex: (idx) => THEME_OPTIONS[idx]?.value || "dark",
    title: "Welcome to Agent CLI",
    description: [
      "First-time setup will take about one minute.",
      "Choose your color theme. This theme is used across the entire CLI UI.",
      "You can change it later in config.",
    ],
    options: THEME_OPTIONS.map((o) => ({ label: o.label, description: o.description })),
    initialIndex: 0,
    animate: true,
    stepLabel: "Step 1 of 5",
    hint: fs.existsSync(APP_ONBOARDING_ART()) ? "Live art: edit onboarding.art.json while this picker is open." : undefined,
  });

  const pickedTheme = THEME_OPTIONS[themeIdx]?.value || "dark";
  setThemePreset(pickedTheme, true);

  const accessOptions: Array<{ label: string; description: string; value: AccessScope }> = [
    {
      label: "Limited access (Recommended)",
      description: "Safer defaults: asks before sensitive write/execute actions.",
      value: "limited",
    },
    {
      label: "Full desktop access",
      description: "Broad autonomous permissions with reduced safeguards.",
      value: "full_desktop",
    },
  ];

  const accessIdx = await selectWithArrows({
    modeFromIndex: () => pickedTheme,
    title: "Choose AI Access Scope",
    description: ["Select how much access the agent should have to your system."],
    options: accessOptions.map((o) => ({ label: o.label, description: o.description })),
    initialIndex: 0,
    animate: true,
    stepLabel: "Step 2 of 5",
  });
  const scope = accessOptions[accessIdx]?.value || "limited";
  applyAccessScope(scope);

  const normalizedProviders = [...BUILTIN_PROVIDERS];
  const providerOptions = normalizedProviders.map((p) => ({
    label: getProviderLabel(p),
    description: `Set ${getProviderLabel(p)} as active provider`,
  }));
  const active = cfg.getActiveProvider();
  const providerInitial = Math.max(0, normalizedProviders.findIndex((p) => p === active));

  const providerIdx = await selectWithArrows({
    modeFromIndex: () => pickedTheme,
    title: "Select Active Provider",
    description: ["Choose the provider to use by default for this installation."],
    options: providerOptions,
    initialIndex: providerInitial,
    animate: true,
    stepLabel: "Step 3 of 5",
  });

  const pickedProvider = normalizedProviders[providerIdx] || "ollama";
  cfg.setActiveProvider(pickedProvider);

  await configureProvidersFirstRun(pickedProvider, pickedTheme);

  cfg.set("onboarding_completed", true);
}


