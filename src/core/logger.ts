/**
 * Structured logging system for Agent CLi
 * Provides consistent, level-based logging across the application
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogTarget = "console" | "file" | "event";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
  error?: {
    code?: string;
    stack?: string;
    context?: Record<string, unknown>;
  };
}

export interface Logger {
  debug(category: string, message: string, data?: Record<string, unknown>): void;
  info(category: string, message: string, data?: Record<string, unknown>): void;
  warn(category: string, message: string, data?: Record<string, unknown>): void;
  error(
    category: string,
    message: string,
    error?: unknown,
    data?: Record<string, unknown>
  ): void;
  setLevel(level: LogLevel): void;
}

export interface ScopedLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: unknown, data?: Record<string, unknown>): void;
  setLevel(level: LogLevel): void;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class AgentLogger implements Logger {
  private currentLevel: LogLevel = "info";
  private isDev: boolean = process.env.NODE_ENV === "development";

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.currentLevel];
  }

  private createEntry(
    level: LogLevel,
    category: string,
    message: string,
    data?: Record<string, unknown>,
    error?: unknown
  ): LogEntry {
    let errorInfo: LogEntry["error"] | undefined;

    if (error) {
      if (error instanceof Error) {
        errorInfo = {
          code: (error as any).code,
          stack: this.isDev ? error.stack : undefined,
          context:
            error instanceof Error && "context" in error
              ? (error as any).context
              : undefined,
        };
      } else if (typeof error === "object") {
        errorInfo = error as Record<string, unknown>;
      } else {
        errorInfo = { code: "UNKNOWN" };
      }
    }

    return {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
      error: errorInfo,
    };
  }

  private formatLog(entry: LogEntry): string {
    const levelStr = entry.level.toUpperCase().padEnd(5);
    const categoryStr = `[${entry.category}]`.padEnd(20);
    const timeStr = new Date(entry.timestamp).toISOString();

    let formatted = `${timeStr} ${levelStr} ${categoryStr} ${entry.message}`;

    if (entry.data && Object.keys(entry.data).length > 0) {
      formatted += ` | ${JSON.stringify(entry.data)}`;
    }

    if (entry.error) {
      formatted += ` | Error: ${JSON.stringify(entry.error)}`;
    }

    return formatted;
  }

  debug(category: string, message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) {
      const entry = this.createEntry("debug", category, message, data);
      console.log(this.formatLog(entry));
    }
  }

  info(category: string, message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      const entry = this.createEntry("info", category, message, data);
      console.log(this.formatLog(entry));
    }
  }

  warn(category: string, message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("warn")) {
      const entry = this.createEntry("warn", category, message, data);
      console.warn(this.formatLog(entry));
    }
  }

  error(
    category: string,
    message: string,
    error?: unknown,
    data?: Record<string, unknown>
  ): void {
    if (this.shouldLog("error")) {
      const entry = this.createEntry("error", category, message, data, error);
      console.error(this.formatLog(entry));
    }
  }
}

// Export singleton instance
export const logger = new AgentLogger();

/**
 * Create a scoped logger for a specific module/component
 */
export function createScopedLogger(scope: string): ScopedLogger {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => logger.debug(scope, msg, data),
    info: (msg: string, data?: Record<string, unknown>) => logger.info(scope, msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => logger.warn(scope, msg, data),
    error: (msg: string, err?: unknown, data?: Record<string, unknown>) => logger.error(scope, msg, err, data),
    setLevel: (level: LogLevel) => logger.setLevel(level),
  };
}
