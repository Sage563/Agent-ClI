/**
 * Complete Provider Abstraction with Built-in Resilience
 * Unified base containing: legacy Provider, ResilientProvider, CircuitBreaker, Retry, Fallback, Health Checks
 */

import type { TaskPayload, Usage } from "../types";
import { ProviderError, isRecoverableError } from "../core/error_handler";
import { createScopedLogger, type ScopedLogger } from "../core/logger";

const logger = createScopedLogger("Provider");

export type ProviderCallOptions = {
  streamCallback?: (chunk: string) => void;
  onStreamActivity?: () => void;
  cancelSignal?: AbortSignal;
  retryOptions?: RetryOptions;
  timeoutMs?: number;
};

export type ProviderResult = {
  text: string;
  usage: Usage;
  thinking: string;
  provider_state?: Record<string, unknown>;
};

export interface ProviderConfig {
  name: string;
  timeout?: number;
  maxRetries?: number;
  enableCircuitBreaker?: boolean;
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  timeoutMs?: number;
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenRequests?: number;
}

type CircuitState = "closed" | "open" | "half_open";

// ============================================================================
// RESILIENCE PATTERNS
// ============================================================================

/**
 * Circuit breaker pattern - prevents cascading failures
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private options: Required<CircuitBreakerOptions>;

  constructor(options: CircuitBreakerOptions = {}) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      resetTimeoutMs: options.resetTimeoutMs ?? 60000,
      halfOpenRequests: options.halfOpenRequests ?? 1,
    };
  }

  async execute<T>(
    fn: () => Promise<T>,
    name: string = "operation"
  ): Promise<T> {
    if (this.state === "open") {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.options.resetTimeoutMs) {
        logger.info(`Entering half-open state for ${name}`);
        this.state = "half_open";
        this.successCount = 0;
      } else {
        throw new ProviderError(
          `Circuit breaker is open for ${name}`,
          "circuit_breaker",
          { name, state: "open" }
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state === "half_open") {
      this.successCount++;
      if (this.successCount >= this.options.halfOpenRequests) {
        logger.info("Circuit closed, resuming normal operation");
        this.state = "closed";
      }
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;

    if (this.failureCount >= this.options.failureThreshold) {
      logger.warn("Circuit breaker opened due to failures", {
        failureCount: this.failureCount,
      });
      this.state = "open";
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.successCount = 0;
  }
}

/**
 * Timeout enforcement
 */
export async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  if (timeoutMs <= 0) return fn();
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new ProviderError(
              `Operation timeout after ${timeoutMs}ms`,
              "timeout",
              { timeoutMs },
              true
            )
          ),
        timeoutMs
      )
    ),
  ]);
}

/**
 * Exponential backoff retry with jitter
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions & { name?: string } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    timeoutMs = 30000,
    name = "operation",
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await executeWithTimeout(fn, timeoutMs);
    } catch (error) {
      lastError = error;

      if (!isRecoverableError(error)) {
        logger.error(`Non-recoverable error in ${name}`, error);
        throw error;
      }

      if (attempt === maxRetries) {
        logger.error(
          `Failed after ${maxRetries + 1} attempts for ${name}`,
          error
        );
        break;
      }

      const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt);
      const delay = Math.min(exponentialDelay, maxDelayMs);
      const jitter = Math.random() * (delay * 0.1);

      logger.warn(`Retry attempt ${attempt + 1}/${maxRetries}`, {
        operation: name,
        delayMs: delay + jitter,
      });

      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }

  if (lastError instanceof Error) {
    throw new ProviderError(
      `${name} failed after retries: ${lastError.message}`,
      "max_retries_exceeded",
      { originalError: lastError.message },
      false
    );
  }

  throw lastError;
}

/**
 * Fallback chain - tries providers in sequence
 */
export async function executeWithFallback<T>(
  providers: Array<() => Promise<T>>,
  options: { name?: string } = {}
): Promise<T> {
  const { name = "fallback_operation" } = options;
  const errors: unknown[] = [];

  for (let i = 0; i < providers.length; i++) {
    try {
      logger.info(`Attempting provider ${i + 1}/${providers.length}`);
      return await providers[i]();
    } catch (error) {
      errors.push(error);
      if (i < providers.length - 1) {
        logger.warn(`Provider ${i + 1} failed, trying next`, {
          error: String(error),
        });
      }
    }
  }

  logger.error(`All ${providers.length} providers failed for ${name}`);
  throw new ProviderError(
    `All fallback providers exhausted for ${name}`,
    "all_providers_failed",
    { attemptCount: providers.length, errors: errors.map(String) },
    false
  );
}

/**
 * Health monitoring for providers
 */
export class ProviderHealthCheck {
  private lastHealthyTime: Record<string, number> = {};
  private healthCheckInterval: Record<string, NodeJS.Timeout> = {};

  startMonitoring(
    providerName: string,
    healthFn: () => Promise<boolean>,
    intervalMs: number = 60000
  ): void {
    this.healthCheckInterval[providerName] = setInterval(async () => {
      try {
        const isHealthy = await executeWithTimeout(healthFn, 10000);
        if (isHealthy) {
          this.lastHealthyTime[providerName] = Date.now();
          logger.debug(`${providerName} is healthy`);
        }
      } catch (error) {
        logger.error(`Health check failed for ${providerName}`, error);
      }
    }, intervalMs);
  }

  stopMonitoring(providerName: string): void {
    const interval = this.healthCheckInterval[providerName];
    if (interval) {
      clearInterval(interval);
      delete this.healthCheckInterval[providerName];
    }
  }

  isHealthy(providerName: string, maxFailureIntervalMs: number = 300000): boolean {
    const lastHealthy = this.lastHealthyTime[providerName];
    if (!lastHealthy) return true;

    const timeSinceHealthy = Date.now() - lastHealthy;
    return timeSinceHealthy <= maxFailureIntervalMs;
  }
}

// ============================================================================
// LEGACY PROVIDER (Backward Compatibility)
// ============================================================================

export abstract class Provider {
  abstract call(system: string, task: TaskPayload, opts?: ProviderCallOptions): Promise<ProviderResult>;
  abstract validate(): Promise<{ ok: boolean; message: string }>;
  protected flattenContent(content: any): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            return part.text || part.content || JSON.stringify(part);
          }
          return String(part);
        })
        .join("\n");
    }
    return String(content || "");
  }
}

// ============================================================================
// RESILIENT PROVIDER (Recommended)
// ============================================================================

/**
 * Enhanced provider with built-in resilience
 * 
 * Usage:
 * ```typescript
 * export class MyProvider extends ResilientProvider {
 *   constructor(apiKey: string) {
 *     super({ name: "my-provider", timeout: 30000, maxRetries: 3 });
 *   }
 *   
 *   protected async executeCall(system, task, opts) {
 *     // Your implementation - retries, timeouts, circuit breaking automatic!
 *   }
 *   
 *   protected async executeValidation() {
 *     // Your validation logic
 *   }
 * }
 * ```
 */
export abstract class ResilientProvider {
  protected name: string;
  protected config: Required<ProviderConfig>;
  protected circuitBreaker: CircuitBreaker;
  protected healthCheck: ProviderHealthCheck;
  protected logger: ScopedLogger;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.config = {
      name: config.name,
      timeout: config.timeout ?? 30000,
      maxRetries: config.maxRetries ?? 3,
      enableCircuitBreaker: config.enableCircuitBreaker ?? true,
    };

    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 60000,
    });

    this.healthCheck = new ProviderHealthCheck();
    this.logger = createScopedLogger(`Provider:${config.name}`);
  }

  async call(
    system: string,
    task: TaskPayload,
    opts?: ProviderCallOptions
  ): Promise<ProviderResult> {
    let timeoutMs = opts?.timeoutMs ?? this.config.timeout;
    let retryOptions = opts?.retryOptions ?? { maxRetries: this.config.maxRetries };

    if (task._stream_enabled === true) {
      // Force unlimited timeout for streaming to prevent "invalidation".
      // We keep the retry options as-is (or let config decide) to handle transient connection drops.
      timeoutMs = 0;
    }

    if (!this.healthCheck.isHealthy(this.name)) {
      this.logger.warn("Provider health check unhealthy", { provider: this.name });
    }

    try {
      const result = await this.circuitBreaker.execute(
        async () =>
          executeWithRetry(
            async () =>
              executeWithTimeout(() => this.executeCall(system, task, opts), timeoutMs),
            { ...retryOptions, name: `${this.name}.call` }
          ),
        `${this.name}.call`
      );

      this.recordHealthy();
      return result;
    } catch (error) {
      this.recordUnhealthy();
      throw this.handleCallError(error);
    }
  }

  protected abstract executeCall(
    system: string,
    task: TaskPayload,
    opts?: ProviderCallOptions
  ): Promise<ProviderResult>;

  async validate(): Promise<{ ok: boolean; message: string }> {
    try {
      return await executeWithTimeout(() => this.executeValidation(), 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        message: `Validation failed: ${message}`,
      };
    }
  }

  protected abstract executeValidation(): Promise<{ ok: boolean; message: string }>;

  protected handleCallError(error: unknown): Error {
    if (error instanceof ProviderError) {
      return error;
    }

    let message = String(error);
    let code = "UNKNOWN_ERROR";
    let recoverable = true;

    if (error instanceof Error) {
      message = error.message;

      if (message.includes("timeout")) {
        code = "TIMEOUT";
      } else if (message.includes("401") || message.includes("403")) {
        code = "AUTH_ERROR";
        recoverable = false;
      } else if (message.includes("429")) {
        code = "RATE_LIMIT";
      } else if (message.includes("500") || message.includes("502")) {
        code = "SERVER_ERROR";
      } else if (message.includes("ECONNREFUSED")) {
        code = "CONNECTION_REFUSED";
      }
    }

    return new ProviderError(`${this.name}: ${message}`, code, { provider: this.name }, recoverable);
  }

  protected recordHealthy(): void {
    // Implementation for health tracking
  }

  protected recordUnhealthy(): void {
    // Implementation for health tracking
  }

  protected flattenContent(content: any): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            return part.text || part.content || JSON.stringify(part);
          }
          return String(part);
        })
        .join("\n");
    }
    return String(content || "");
  }

  shutdown(): void {
    this.healthCheck.stopMonitoring(this.name);
    this.circuitBreaker.reset();
  }
}
