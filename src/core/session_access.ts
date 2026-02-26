import path from "path";
import { console, printPanel, printWarning, THEME } from "../ui/console";
import type { SessionAccessGrant, SessionAccessGrantMode } from "../types";

const state: SessionAccessGrant = {
  mode: "unknown",
  allowlist: [],
  denylist: [],
};

function normalizePath(filePath: string) {
  const abs = path.resolve(process.cwd(), String(filePath || "").trim());
  return abs.replace(/\\/g, "/");
}

function uniqueNormalized(paths: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    const clean = String(raw || "").trim();
    if (!clean) continue;
    const normalized = normalizePath(clean);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function getSessionAccessGrant() {
  return {
    ...state,
    allowlist: [...state.allowlist],
    denylist: [...state.denylist],
  };
}

export function resetSessionAccessGrant() {
  state.mode = "unknown";
  state.asked_at = undefined;
  state.allowlist = [];
  state.denylist = [];
}

export function setSessionAccessMode(mode: SessionAccessGrantMode) {
  state.mode = mode;
  state.asked_at = Date.now();
  if (mode === "full") {
    state.allowlist = [];
    state.denylist = [];
  }
}

function addAllowed(paths: string[]) {
  const merged = new Set([...state.allowlist, ...paths]);
  state.allowlist = [...merged];
  state.denylist = state.denylist.filter((entry) => !merged.has(entry));
}

function addDenied(paths: string[]) {
  const merged = new Set([...state.denylist, ...paths]);
  state.denylist = [...merged];
  state.allowlist = state.allowlist.filter((entry) => !merged.has(entry));
}

export function setSelectivePathDecision(paths: string[], allow: boolean) {
  const normalized = uniqueNormalized(paths);
  if (allow) addAllowed(normalized);
  else addDenied(normalized);
}

export async function ensureSessionAccessMode() {
  if (state.mode !== "unknown") return state.mode;

  printPanel(
    [
      "Do you want to grant full project access or selective file access?",
      "",
      "- `full` allows file actions without additional prompts for this session.",
      "- `selective` asks only for specific required files, once per file path.",
    ].join("\n"),
    "Project Access",
    THEME.warning,
    true,
  );

  while (true) {
    const answer = (await console.input("Access mode [full/selective] > ")).trim().toLowerCase();
    if (answer === "full" || answer === "f") {
      setSessionAccessMode("full");
      return state.mode;
    }
    if (answer === "selective" || answer === "s") {
      setSessionAccessMode("selective");
      return state.mode;
    }
    printWarning("Please type `full` or `selective`.");
  }
}

export async function ensureSessionAccessForPaths(paths: string[], reasonByPath?: Record<string, string>) {
  const mode = await ensureSessionAccessMode();
  const normalized = uniqueNormalized(paths);

  if (mode === "full") {
    return { allowed: true, denied_paths: [] as string[] };
  }

  const pending = normalized.filter((entry) => !state.allowlist.includes(entry) && !state.denylist.includes(entry));
  const deniedAlready = normalized.filter((entry) => state.denylist.includes(entry));
  if (!pending.length) {
    return { allowed: deniedAlready.length === 0, denied_paths: deniedAlready };
  }

  const lines = pending.map((entry) => {
    const rel = path.relative(process.cwd(), entry).replace(/\\/g, "/");
    const reason = reasonByPath?.[entry] || reasonByPath?.[rel] || "Required for requested task.";
    return `- \`${rel}\`: ${reason}`;
  });
  printPanel(lines.join("\n"), "Selective File Access Request", THEME.warning, true);

  const answer = (await console.input("Allow these files? [y/N] > ")).trim().toLowerCase();
  const allow = answer === "y" || answer === "yes";
  if (allow) addAllowed(pending);
  else addDenied(pending);

  const denied = normalized.filter((entry) => state.denylist.includes(entry));
  return { allowed: denied.length === 0, denied_paths: denied };
}

