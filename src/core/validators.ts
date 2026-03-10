/**
 * Input validation and sanitization utilities
 * Prevents security issues and gracefully handles invalid input
 */

import { ValidationError } from "./error_handler";

/**
 * Sanitizes file paths to prevent directory traversal attacks
 */
export function sanitizeFilePath(input: string): string {
  // Remove null bytes
  let sanitized = input.replace(/\0/g, "");

  // Normalize path separators
  sanitized = sanitized.replace(/\\/g, "/");

  // Remove leading/trailing whitespace
  sanitized = sanitized.trim();

  // Reject paths that try to escape the workspace
  if (
    sanitized.includes("../") ||
    sanitized.includes("..\\") ||
    sanitized.startsWith("/")
  ) {
    throw new ValidationError("Invalid file path: directory traversal detected", {
      input,
    });
  }

  return sanitized;
}

/**
 * Validates file size (prevents loading extremely large files)
 */
export function validateFileSize(
  sizeBytes: number,
  maxSizeMB: number = 50
): boolean {
  const maxBytes = maxSizeMB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    throw new ValidationError(`File size ${sizeBytes} bytes exceeds limit of ${maxBytes}`, {
      sizeBytes,
      maxSizeMB,
    });
  }
  return true;
}

/**
 * Validates JSON structure safely
 */
export function validateJSON<T = unknown>(
  jsonString: string,
  schema?: {
    required?: string[];
    type?: "object" | "array";
  }
): T {
  try {
    const parsed = JSON.parse(jsonString);

    if (schema?.type === "object" && typeof parsed !== "object") {
      throw new ValidationError("Expected object type", { received: typeof parsed });
    }

    if (schema?.type === "array" && !Array.isArray(parsed)) {
      throw new ValidationError("Expected array type", { received: typeof parsed });
    }

    if (schema?.required && typeof parsed === "object" && parsed !== null) {
      for (const key of schema.required) {
        if (!(key in parsed)) {
          throw new ValidationError(`Missing required field: ${key}`);
        }
      }
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Invalid JSON format", { parseError: String(error) });
  }
}

/**
 * Validates and sanitizes string input
 */
export function sanitizeString(
  input: unknown,
  options: {
    maxLength?: number;
    allowEmpty?: boolean;
    pattern?: RegExp;
  } = {}
): string {
  const { maxLength = 10000, allowEmpty = true, pattern } = options;

  // Ensure string type
  if (typeof input !== "string") {
    throw new ValidationError("Expected string input", { received: typeof input });
  }

  // Check length
  if (input.length > maxLength) {
    throw new ValidationError(`String exceeds max length of ${maxLength}`, {
      length: input.length,
    });
  }

  // Check if empty is allowed
  if (!allowEmpty && input.trim().length === 0) {
    throw new ValidationError("String cannot be empty");
  }

  // Pattern validation
  if (pattern && !pattern.test(input)) {
    throw new ValidationError("String does not match required pattern", {
      pattern: pattern.source,
    });
  }

  return input.trim();
}

/**
 * Validates command input (prevents shell injection)
 */
export function sanitizeCommand(input: string): string {
  const sanitized = sanitizeString(input, { maxLength: 5000 });

  // Basic shell injection prevention
  const dangerousChars = [
    "$(",      // Command substitution
    "`",       // Backticks
    "$()",     // Command substitution
    "||",      // Command chaining
    "&&",      // Command chaining
    "|",       // Piping (only flag suspicious patterns)
    ";",       // Command separation
    ">",       // Redirection
    "<",       // Redirection
  ];

  // Check for patterns, but be lenient with pipes (common in legitimate commands)
  if (
    sanitized.includes("$(") ||
    sanitized.includes("`") ||
    (sanitized.includes("|") && sanitized.length < 20)
  ) {
    throw new ValidationError("Potentially dangerous command characters detected", {
      input: sanitized.substring(0, 100),
    });
  }

  return sanitized;
}

/**
 * Validates API keys (basic format check)
 */
export function validateApiKey(key: unknown): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new ValidationError("API key must be a non-empty string");
  }

  if (key.length < 10 || key.length > 500) {
    throw new ValidationError("API key length seems invalid", { length: key.length });
  }

  // Should not contain whitespace
  if (/\s/.test(key)) {
    throw new ValidationError("API key contains whitespace");
  }

  return key;
}

/**
 * Validates model identifier
 */
export function validateModelId(input: unknown): string {
  if (typeof input !== "string") {
    throw new ValidationError("Model ID must be a string", { received: typeof input });
  }

  const sanitized = input.trim();

  // Check length
  if (sanitized.length === 0 || sanitized.length > 200) {
    throw new ValidationError("Model ID length invalid", { length: sanitized.length });
  }

  // Only alphanumeric, hyphens, underscores, dots, and slashes allowed
  if (!/^[a-zA-Z0-9\-_./]+$/.test(sanitized)) {
    throw new ValidationError("Model ID contains invalid characters");
  }

  return sanitized;
}

/**
 * Validates URL format
 */
export function validateUrl(input: unknown): string {
  if (typeof input !== "string") {
    throw new ValidationError("URL must be a string", { received: typeof input });
  }

  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new ValidationError("URL must use HTTP or HTTPS protocol");
    }
    return url.toString();
  } catch {
    throw new ValidationError("Invalid URL format", { input });
  }
}

/**
 * Redacts sensitive data from strings (API keys, tokens, passwords)
 */
export function redactSensitiveData(input: string): string {
  return input
    .replace(/api[_-]?key['"=:\s]+[^\s'"]+/gi, 'api_key="[REDACTED]"')
    .replace(/token['"=:\s]+[^\s'"]+/gi, 'token="[REDACTED]"')
    .replace(/password['"=:\s]+[^\s'"]+/gi, 'password="[REDACTED]"')
    .replace(/secret['"=:\s]+[^\s'"]+/gi, 'secret="[REDACTED]"')
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]");
}
