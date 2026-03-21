export const BUILTIN_PROVIDERS = ["ollama", "openai", "anthropic", "gemini", "deepseek", "hf", "openrouter", "xai", "groq"] as const;

export type BuiltinProvider = (typeof BUILTIN_PROVIDERS)[number];

const PROVIDER_LABELS: Record<BuiltinProvider, string> = {
  ollama: "Ollama (Local)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  deepseek: "DeepSeek",
  hf: "Hugging Face",
  openrouter: "OpenRouter",
  xai: "xAI (Grok)",
  groq: "Groq",
};

export function getProviderLabel(provider: string): string {
  const key = provider.toLowerCase() as BuiltinProvider;
  return PROVIDER_LABELS[key] || provider;
}
