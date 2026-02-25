import fs from "fs-extra";
import path from "path";
import {
  GENERATED_DEFAULT_AGENT_CONFIG,
  GENERATED_DEFAULT_MCP_CATALOG,
  GENERATED_DEFAULT_ONBOARDING_ART,
  GENERATED_DEFAULT_PROMPT_B64,
  GENERATED_DEFAULT_SECRETS,
} from "./runtime_assets.generated";
import { APP_CONFIG_FILE, APP_SECRETS_FILE, APP_MCP_CATALOG, APP_ONBOARDING_ART, APP_SESSIONS_DIR, appDataDir } from "./app_dirs";

function ensureFile(filePath: string, content: string) {
  if (fs.existsSync(filePath)) return;
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

export function ensureRuntimeAssets() {
  // NOTE: The system prompt is intentionally NOT written to disk.
  // It is embedded in the binary as GENERATED_DEFAULT_PROMPT and returned
  // directly from getRuntimePrompt(). This prevents exposure via file extraction.
  ensureFile(APP_CONFIG_FILE(), JSON.stringify(GENERATED_DEFAULT_AGENT_CONFIG, null, 2) + "\n");
  ensureFile(APP_SECRETS_FILE(), JSON.stringify(GENERATED_DEFAULT_SECRETS, null, 2) + "\n");
  ensureFile(APP_MCP_CATALOG(), JSON.stringify(GENERATED_DEFAULT_MCP_CATALOG, null, 2) + "\n");
  ensureFile(APP_ONBOARDING_ART(), JSON.stringify(GENERATED_DEFAULT_ONBOARDING_ART, null, 2) + "\n");
  fs.ensureDirSync(APP_SESSIONS_DIR());

  // Remove legacy prompt files that may expose internal instructions.
  const legacyCandidates = [
    path.join(process.cwd(), "agent.prompt.txt"),
    path.join(appDataDir(), "agent.prompt.txt"),
    path.join(process.env.LOCALAPPDATA || "", "agent-cli", "agent.prompt.txt"),
    path.join(process.env.APPDATA || "", "agent-cli", "agent.prompt.txt"),
  ].filter(Boolean);
  for (const candidate of legacyCandidates) {
    try {
      if (candidate && fs.existsSync(candidate)) fs.removeSync(candidate);
    } catch {
      // ignore cleanup failures
    }
  }
}

/**
 * Returns the system prompt. Always returns the value compiled into the binary.
 * The prompt is NEVER read from or written to disk — this prevents extraction
 * via tools like 7-Zip or any file system inspection.
 */
export function getRuntimePrompt(): string {
  // Decode the base64-embedded prompt to further obscure it from string extraction
  return Buffer.from(GENERATED_DEFAULT_PROMPT_B64, "base64").toString("utf8");
}
