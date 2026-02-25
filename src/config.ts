import { execSync } from "child_process";
import fs from "fs-extra";
import path from "path";
import type { ConfigShape } from "./types";
import { APP_CONFIG_FILE, APP_SECRETS_FILE } from "./app_dirs";
import { encryptSecret, decryptSecret } from "./crypto_store";
import { BUILTIN_PROVIDERS } from "./providers/catalog";

function loadJson(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) return {};
    return fs.readJsonSync(filePath);
  } catch {
    return {};
  }
}

export class Config {
  config: ConfigShape;
  secrets: Record<string, string>;

  constructor() {
    this.config = loadJson(APP_CONFIG_FILE()) as ConfigShape;
    const rawSecrets = loadJson(APP_SECRETS_FILE()) as Record<string, string>;
    // Decrypt all secrets into plaintext memory — save() will re-encrypt on disk
    this.secrets = {};
    for (const [k, v] of Object.entries(rawSecrets)) {
      this.secrets[k] = decryptSecret(v);
    }
    this.ensureDefaults();
  }

  private ensureDefaults() {
    if (!this.config.active_provider) this.config.active_provider = "ollama";
    if (!this.config.providers) {
      this.config.providers = {};
      if ((this.config as Record<string, unknown>).provider === "ollama") {
        this.config.providers.ollama = {
          endpoint: this.get("endpoint"),
          model: this.get("model"),
          generation: (this.get("generation", { num_ctx: 32768 }) as Record<string, unknown>) || { num_ctx: 32768 },
        };
      }
    }
    for (const providerName of BUILTIN_PROVIDERS) {
      if (!this.config.providers[providerName]) this.config.providers[providerName] = {};
      if (typeof this.config.providers[providerName].stream !== "boolean") {
        this.config.providers[providerName].stream = true;
      }
      if (typeof this.config.providers[providerName].stream_print !== "boolean") {
        this.config.providers[providerName].stream_print = true;
      }
    }

    const ollama = this.config.providers.ollama;
    if (ollama) {
      if (!ollama.generation) ollama.generation = {};
      if (typeof ollama.generation.num_ctx !== "number") ollama.generation.num_ctx = 32768;
    }

    if (typeof this.config.voice_mode !== "boolean") this.config.voice_mode = false;
    if (typeof this.config.newline_support !== "boolean") this.config.newline_support = true;
    if (typeof this.config.mission_mode !== "boolean") this.config.mission_mode = false;
    if (typeof this.config.visibility_allowed !== "boolean") this.config.visibility_allowed = false;
    if (typeof this.config.auto_reload_session !== "boolean") this.config.auto_reload_session = false;
    if (typeof this.config.web_browsing_allowed !== "boolean") this.config.web_browsing_allowed = false;
    if (typeof this.config.see_project_mode !== "boolean") this.config.see_project_mode = false;
    if (!this.config.mcp_servers) this.config.mcp_servers = {};
    if (typeof this.config.mcp_enabled !== "boolean") this.config.mcp_enabled = false;
    if (!this.config.theme) this.config.theme = {};
    if (!this.config.effort_level) this.config.effort_level = "medium";
    if (!this.config.reasoning_level) this.config.reasoning_level = "standard";
    if (typeof this.config.stream !== "boolean") this.config.stream = true;
    if (typeof this.config.stream_print !== "boolean") this.config.stream_print = true;
    if (typeof this.config.max_budget !== "number") this.config.max_budget = 10.0;
    if (typeof this.config.include_history !== "boolean") this.config.include_history = false;
    if (typeof this.config.auto_compact_enabled !== "boolean") this.config.auto_compact_enabled = true;
    if (typeof this.config.auto_compact_threshold_pct !== "number") this.config.auto_compact_threshold_pct = 90;
    if (typeof this.config.auto_compact_keep_recent_turns !== "number") this.config.auto_compact_keep_recent_turns = 8;
    if (!this.config.run_policy) this.config.run_policy = "ask";
  }

  save() {
    // Encrypt all secret values before writing to disk
    const encryptedSecrets: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.secrets)) {
      encryptedSecrets[k] = encryptSecret(v);
    }
    fs.writeJsonSync(APP_CONFIG_FILE(), this.config, { spaces: 2 });
    fs.writeJsonSync(APP_SECRETS_FILE(), encryptedSecrets, { spaces: 2 });

    // Harden file permissions (owner-only)
    try {
      if (process.platform === "win32") {
        // Windows: Remove inheritance and grant only current user R/W
        execSync(`icacls \"${APP_SECRETS_FILE()}\" /inheritance:r /grant:r \"%USERNAME%:(R,W)\"`, { stdio: "ignore" });
      } else {
        // POSIX: chmod 0600
        fs.chmodSync(APP_SECRETS_FILE(), 0o600);
      }
    } catch {
      // Ignore errors if permission hardening fails (e.g. non-admin or system restricted)
    }
  }

  get<T = unknown>(key: string, defaultValue?: T): T {
    const v = (this.config as Record<string, unknown>)[key];
    return (v === undefined ? defaultValue : (v as T)) as T;
  }

  set(key: string, value: unknown) {
    (this.config as Record<string, unknown>)[key] = value;
    this.save();
  }

  getProviderConfig(providerName: string): Record<string, any> {
    return (this.config.providers?.[providerName] || {}) as Record<string, any>;
  }

  getActiveProvider() {
    return this.config.active_provider || "ollama";
  }

  setActiveProvider(providerName: string) {
    this.config.active_provider = providerName;
    this.save();
  }

  getApiKey(providerName: string): string | undefined {
    const raw = this.secrets[`${providerName}_api_key`];
    if (!raw) return undefined;
    // Decrypt on read — handles both encrypted and legacy plaintext values
    return decryptSecret(raw) || undefined;
  }

  setApiKey(providerName: string, key: string) {
    // Store encrypted in memory — save() will encrypt again before writing
    // We store plaintext in memory and encrypt only on disk
    this.secrets[`${providerName}_api_key`] = key;
    this.save();
  }

  getModel(providerName: string): string {
    return this.getProviderConfig(providerName).model || "unknown";
  }

  setModel(providerName: string, modelName: string) {
    if (!this.config.providers) this.config.providers = {};
    if (!this.config.providers[providerName]) this.config.providers[providerName] = {};
    this.config.providers[providerName].model = modelName;
    this.save();
  }

  getEndpoint(providerName: string): string {
    return this.getProviderConfig(providerName).endpoint || "";
  }

  setEndpoint(providerName: string, endpoint: string) {
    if (!this.config.providers) this.config.providers = {};
    if (!this.config.providers[providerName]) this.config.providers[providerName] = {};
    this.config.providers[providerName].endpoint = endpoint;
    this.save();
  }

  getTheme(): Record<string, string> {
    const defaults = {
      primary: "gray",
      secondary: "magenta",
      accent: "cyan",
      success: "green",
      warning: "yellow",
      error: "red",
      dim: "gray",
      bg: "default",
    };
    return { ...defaults, ...(this.config.theme || {}) };
  }

  setThemeColor(colorKey: string, value: string) {
    if (!this.config.theme) this.config.theme = {};
    this.config.theme[colorKey] = value;
    this.save();
  }

  getBudget() {
    return this.config.max_budget ?? 10.0;
  }

  setBudget(amount: number) {
    this.config.max_budget = amount;
    this.save();
  }

  isPlanningMode() {
    return Boolean(this.config.planning_mode);
  }
  setPlanningMode(enabled: boolean) {
    this.config.planning_mode = enabled;
    this.save();
  }

  isFastMode() {
    return Boolean(this.config.fast_mode);
  }
  setFastMode(enabled: boolean) {
    this.config.fast_mode = enabled;
    this.save();
  }

  getRunPolicy() {
    return (this.config.run_policy || "ask") as "ask" | "always" | "never";
  }
  setRunPolicy(policy: "ask" | "always" | "never") {
    this.config.run_policy = policy;
    this.save();
  }

  isVoiceMode() {
    return Boolean(this.config.voice_mode);
  }
  setVoiceMode(enabled: boolean) {
    this.config.voice_mode = enabled;
    this.save();
  }

  isNewlineSupport() {
    return Boolean(this.config.newline_support);
  }
  setNewlineSupport(enabled: boolean) {
    this.config.newline_support = enabled;
    this.save();
  }

  isMissionMode() {
    return Boolean(this.config.mission_mode);
  }
  setMissionMode(enabled: boolean) {
    this.config.mission_mode = enabled;
    this.save();
  }

  isVisibilityAllowed() {
    return Boolean(this.config.visibility_allowed);
  }
  setVisibilityAllowed(enabled: boolean) {
    this.config.visibility_allowed = enabled;
    this.save();
  }

  isAutoReloadEnabled() {
    return Boolean(this.config.auto_reload_session);
  }
  setAutoReload(enabled: boolean) {
    this.config.auto_reload_session = enabled;
    this.save();
  }

  isWebBrowsingAllowed() {
    return Boolean(this.config.web_browsing_allowed);
  }
  setWebBrowsingAllowed(enabled: boolean) {
    this.config.web_browsing_allowed = enabled;
    this.save();
  }

  isSeeMode() {
    return Boolean(this.config.see_project_mode);
  }
  setSeeMode(enabled: boolean) {
    this.config.see_project_mode = enabled;
    this.save();
  }

  getEffortLevel() {
    return this.config.effort_level || "medium";
  }
  setEffortLevel(level: string) {
    this.config.effort_level = level;
    this.save();
  }

  getReasoningLevel() {
    return this.config.reasoning_level || "standard";
  }
  setReasoningLevel(level: string) {
    this.config.reasoning_level = level;
    this.save();
  }

  getMcpServers() {
    return this.config.mcp_servers || {};
  }
  setMcpServer(name: string, command: string, args: string[] = []) {
    if (!this.config.mcp_servers) this.config.mcp_servers = {};
    this.config.mcp_servers[name] = { command, args };
    this.save();
  }
  removeMcpServer(name: string) {
    if (this.config.mcp_servers && this.config.mcp_servers[name]) {
      delete this.config.mcp_servers[name];
      this.save();
    }
  }

  isMcpEnabled() {
    return Boolean(this.config.mcp_enabled);
  }
  setMcpEnabled(enabled: boolean) {
    this.config.mcp_enabled = enabled;
    this.save();
  }

  setGenerationParam(providerName: string, key: string, value: unknown) {
    if (!this.config.providers) this.config.providers = {};
    if (!this.config.providers[providerName]) this.config.providers[providerName] = {};
    if (!this.config.providers[providerName].generation) this.config.providers[providerName].generation = {};
    if (value === null || value === undefined) {
      delete this.config.providers[providerName].generation![key];
    } else {
      this.config.providers[providerName].generation![key] = value;
    }
    this.save();
  }

  setProviderParam(providerName: string, key: string, value: unknown) {
    if (!this.config.providers) this.config.providers = {};
    if (!this.config.providers[providerName]) this.config.providers[providerName] = {};
    if (value === null || value === undefined) {
      delete this.config.providers[providerName][key];
    } else {
      this.config.providers[providerName][key] = value;
    }
    this.save();
  }
}

export const cfg = new Config();
