/**
 * Improved configuration management
 * Centralizes provider and model configurations for easier maintenance
 */

import { logger } from "./logger";

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  costPer1kInputTokens: number;
  costPer1kOutputTokens: number;
  description?: string;
  experimentalFeatures?: string[];
}

export interface ProviderInfo {
  id: string;
  name: string;
  apiKeyEnvVar: string;
  models: Record<string, ModelInfo>;
  defaultModel?: string;
  features?: {
    streaming?: boolean;
    vision?: boolean;
    reasoning?: boolean;
    tools?: boolean;
  };
}

/**
 * Centralized model catalog for easier maintenance
 * This replaces hardcoded lists in config.ts
 */
export const MODEL_CATALOG: Record<string, ProviderInfo> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    apiKeyEnvVar: "OPENAI_API_KEY",
    features: {
      streaming: true,
      vision: true,
      tools: true,
    },
    models: {
      "gpt-4o": {
        id: "gpt-4o",
        name: "GPT-4 Omni",
        contextWindow: 128000,
        costPer1kInputTokens: 0.0025,
        costPer1kOutputTokens: 0.01,
        description: "Latest GPT-4 with multimodal support",
        experimentalFeatures: ["vision"],
      },
      "gpt-4o-mini": {
        id: "gpt-4o-mini",
        name: "GPT-4 Omni Mini",
        contextWindow: 128000,
        costPer1kInputTokens: 0.00015,
        costPer1kOutputTokens: 0.0006,
        description: "Efficient GPT-4 variant",
      },
      "gpt-4-turbo": {
        id: "gpt-4-turbo",
        name: "GPT-4 Turbo",
        contextWindow: 128000,
        costPer1kInputTokens: 0.01,
        costPer1kOutputTokens: 0.03,
      },
      o1: {
        id: "o1",
        name: "o1",
        contextWindow: 200000,
        costPer1kInputTokens: 0.015,
        costPer1kOutputTokens: 0.06,
        description: "Reasoning model",
        experimentalFeatures: ["reasoning"],
      },
      "o1-mini": {
        id: "o1-mini",
        name: "o1 Mini",
        contextWindow: 128000,
        costPer1kInputTokens: 0.003,
        costPer1kOutputTokens: 0.012,
      },
      "o3-mini": {
        id: "o3-mini",
        name: "o3 Mini",
        contextWindow: 200000,
        costPer1kInputTokens: 0.0008,
        costPer1kOutputTokens: 0.0032,
      },
    },
    defaultModel: "gpt-4o-mini",
  },

  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
    features: {
      streaming: true,
      vision: true,
      tools: true,
    },
    models: {
      "claude-sonnet-4-20250514": {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4",
        contextWindow: 200000,
        costPer1kInputTokens: 0.003,
        costPer1kOutputTokens: 0.015,
        description: "Latest Claude Sonnet",
      },
      "claude-3-5-sonnet-20241022": {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        contextWindow: 200000,
        costPer1kInputTokens: 0.003,
        costPer1kOutputTokens: 0.015,
      },
      "claude-3-5-haiku-20241022": {
        id: "claude-3-5-haiku-20241022",
        name: "Claude 3.5 Haiku",
        contextWindow: 200000,
        costPer1kInputTokens: 0.0008,
        costPer1kOutputTokens: 0.004,
        description: "Fast and efficient",
      },
      "claude-3-opus-20240229": {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        contextWindow: 200000,
        costPer1kInputTokens: 0.015,
        costPer1kOutputTokens: 0.075,
      },
    },
    defaultModel: "claude-3-5-sonnet-20241022",
  },

  gemini: {
    id: "gemini",
    name: "Google Gemini",
    apiKeyEnvVar: "GEMINI_API_KEY",
    features: {
      streaming: true,
      vision: true,
      tools: true,
    },
    models: {
      "gemini-2.5-pro-preview-06-05": {
        id: "gemini-2.5-pro-preview-06-05",
        name: "Gemini 2.5 Pro",
        contextWindow: 1048576,
        costPer1kInputTokens: 0.001,
        costPer1kOutputTokens: 0.004,
        description: "Latest Gemini with huge context",
      },
      "gemini-2.5-flash-preview-05-20": {
        id: "gemini-2.5-flash-preview-05-20",
        name: "Gemini 2.5 Flash",
        contextWindow: 1048576,
        costPer1kInputTokens: 0.00005,
        costPer1kOutputTokens: 0.0002,
      },
      "gemini-2.0-flash": {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        contextWindow: 1048576,
        costPer1kInputTokens: 0.00005,
        costPer1kOutputTokens: 0.0002,
      },
    },
    defaultModel: "gemini-2.5-pro-preview-06-05",
  },

  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    apiKeyEnvVar: "DEEPSEEK_API_KEY",
    features: {
      streaming: true,
      vision: false,
      tools: true,
    },
    models: {
      "deepseek-chat": {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        contextWindow: 64000,
        costPer1kInputTokens: 0.00014,
        costPer1kOutputTokens: 0.00028,
        description: "Fast chat model",
      },
      "deepseek-reasoner": {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        contextWindow: 64000,
        costPer1kInputTokens: 0.00055,
        costPer1kOutputTokens: 0.0022,
        description: "Reasoning capabilities",
        experimentalFeatures: ["reasoning"],
      },
    },
    defaultModel: "deepseek-chat",
  },

  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    apiKeyEnvVar: "OLLAMA_ENDPOINT",
    features: {
      streaming: true,
      vision: false,
      tools: false,
    },
    models: {
      // Ollama models are user-configured
      default: {
        id: "default",
        name: "Local Model",
        contextWindow: 4096,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
        description: "User-provided model",
      },
    },
    defaultModel: "default",
  },

  hf: {
    id: "hf",
    name: "Hugging Face",
    apiKeyEnvVar: "HF_API_KEY",
    features: {
      streaming: false,
      vision: false,
      tools: false,
    },
    models: {
      "microsoft/Phi-3-mini-4k-instruct": {
        id: "microsoft/Phi-3-mini-4k-instruct",
        name: "Microsoft Phi-3 Mini",
        contextWindow: 4096,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
      },
      "mistralai/Mistral-7B-Instruct-v0.3": {
        id: "mistralai/Mistral-7B-Instruct-v0.3",
        name: "Mistral 7B",
        contextWindow: 32768,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
      },
      "HuggingFaceH4/zephyr-7b-beta": {
        id: "HuggingFaceH4/zephyr-7b-beta",
        name: "Zephyr 7B",
        contextWindow: 32768,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
      },
      "meta-llama/Meta-Llama-3-8B-Instruct": {
        id: "meta-llama/Meta-Llama-3-8B-Instruct",
        name: "Llama 3 8B",
        contextWindow: 8192,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
      },
      "Qwen/Qwen2.5-72B-Instruct": {
        id: "Qwen/Qwen2.5-72B-Instruct",
        name: "Qwen 2.5 72B",
        contextWindow: 32768,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
      },
      "Qwen/Qwen3.5-35B-A3B": {
        id: "Qwen/Qwen3.5-35B-A3B",
        name: "Qwen 3.5 35B",
        contextWindow: 8192,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
      },
      "google/gemma-2-9b-it": {
        id: "google/gemma-2-9b-it",
        name: "Gemma 2 9B",
        contextWindow: 8192,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
      },
      "meta-llama/Llama-2-7b-chat-hf": {
        id: "meta-llama/Llama-2-7b-chat-hf",
        name: "Llama 2 7B",
        contextWindow: 4096,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
      },
    },
    defaultModel: "mistralai/Mistral-7B-Instruct-v0.3",
  },
};

/**
 * Get all available providers
 */
export function getAvailableProviders(): string[] {
  return Object.keys(MODEL_CATALOG);
}

/**
 * Get provider information
 */
export function getProviderInfo(providerId: string): ProviderInfo | null {
  return MODEL_CATALOG[providerId] || null;
}

/**
 * Get all models for a provider
 */
export function getProviderModels(providerId: string): string[] {
  const provider = getProviderInfo(providerId);
  return provider ? Object.keys(provider.models) : [];
}

/**
 * Get model information
 */
export function getModelInfo(providerId: string, modelId: string): ModelInfo | null {
  const provider = getProviderInfo(providerId);
  return provider?.models[modelId] || null;
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(providerId: string): string | null {
  const provider = getProviderInfo(providerId);
  return provider?.defaultModel || null;
}

/**
 * Calculate cost for a model
 */
export function calculateModelCost(
  providerId: string,
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const model = getModelInfo(providerId, modelId);
  if (!model) {
    logger.warn("ConfigManager", `Model not found: ${providerId}/${modelId}`);
    return 0;
  }

  const inputCost = (inputTokens / 1000) * model.costPer1kInputTokens;
  const outputCost = (outputTokens / 1000) * model.costPer1kOutputTokens;

  return inputCost + outputCost;
}

/**
 * Get context window size for a model
 */
export function getContextWindow(providerId: string, modelId: string): number {
  const model = getModelInfo(providerId, modelId);
  return model?.contextWindow || 4096;
}

/**
 * Check if provider supports a feature
 */
export function supportsFeature(
  providerId: string,
  feature: "streaming" | "vision" | "reasoning" | "tools"
): boolean {
  const provider = getProviderInfo(providerId);
  return provider?.features?.[feature] ?? false;
}
