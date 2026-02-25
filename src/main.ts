import { handle, SESSION_STATS } from "./core/agent";
import { loop } from "./input_mode";
import { cfg } from "./config";
import { getActiveSessionName } from "./memory";
import { printPanel, printSessionStats, THEME } from "./ui/console";
import { applyConfiguredThemeMode, runFirstLaunchOnboarding } from "./onboarding";
import { ensureRuntimeAssets } from "./runtime_assets";

type CliArgs = {
  query: string | null;
  plan: boolean;
  fast: boolean;
  yes: boolean;
  continueSession: boolean;
  oneshot: string | null;
  model: string | null;
};

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    query: null,
    plan: false,
    fast: false,
    yes: false,
    continueSession: false,
    oneshot: null,
    model: null,
  };
  const tokens = [...argv];
  while (tokens.length) {
    const token = tokens.shift() as string;
    if (token === "--plan") parsed.plan = true;
    else if (token === "--fast") parsed.fast = true;
    else if (token === "--yes" || token === "-y") parsed.yes = true;
    else if (token === "--continue-session" || token === "-c") parsed.continueSession = true;
    else if ((token === "--print" || token === "-p") && tokens.length) parsed.oneshot = tokens.shift() || null;
    else if (token === "--model" && tokens.length) parsed.model = tokens.shift() || null;
    else if (!token.startsWith("-") && !parsed.query) parsed.query = token;
  }
  return parsed;
}

export async function runMain() {
  try {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1Bc");
      console.clear();
    }
    ensureRuntimeAssets();
    applyConfiguredThemeMode();
    const args = parseArgs(process.argv.slice(2));
    if (args.plan) cfg.setPlanningMode(true);
    if (args.fast) cfg.setFastMode(true);
    if (args.model) {
      const provider = cfg.getActiveProvider();
      cfg.setModel(provider, args.model);
    }

    if (!args.oneshot) {
      await runFirstLaunchOnboarding();
    }

    if (process.stdout.isTTY) {
      // Ensure prior onboarding/welcome output does not remain on relaunch.
      process.stdout.write("\x1Bc");
      console.clear();
    }

    if (args.continueSession) {
      printPanel(`Continuing session: ${getActiveSessionName()}`, "Session", "blue");
    }

    if (args.oneshot) {
      await handle(args.oneshot, args);
      return;
    }

    const provider = cfg.getActiveProvider();
    const model = cfg.getModel(provider) || "unknown";
    const sessionName = getActiveSessionName();
    printPanel(
      `**Agent CLI** v1.1\n\n` +
      `Provider: **${provider}**\n` +
      `Model: **${model}**\n` +
      `Session: **${sessionName}**\n\n` +
      `Type \`/help\` for commands.\n` +
      `Type \`/config -h\` for all config options.\n` +
      `Use \`@file\` to attach context.\n` +
      `Use \`!command\` to run shell commands inline.\n` +
      `Enter = newline | Ctrl+Enter = submit | Double Enter = submit fallback | F5 = submit.`,
      "Ready",
      THEME.secondary || "cyan",
      true
    );

    if (args.query) await handle(args.query, args);
    await loop(async (text) => handle(text, args));
  } catch (error) {
    console.error("Agent CLI crashed with a fatal error:");
    console.error(error);
    process.exit(1);
  } finally {
    if (SESSION_STATS.input_tokens > 0) {
      printSessionStats(SESSION_STATS as unknown as Record<string, unknown>);
    }
  }
}
