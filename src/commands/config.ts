import { cfg } from "../config";
import { registry } from "./registry";
import { printError, printInfo, printPanel, printSuccess, printWarning, reloadTheme } from "../ui/console";

const GENERATION_KEYS = new Set(["temperature", "max_tokens", "max_output_tokens", "num_ctx", "top_p", "top_k", "num_predict", "repeat_penalty"]);
const STREAM_KEYS = new Set(["stream", "stream_print"]);
const GLOBAL_STREAM_KEYS = new Set(["stream_global", "stream_print_global"]);
const NUMERIC_RUNTIME_KEYS = new Set(["stream_timeout_ms", "stream_retry_count", "stream_render_fps", "command_timeout_ms"]);
const BOOLEAN_RUNTIME_KEYS = new Set(["command_log_enabled", "env_bridge_enabled", "strict_edit_requires_full_access"]);
const THEME_KEYS = new Set(["primary", "secondary", "accent", "success", "warning", "error", "dim", "bg"]);
const VALID_PROVIDERS = ["ollama", "openai", "anthropic", "gemini", "deepseek"];
const CONFIG_HELP_FLAGS = new Set(["-h", "--help", "help"]);

function mask(key?: string) {
  if (!key) return "(not set)";
  if (key.length < 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function printConfigHelp() {
  let text = "## Usage\n";
  text += "- `/config`: Show current configuration snapshot\n";
  text += "- `/config -h`: Show this help\n";
  text += "- `/config <key>`: Show current value for a key\n";
  text += "- `/config <key> <value>`: Set key value\n";
  text += "\n## Providers\n";
  text += `- Valid providers: ${VALID_PROVIDERS.join(", ")}\n`;
  text += "- API keys: `<provider>_api_key` (example: `openai_api_key`)\n";
  text += "- Active provider: `/provider <name>`\n";
  text += "\n## Core Keys\n";
  text += "- `endpoint`\n";
  text += "- `run_policy` (`ask`, `always`, `never`)\n";
  text += "- `budget` (number)\n";
  text += "- `effort` (`low`, `medium`, `high`)\n";
  text += "- `reasoning` (`low`, `standard`, `high`, `extra`)\n";
  text += "- `mcp_enabled` (`true`/`false`)\n";
  text += "- `env_bridge_enabled` (`true`/`false`)\n";
  text += "- `command_log_enabled` (`true`/`false`)\n";
  text += "- `strict_edit_requires_full_access` (`true`/`false`)\n";
  text += "- `stream_timeout_ms`, `stream_retry_count`, `stream_render_fps`, `command_timeout_ms` (set `0` for unlimited)\n";
  text += "\n## Generation Keys (number)\n";
  text += `- ${Array.from(GENERATION_KEYS).join(", ")}\n`;
  text += "\n## Stream Keys\n";
  text += `- Provider scoped: ${Array.from(STREAM_KEYS).join(", ")}\n`;
  text += `- Global: ${Array.from(GLOBAL_STREAM_KEYS).join(", ")}\n`;
  text += "\n## Theme Keys\n";
  text += `- ${Array.from(THEME_KEYS).join(", ")} (use as \`theme.<key>\`)\n`;
  text += "\n## Ollama Convenience Keys\n";
  text += "- `ollama_endpoint`\n";
  text += "- `ollama_num_ctx`\n";
  text += "\n## Examples\n";
  text += "- `/config run_policy always`\n";
  text += "- `/config budget 20`\n";
  text += "- `/config temperature 0.2`\n";
  text += "- `/config theme.primary cyan`\n";
  text += "- `/config stream true`\n";
  text += "- `/config stream_global false`\n";
  printPanel(text, "Config Help");
}

registry.register("/config", "View or set configuration. Usage: /config [key] [value]")((_, args) => {
  if (args.length >= 2 && CONFIG_HELP_FLAGS.has(args[1].toLowerCase())) {
    printConfigHelp();
    return true;
  }

  if (args.length < 2) {
    const provider = cfg.getActiveProvider();
    let text = "## Provider & Model\n";
    for (const p of VALID_PROVIDERS) {
      const model = cfg.getModel(p);
      const endpoint = cfg.getEndpoint(p) || "(default)";
      const active = p === provider ? " <- active" : "";
      text += `- ${p}: model=\`${model}\`, endpoint=\`${endpoint}\`${active}\n`;
    }
    text += "\n## API Keys\n";
    for (const p of VALID_PROVIDERS) {
      text += `- ${p}: ${mask(cfg.getApiKey(p))}\n`;
    }
    text += `\n## Generation (${provider})\n`;
    const generation = (cfg.getProviderConfig(provider).generation || {}) as Record<string, unknown>;
    if (!Object.keys(generation).length) text += "- (defaults)\n";
    for (const [k, v] of Object.entries(generation)) text += `- ${k}: ${String(v)}\n`;
    text += "\n## Modes & Budget\n";
    text += `- run_policy: ${cfg.getRunPolicy()}\n`;
    text += `- fast_mode: ${cfg.isFastMode()}\n`;
    text += `- planning_mode: ${cfg.isPlanningMode()}\n`;
    text += `- mission_mode: ${cfg.isMissionMode()}\n`;
    text += `- voice_mode: ${cfg.isVoiceMode()}\n`;
    text += `- max_budget: $${cfg.getBudget().toFixed(2)}\n`;
    printPanel(text, "Config");
    return true;
  }

  const key = args[1].toLowerCase();
  if (args.length < 3) {
    if (key.endsWith("_api_key")) {
      const p = key.replace("_api_key", "");
      printInfo(`${key}: ${mask(cfg.getApiKey(p))}`);
    } else if (key.startsWith("theme.")) {
      const themeKey = key.split(".", 2)[1];
      printInfo(`${key}: ${cfg.getTheme()[themeKey] || "(not set)"}`);
    } else if (GENERATION_KEYS.has(key)) {
      const provider = cfg.getActiveProvider();
      const generation = (cfg.getProviderConfig(provider).generation || {}) as Record<string, unknown>;
      printInfo(`${key} (${provider}): ${String(generation[key] ?? "(default)")}`);
    } else if (STREAM_KEYS.has(key)) {
      const provider = cfg.getActiveProvider();
      printInfo(`${key} (${provider}): ${String(cfg.getProviderConfig(provider)[key] ?? "(default)")}`);
    } else if (GLOBAL_STREAM_KEYS.has(key)) {
      const globalKey = key.replace("_global", "");
      printInfo(`${key}: ${String(cfg.get(globalKey, "(default)"))}`);
    } else if (key === "budget") {
      printInfo(`max_budget: $${cfg.getBudget().toFixed(2)}`);
    } else if (key === "run_policy") {
      printInfo(`run_policy: ${cfg.getRunPolicy()}`);
    } else if (NUMERIC_RUNTIME_KEYS.has(key) || BOOLEAN_RUNTIME_KEYS.has(key)) {
      printInfo(`${key}: ${String(cfg.get(key, "(default)"))}`);
    } else if (key === "endpoint") {
      const provider = cfg.getActiveProvider();
      printInfo(`endpoint (${provider}): ${cfg.getEndpoint(provider) || "(default)"}`);
    } else {
      printWarning(`Unknown key: ${key}. Run /config to see all options.`);
    }
    return true;
  }

  const value = args.slice(2).join(" ");
  if (key.endsWith("_api_key")) {
    const provider = key.replace("_api_key", "");
    cfg.setApiKey(provider, value);
    printSuccess(`Set API key for ${provider}`);
    return true;
  }

  if (key === "endpoint") {
    const provider = cfg.getActiveProvider();
    cfg.setEndpoint(provider, value);
    printSuccess(`Set ${provider} endpoint to: ${value}`);
    return true;
  }

  if (GENERATION_KEYS.has(key)) {
    const provider = cfg.getActiveProvider();
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      printError(`Invalid value for ${key}: ${value} (expected a number)`);
      return true;
    }
    cfg.setGenerationParam(provider, key, parsed);
    printSuccess(`Set ${provider} ${key} = ${parsed}`);
    return true;
  }

  if (STREAM_KEYS.has(key)) {
    const provider = cfg.getActiveProvider();
    if (["true", "1", "on", "enable", "enabled"].includes(value.toLowerCase())) {
      cfg.setProviderParam(provider, key, true);
      printSuccess(`Set ${provider} ${key} = True`);
    } else if (["false", "0", "off", "disable", "disabled"].includes(value.toLowerCase())) {
      cfg.setProviderParam(provider, key, false);
      printSuccess(`Set ${provider} ${key} = False`);
    } else {
      printError(`${key} must be true/false`);
    }
    return true;
  }

  if (GLOBAL_STREAM_KEYS.has(key)) {
    const globalKey = key.replace("_global", "");
    if (["true", "1", "on", "enable", "enabled"].includes(value.toLowerCase())) {
      cfg.set(globalKey, true);
      printSuccess(`Set global ${globalKey} = True`);
    } else if (["false", "0", "off", "disable", "disabled"].includes(value.toLowerCase())) {
      cfg.set(globalKey, false);
      printSuccess(`Set global ${globalKey} = False`);
    } else {
      printError(`${key} must be true/false`);
    }
    return true;
  }

  if (NUMERIC_RUNTIME_KEYS.has(key)) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      printError(`${key} must be a number`);
      return true;
    }
    cfg.set(key, parsed);
    printSuccess(`Set ${key} = ${parsed}`);
    return true;
  }

  if (BOOLEAN_RUNTIME_KEYS.has(key)) {
    const v = value.toLowerCase();
    if (["true", "1", "on", "enable", "enabled", "yes"].includes(v)) {
      cfg.set(key, true);
      printSuccess(`Set ${key} = true`);
      return true;
    }
    if (["false", "0", "off", "disable", "disabled", "no"].includes(v)) {
      cfg.set(key, false);
      printSuccess(`Set ${key} = false`);
      return true;
    }
    printError(`${key} must be true/false`);
    return true;
  }

  if (key.startsWith("theme.")) {
    const colorKey = key.split(".", 2)[1];
    if (!THEME_KEYS.has(colorKey)) {
      printWarning(`Unknown theme key: ${colorKey}`);
      return true;
    }
    cfg.setThemeColor(colorKey, value);
    reloadTheme();
    printSuccess(`Set theme.${colorKey} = ${value}`);
    return true;
  }

  if (key === "run_policy") {
    if (["ask", "always", "never"].includes(value)) {
      cfg.setRunPolicy(value as any);
      printSuccess(`Set run policy to: ${value}`);
    } else {
      printError("run_policy must be: ask, always, or never");
    }
    return true;
  }

  if (key === "effort") {
    if (["low", "medium", "high"].includes(value.toLowerCase())) {
      cfg.setEffortLevel(value.toLowerCase());
      printSuccess(`Set effort level to: ${value.toLowerCase()}`);
    } else {
      printError("effort must be: low, medium, or high");
    }
    return true;
  }

  if (key === "reasoning") {
    const v = value.toLowerCase();
    if (["low", "standard", "high", "extra"].includes(v)) {
      cfg.setReasoningLevel(v === "extra" ? "high" : v);
      printSuccess(`Set reasoning level to: ${cfg.getReasoningLevel()}`);
    } else {
      printError("reasoning must be: low, standard, high, or extra");
    }
    return true;
  }

  if (key === "mcp_enabled") {
    if (["true", "1", "on", "enable", "enabled"].includes(value.toLowerCase())) {
      cfg.setMcpEnabled(true);
      printSuccess("MCP enabled.");
    } else if (["false", "0", "off", "disable", "disabled"].includes(value.toLowerCase())) {
      cfg.setMcpEnabled(false);
      printSuccess("MCP disabled.");
    } else {
      printError("mcp_enabled must be true/false");
    }
    return true;
  }

  if (key === "budget") {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) printError(`Invalid budget: ${value}`);
    else {
      cfg.setBudget(parsed);
      printSuccess(`Set max budget to: $${parsed.toFixed(2)}`);
    }
    return true;
  }

  if (key === "ollama_endpoint") {
    cfg.setEndpoint("ollama", value);
    printSuccess(`Set Ollama endpoint to: ${value}`);
    return true;
  }

  if (key === "ollama_num_ctx") {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) printError(`Invalid value: ${value}`);
    else {
      cfg.setGenerationParam("ollama", "num_ctx", parsed);
      printSuccess(`Set Ollama num_ctx to: ${value}`);
    }
    return true;
  }

  printWarning(`Unknown config key: ${key}`);
  printInfo(
    "Configurable keys: *_api_key, endpoint, temperature, max_tokens, num_ctx, top_p, stream, stream_print, stream_global, stream_print_global, stream_timeout_ms, stream_retry_count, stream_render_fps, command_timeout_ms, command_log_enabled, env_bridge_enabled, strict_edit_requires_full_access, theme.*, run_policy, budget",
  );
  printInfo("Run `/config -h` to see full config help.");
  return true;
});

registry.register("/provider", "Switch active provider")((_, args) => {
  if (args.length < 2) {
    printInfo(`Current provider: ${cfg.getActiveProvider()}`);
    return true;
  }
  const next = args[1].toLowerCase();
  if (VALID_PROVIDERS.includes(next)) {
    cfg.setActiveProvider(next);
    printSuccess(`Switched to provider: ${next}`);
  } else {
    printError(`Unknown provider: ${next}`);
  }
  return true;
});

registry.register("/unlimited", "Set unlimited tokens/context for active provider", ["/unlimted"])(() => {
  const provider = cfg.getActiveProvider();
  const paramKey = provider === "gemini" ? "max_output_tokens" : "max_tokens";
  cfg.setGenerationParam(provider, paramKey, null);
  let message = `Set ${provider} token limit to UNLIMITED (removed ${paramKey} cap).`;
  if (provider === "ollama") {
    cfg.setGenerationParam("ollama", "num_ctx", 131072);
    message += "\nSet Ollama context window to 131072 (128k).";
  } else if (provider === "anthropic") {
    cfg.setGenerationParam("anthropic", "max_tokens", 8192);
    message += "\nSet Anthropic max_tokens to 8192.";
  } else if (provider === "openai" || provider === "deepseek") {
    message += `\n${provider} uses model max limits.`;
  }
  printSuccess(message);
  return true;
});

registry.register("/voice", "Toggle voice output")(() => {
  cfg.setVoiceMode(!cfg.isVoiceMode());
  printInfo(`Voice mode: ${cfg.isVoiceMode() ? "ON" : "OFF"}`);
  return true;
});

registry.register("/fast", "Toggle fast mode (skips certain UI elements)")(() => {
  cfg.setFastMode(!cfg.isFastMode());
  printInfo(`Fast mode: ${cfg.isFastMode() ? "ON" : "OFF"}`);
  return true;
});

registry.register("/plan", "Toggle planning mode")(() => {
  cfg.setPlanningMode(!cfg.isPlanningMode());
  printInfo(`Planning mode: ${cfg.isPlanningMode() ? "ON" : "OFF"}`);
  return true;
});

registry.register("/mission", "Toggle mission mode (autonomous loop)")(() => {
  cfg.setMissionMode(!cfg.isMissionMode());
  printInfo(`Mission mode: ${cfg.isMissionMode() ? "ON" : "OFF"}`);
  return true;
});

const KNOWN_MODELS: Record<string, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini", "o3-mini"],
  anthropic: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
  gemini: ["gemini-2.5-pro-preview-06-05", "gemini-2.5-flash-preview-05-20", "gemini-2.0-flash"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  ollama: [],
};

registry.register("/model", "Switch or view AI model (e.g. /model gpt-4o-mini)")((_, args) => {
  const provider = cfg.getActiveProvider();
  const current = cfg.getModel(provider);
  if (args.length < 2) {
    const known = KNOWN_MODELS[provider] || [];
    let text = `**Provider:** ${provider}\n**Current Model:** ${current}\n\n`;
    if (known.length) {
      text += "**Available Models:**\n";
      known.forEach((model) => {
        const marker = model === current ? " <- active" : "";
        text += `- \`${model}\`${marker}\n`;
      });
    } else {
      text += "*Any model string is accepted for this provider.*\n";
    }
    printPanel(text, "Model Info", "blue");
    return true;
  }

  const nextModel = args[1];
  if ((KNOWN_MODELS[provider] || []).length && !KNOWN_MODELS[provider].includes(nextModel)) {
    printWarning(`'${nextModel}' is not in the known models for ${provider}. Setting anyway.`);
  }
  cfg.setModel(provider, nextModel);
  printSuccess(`Switched ${provider} model to: ${nextModel}`);
  return true;
});

registry.register("/timeout", "Set command timeout. Usage: /timeout <ms|unlimited>")((_, args) => {
  if (args.length < 2) {
    const current = Number(cfg.get("command_timeout_ms", 30_000));
    if (current <= 0) {
      printInfo("Command timeout: unlimited");
    } else {
      printInfo(`Command timeout: ${current}ms`);
    }
    return true;
  }
  const raw = String(args[1] || "").trim().toLowerCase();
  if (raw === "unlimited" || raw === "none" || raw === "off" || raw === "0") {
    cfg.set("command_timeout_ms", 0);
    printSuccess("Command timeout set to unlimited.");
    return true;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    printError("Usage: /timeout <ms|unlimited>");
    return true;
  }
  cfg.set("command_timeout_ms", Math.floor(parsed));
  printSuccess(`Command timeout set to ${Math.floor(parsed)}ms.`);
  return true;
});

export function registerConfig() {
  return true;
}
