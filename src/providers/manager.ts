import { cfg } from "../config";
import { BUILTIN_PROVIDERS } from "./catalog";

export { BUILTIN_PROVIDERS };

const PROVIDER_ALIASES: Record<string, string> = {
  local: "ollama",
  llama: "ollama",
  "google-gemini": "gemini",
  google: "gemini",
  claude: "anthropic",
  ds: "deepseek",
};

function normalizeProviderName(name?: string) {
  const raw = String(name || cfg.getActiveProvider() || "ollama").trim().toLowerCase();
  return PROVIDER_ALIASES[raw] || raw;
}

export async function getProvider(name?: string) {
  const providerName = normalizeProviderName(name);
  if (providerName === "ollama") {
    const { OllamaProvider } = await import("./ollama");
    return new OllamaProvider();
  }
  if (providerName === "openai") {
    const { OpenAIProvider } = await import("./openai");
    return new OpenAIProvider();
  }
  if (providerName === "anthropic") {
    const { AnthropicProvider } = await import("./anthropic");
    return new AnthropicProvider();
  }
  if (providerName === "gemini") {
    const { GeminiProvider } = await import("./gemini");
    return new GeminiProvider();
  }
  if (providerName === "deepseek") {
    const { DeepSeekProvider } = await import("./deepseek");
    return new DeepSeekProvider();
  }
  throw new Error(`Unknown provider: ${providerName}. Available: ${BUILTIN_PROVIDERS.join(", ")}`);
}
