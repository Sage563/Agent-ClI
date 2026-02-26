#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUT_FILE = path.join(ROOT, "src", "runtime_assets.generated.ts");

const FALLBACK_PROMPT = "You are Agent CLI. Output valid JSON only.";
const FALLBACK_CONFIG = {
  active_provider: "ollama",
  providers: {
    ollama: {
      endpoint: "http://localhost:11434",
      model: "qwen3:14b",
      generation: { temperature: 0.7, num_ctx: 32768 },
    },
    openai: { model: "gpt-4o", generation: { temperature: 0 } },
    anthropic: { model: "claude-3-5-sonnet-20241022", generation: { temperature: 0, max_tokens: 4096 } },
    gemini: { model: "gemini-2.0-flash", generation: { temperature: 0, max_output_tokens: 1000 } },
    deepseek: { model: "deepseek-chat", generation: { temperature: 0 } },
  },
  run_policy: "ask",
  fast_mode: false,
  voice_mode: false,
  newline_support: true,
  visibility_allowed: false,
  auto_reload_session: false,
  web_browsing_allowed: false,
  planning_mode: false,
  mission_mode: false,
  max_budget: 10,
  mcp_enabled: false,
  mcp_servers: {},
  lint_command: "npm run lint",
  theme: {},
  think_mode: false,
  see_project_mode: false,
  effort_level: "medium",
  reasoning_level: "standard",
  stream: true,
  stream_print: true,
};
const FALLBACK_MCP = {
  language: "typescript",
  note: "Curated MCP servers and registries.",
  items: [],
};
const FALLBACK_MEMORY = {
  session: [],
  persistent: [],
};
const FALLBACK_ONBOARDING_ART = {
  dark: [
    " {px1}   .      *      .     {px2}   . ",
    "   *   .     {leafA}   .     *     {px3} ",
    "      .    .      {px2}     .    *   ",
    "{shift}             /\\",
    "{shift}            /**\\",
    "{shift}           /{leafA}{leafB}{leafA}{leafB}\\",
    "{shift}          /{leafB}{leafA}{leafB}{leafA}{leafB}{leafA}\\",
    "{shift}         /{leafA}{leafB}{leafA}{leafB}{leafA}{leafB}{leafA}{leafB}\\",
    "{shift}        /{leafB}{leafA}{leafB}{leafA}{leafB}{leafA}{leafB}{leafA}{leafB}{leafA}\\",
    "{shift}            ||||",
    "{shift}         ___||||___",
    "{shift}       _/___||||___\\_",
    "   {px3}  Midnight Pixel Tree  {px1}{px2}",
  ],
  white: [
    "  {px1}      \\   |   /        {px2}   ",
    "           ---  O  ---            ",
    "  {px3}      /   |   \\        {px1}   ",
    "      .         {px2}        .      ",
    "{shift}             /\\",
    "{shift}            /**\\",
    "{shift}           /{leafA}{leafB}{leafA}{leafB}\\",
    "{shift}          /{leafB}{leafA}{leafB}{leafA}{leafB}{leafA}\\",
    "{shift}         /{leafA}{leafB}{leafA}{leafB}{leafA}{leafB}{leafA}{leafB}\\",
    "{shift}            ||||",
    "{shift}         ___||||___",
    "{shift}       _/___||||___\\_",
    "   {px2}   Sunny Pixel Tree   {px3}",
  ],
};

const SECRET_KEY_RE = /(api[_-]?key|token|secret|password|passphrase|auth)/i;
const IP_FIELD_RE = /(endpoint|url|host|ip|baseurl|base_url)/i;
const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

function readText(fileName, fallback) {
  const p = path.join(ROOT, fileName);
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  } catch {
    // ignore
  }
  return fallback;
}

function readJson(fileName, fallback) {
  const p = path.join(ROOT, fileName);
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function isIpv4Host(value) {
  const m = String(value || "").trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (!m) return false;
  const parts = m[1].split(".").map((p) => Number(p));
  return parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
}

function sanitizeEndpointString(input) {
  const raw = String(input || "").trim();
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    if (isIpv4Host(u.hostname)) {
      u.hostname = "localhost";
      return u.toString();
    }
    return raw;
  } catch {
    const hostPort = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})(:\d+)?$/);
    if (hostPort && isIpv4Host(hostPort[1])) {
      return `localhost${hostPort[2] || ""}`;
    }
    return raw.replace(IPV4_RE, "localhost");
  }
}

function sanitizeConfigValue(key, value) {
  if (Array.isArray(value)) return value.map((v) => sanitizeConfigValue(key, v));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeConfigValue(k, v);
    }
    return out;
  }
  if (typeof value === "string") {
    if (SECRET_KEY_RE.test(String(key || ""))) return "";
    if (IP_FIELD_RE.test(String(key || ""))) return sanitizeEndpointString(value);
  }
  return value;
}

function sanitizeConfig(configRaw) {
  const cfg = sanitizeConfigValue("", configRaw);
  if (
    cfg &&
    cfg.providers &&
    cfg.providers.ollama &&
    typeof cfg.providers.ollama.endpoint === "string" &&
    !String(cfg.providers.ollama.endpoint).trim()
  ) {
    cfg.providers.ollama.endpoint = "http://localhost:11434";
  }
  return cfg;
}

function sanitizeMemory(memoryRaw) {
  if (!memoryRaw || typeof memoryRaw !== "object") return FALLBACK_MEMORY;
  return memoryRaw;
}

function toTsConst(name, value) {
  return `export const ${name} = ${JSON.stringify(value, null, 2)};\n`;
}

function generate() {
  const prompt = readText("agent.prompt.txt", FALLBACK_PROMPT);
  const config = sanitizeConfig(readJson("agent.config.json", FALLBACK_CONFIG));
  const mcpCatalog = readJson("mcp_catalog.json", FALLBACK_MCP);
  const memory = sanitizeMemory(readJson("memory.json", FALLBACK_MEMORY));
  const onboardingArt = readJson("onboarding.art.json", FALLBACK_ONBOARDING_ART);

  const out = [
    "/* AUTO-GENERATED FILE. DO NOT EDIT. */",
    "/* Generated by scripts/generate_runtime_assets.cjs */",
    "",
    `export const GENERATED_DEFAULT_PROMPT_B64 = ${JSON.stringify(Buffer.from(prompt).toString("base64"))};`,
    toTsConst("GENERATED_DEFAULT_AGENT_CONFIG", config),
    toTsConst("GENERATED_DEFAULT_SECRETS", {}),
    toTsConst("GENERATED_DEFAULT_MEMORY", memory),
    toTsConst("GENERATED_DEFAULT_MCP_CATALOG", mcpCatalog),
    toTsConst("GENERATED_DEFAULT_ONBOARDING_ART", onboardingArt),
  ].join("\n");

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, out, "utf8");
  console.log(`Generated ${path.relative(ROOT, OUT_FILE)}`);
}

generate();
