const PRICING: Record<string, [number, number]> = {
  "gpt-4o": [2.5, 10.0],
  "gpt-4o-mini": [0.15, 0.6],
  "claude-3-5-sonnet-20241022": [3.0, 15.0],
  "claude-3-opus-20240229": [15.0, 75.0],
  "claude-3-haiku-20240307": [0.25, 1.25],
  "gemini-1.5-pro": [3.5, 10.5],
  "gemini-1.5-flash": [0.075, 0.3],
  deepseek: [0.14, 0.28],
  ollama: [0.0, 0.0],
};

export function calculateCost(modelName: string, inputTokens: number, outputTokens: number) {
  const key = Object.keys(PRICING).find((k) => modelName.includes(k));
  if (!key) return 0;
  const [inputPrice, outputPrice] = PRICING[key];
  return (inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice;
}
