import fs from "fs-extra";
import path from "path";
import {
  GENERATED_DEFAULT_AGENT_CONFIG,
  GENERATED_DEFAULT_MCP_CATALOG,
  GENERATED_DEFAULT_ONBOARDING_ART,
  GENERATED_DEFAULT_PROMPT_B64,
  GENERATED_DEFAULT_SECRETS,
} from "./runtime_assets.generated";
import { APP_CONFIG_FILE, APP_SECRETS_FILE, APP_MCP_CATALOG, APP_ONBOARDING_ART, APP_SESSIONS_DIR } from "./app_dirs";

function ensureFile(filePath: string, content: string) {
  if (fs.existsSync(filePath)) return;
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

export function ensureRuntimeAssets() {
  // Runtime defaults are embedded in generated assets.
  ensureFile(APP_CONFIG_FILE(), JSON.stringify(GENERATED_DEFAULT_AGENT_CONFIG, null, 2) + "\n");
  ensureFile(APP_SECRETS_FILE(), JSON.stringify(GENERATED_DEFAULT_SECRETS, null, 2) + "\n");
  ensureFile(APP_MCP_CATALOG(), JSON.stringify(GENERATED_DEFAULT_MCP_CATALOG, null, 2) + "\n");
  ensureFile(APP_ONBOARDING_ART(), JSON.stringify(GENERATED_DEFAULT_ONBOARDING_ART, null, 2) + "\n");
  fs.ensureDirSync(APP_SESSIONS_DIR());
}

/**
 * Returns the system prompt from generated runtime assets.
 */
export function getRuntimePrompt(): string {
  return Buffer.from(GENERATED_DEFAULT_PROMPT_B64, "base64").toString("utf8");
}