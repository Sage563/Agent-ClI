import os from "os";
import path from "path";
import fs from "fs-extra";

/**
 * Returns the platform-appropriate app data directory for agent-cli.
 *
 * Windows: %APPDATA%/agent-cli
 * macOS:   ~/Library/Application Support/agent-cli
 * Linux:   ~/.config/agent-cli (or $XDG_CONFIG_HOME/agent-cli)
 *
 * This ensures that config, secrets, and sessions are always stored
 * in a consistent, writable location regardless of where the exe is launched from.
 */
export function getAppDataDir(): string {
    const platform = process.platform;

    let base: string;
    if (platform === "win32") {
        base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    } else if (platform === "darwin") {
        base = path.join(os.homedir(), "Library", "Application Support");
    } else {
        base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
    }

    const appDir = path.join(base, "agent-cli");
    fs.ensureDirSync(appDir);
    return appDir;
}

// Singleton so all modules share the same resolved path.
let _appDataDir: string | null = null;

export function setBaseDir(dir: string) {
    _appDataDir = dir;
    fs.ensureDirSync(dir);
}

export function resetBaseDir() {
    _appDataDir = null;
}

export function appDataDir(): string {
    if (!_appDataDir) {
        _appDataDir = getAppDataDir();
    }
    return _appDataDir;
}

// Convenience helpers
export const APP_CONFIG_FILE = (): string => path.join(appDataDir(), "agent.config.json");
export const APP_SECRETS_FILE = (): string => path.join(appDataDir(), ".secrets.json");
export const APP_MEMORY_FILE = (): string => path.join(appDataDir(), "memory.json");
export const APP_SESSIONS_DIR = (): string => path.join(appDataDir(), "sessions");
export const APP_ONBOARDING_ART = (): string => path.join(appDataDir(), "onboarding.art.json");
export const APP_MCP_CATALOG = (): string => path.join(appDataDir(), "mcp_catalog.json");
export const APP_ACTIVE_SESSION = (): string => path.join(appDataDir(), ".active_session");
