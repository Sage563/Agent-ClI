import fs from "fs-extra";
import path from "path";
import {
  GENERATED_DEFAULT_CONFIG_B64,
  GENERATED_MCP_CATALOG_B64,
  GENERATED_DEFAULT_PROMPT_B64,
  GENERATED_SECRETS_B64,
} from "./runtime_assets.generated";

// Fallbacks for missing assets in extension's generated file
const GENERATED_DEFAULT_AGENT_CONFIG = JSON.parse(Buffer.from(GENERATED_DEFAULT_CONFIG_B64 || "", "base64").toString("utf8") || "{}");
const GENERATED_DEFAULT_MCP_CATALOG = JSON.parse(Buffer.from(GENERATED_MCP_CATALOG_B64 || "", "base64").toString("utf8") || "{}");
const GENERATED_DEFAULT_SECRETS = JSON.parse(Buffer.from(GENERATED_SECRETS_B64 || "", "base64").toString("utf8") || "{}");
const GENERATED_DEFAULT_ONBOARDING_ART = "Agent CLi";
import { APP_CONFIG_FILE, APP_SECRETS_FILE, APP_MCP_CATALOG, APP_ONBOARDING_ART, APP_SESSIONS_DIR, appDataDir } from "./app_dirs";

function ensureFile(filePath: string, content: string) {
  if (fs.existsSync(filePath)) return;
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function resolvePromptCandidates() {
  const runtimeAssetsDir = path.resolve(__dirname, "..", "assets");
  return [
    path.join(process.cwd(), "assets", "agent.prompt.txt"),
    path.join(process.cwd(), "agent.prompt.txt"),
    path.join(runtimeAssetsDir, "agent.prompt.txt"),
    path.join(appDataDir(), "agent.prompt.txt"),
    path.join(process.env.LOCALAPPDATA || "", "agent-cli", "agent.prompt.txt"),
    path.join(process.env.APPDATA || "", "agent-cli", "agent.prompt.txt"),
  ].filter(Boolean);
}

export function ensureRuntimeAssets() {
  // The default prompt is embedded in the binary, but runtime can override it
  // by providing agent.prompt.txt in the workspace/app data.
  ensureFile(APP_CONFIG_FILE(), JSON.stringify(GENERATED_DEFAULT_AGENT_CONFIG, null, 2) + "\n");
  ensureFile(APP_SECRETS_FILE(), JSON.stringify(GENERATED_DEFAULT_SECRETS, null, 2) + "\n");
  ensureFile(APP_MCP_CATALOG(), JSON.stringify(GENERATED_DEFAULT_MCP_CATALOG, null, 2) + "\n");
  ensureFile(APP_ONBOARDING_ART(), JSON.stringify(GENERATED_DEFAULT_ONBOARDING_ART, null, 2) + "\n");
  fs.ensureDirSync(APP_SESSIONS_DIR());
}

/**
 * Returns the system prompt.
 * If agent.prompt.txt exists (workspace/app-data locations), it is used.
 * Otherwise falls back to the base64-embedded default prompt.
 */
export function getRuntimePrompt(): string {
  for (const candidate of resolvePromptCandidates()) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const value = fs.readFileSync(candidate, "utf8");
      if (value.trim()) return value;
    } catch {
      // ignore and continue to fallback
    }
  }
  // Fallback: decode the base64-embedded prompt.
  return Buffer.from(GENERATED_DEFAULT_PROMPT_B64, "base64").toString("utf8");
}
