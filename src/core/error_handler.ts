/**
 * Centralized error handling utilities for Agent CLi
 * Provides type-safe error parsing, logging, and recovery mechanisms
 */

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>,
    public recoverable: boolean = false
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", context);
  }
}

export class ProviderError extends AppError {
  constructor(
    message: string,
    public provider: string,
    context?: Record<string, unknown>,
    recoverable: boolean = true
  ) {
    super(message, "PROVIDER_ERROR", context, recoverable);
  }
}

export class ConfigError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CONFIG_ERROR", context);
  }
}

/**
 * Safely extracts error message from any value
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === "string") return msg;
  }
  return String(error || "Unknown error");
}

/**
 * Safely parses error with full context
 */
export function parseError(error: unknown): {
  message: string;
  code: string;
  context?: Record<string, unknown>;
} {
  if (error instanceof AppError) {
    return {
      message: error.message,
      code: error.code,
      context: error.context,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      code: error.constructor.name,
      context: { stack: error.stack },
    };
  }

  return {
    message: extractErrorMessage(error),
    code: "UNKNOWN_ERROR",
  };
}

/**
 * Type guard for AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Type guard for recoverable errors
 */
export function isRecoverableError(error: unknown): boolean {
  if (error instanceof AppError) {
    return error.recoverable;
  }
  // Network and timeout errors are typically recoverable
  if (error instanceof Error) {
    return (
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("ECONNRESET") ||
      error.message.includes("ETIMEDOUT") ||
      error.message.includes("timeout")
    );
  }
  return false;
}

/**
 * Safe error logging that doesn't expose sensitive data
 */
export function logError(
  error: unknown,
  context: string,
  isDev: boolean = false
): void {
  const parsed = parseError(error);
  const timestamp = new Date().toISOString();

  const logEntry = {
    timestamp,
    context,
    code: parsed.code,
    message: parsed.message,
    ...(isDev && parsed.context && { context: parsed.context }),
  };

  // Log to stderr to avoid mixing with normal output
  console.error(JSON.stringify(logEntry));
}

/**
 * Async wrapper with error handling and optional retries
 */
export async function executeWithErrorHandling<T>(
  fn: () => Promise<T>,
  options: {
    context: string;
    onError?: (error: unknown) => void;
    isDev?: boolean;
    maxRetries?: number;
    retryDelay?: number;
  }
): Promise<T | null> {
  const { context, onError, isDev = false, maxRetries = 0, retryDelay = 1000 } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLast = attempt === maxRetries;
      logError(error, context, isDev);

      if (onError) {
        onError(error);
      }

      if (!isLast && isRecoverableError(error)) {
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
      } else if (isLast) {
        return null;
      }
    }
  }

  return null;
}

/**
 * Synchronous wrapper with error handling
 */
export function executeSync<T>(
  fn: () => T,
  options: {
    context: string;
    onError?: (error: unknown) => void;
    isDev?: boolean;
    fallback?: T;
  }
): T | null {
  const { context, onError, isDev = false, fallback = null } = options;

  try {
    return fn();
  } catch (error) {
    logError(error, context, isDev);
    if (onError) {
      onError(error);
    }
    return fallback as T | null;
  }
}
