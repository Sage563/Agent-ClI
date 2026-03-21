import { handle, SESSION_STATS } from "./core/agent";
import { loop } from "./input_mode";
import { cfg } from "./config";
import { getActiveSessionName } from "./memory";
import { printPanel, printSessionStats, setupScrollRegion, THEME } from "./ui/console";
import { initTui, isTuiEnabled, teardownTui } from "./ui/tui";
import { applyConfiguredThemeMode, runFirstLaunchOnboarding } from "./onboarding";
import { ensureRuntimeAssets } from "./runtime_assets";
import { eventBus } from "./core/events";
import chalk from "chalk";

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
    eventBus.emit({
      phase: "thinking",
      status: "start",
      message: "Agent CLi startup",
    });
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

    // Initialize TUI after onboarding
    if (!args.oneshot) {
      initTui();
    }

    if (args.continueSession) {
      printPanel(`Continuing session: ${getActiveSessionName()}`, "Session", "blue", false, false, true);
    }

    if (args.oneshot) {
      await handle(args.oneshot, args);
      return;
    }

    const provider = cfg.getActiveProvider();
    const model = cfg.getModel(provider) || "unknown";
    const sessionName = getActiveSessionName();

    // Only show ASCII logo and welcome panel in non-TUI mode
    if (!isTuiEnabled() || !process.stdout.isTTY) {
      const logoLines = [
        `      /\\                        _      ___   _ _ `,
        `     /  \\   __ _  ___ _ __ | |_   / __\\ | (_| )`,
        `    / /\\ \\ / _\` |/ _ \\ '_ \\| __| / /  | | | |/ `,
        `   / ____ \\ (_| |  __/ | | | |_ / /___| | | |  `,
        `  /_/    \\_\\__, |\\___|_| |_|\\__|\\____/|_|_|_|  `,
        `           |___/                               `
      ];

      // Smooth modern gradient from Cyan to Blue
      const hexColors = ['#00ffff', '#00e5ff', '#00ccff', '#00b2ff', '#0099ff', '#007fff'];
      const gradientLogo = logoLines.map((line, idx) => chalk.bold.hex(hexColors[idx])(line)).join('\n');
      console.log(`\n${gradientLogo}\n`);

      // Quick welcome info
      printPanel(
        `Provider: **${provider}**  \u2022  Model: **${model}**  \u2022  Session: **${sessionName}**\n\n` +
        `Type \`/help\` for commands or \`@\` to attach files.\n` +
        `Submit with Enter or F5.`,
        "Ready",
        THEME.secondary || "cyan",
        false,
        false,
        false
      );
    }

    if (!isTuiEnabled()) setupScrollRegion();
    if (args.query) await handle(args.query, args);
    await loop(async (text) => handle(text, args));
  } catch (error) {
    console.error("Agent CLi crashed with a fatal error:");
    console.error(error);
    teardownTui();
    eventBus.emit({
      phase: "error",
      status: "end",
      message: `Fatal error: ${String(error)}`,
      success: false,
    });
    process.exit(1);
  } finally {
    teardownTui();
    if (SESSION_STATS.input_tokens > 0) {
      printSessionStats(SESSION_STATS as unknown as Record<string, unknown>);
    }
    eventBus.emit({
      phase: "finished",
      status: "end",
      message: "Agent CLi shutdown",
      success: true,
    });
  }
}
