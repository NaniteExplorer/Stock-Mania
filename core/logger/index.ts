/**
 * Logging abstraction.
 *
 * Call sites depend only on the `Logger` interface and the `logger` singleton.
 * SCALE: swap ConsoleLogger for a structured production logger (pino) wired to
 * OpenTelemetry / Prometheus exporters next session — no call-site changes.
 */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: unknown, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

class ConsoleLogger implements Logger {
  constructor(private readonly bindings: Record<string, unknown> = {}) {}

  private merge(meta?: Record<string, unknown>) {
    return { ...this.bindings, ...(meta ?? {}) };
  }

  debug(message: string, meta?: Record<string, unknown>) {
    if (process.env.NODE_ENV !== "production") {
      console.debug(`[debug] ${message}`, this.merge(meta));
    }
  }
  info(message: string, meta?: Record<string, unknown>) {
    console.info(`[info] ${message}`, this.merge(meta));
  }
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(`[warn] ${message}`, this.merge(meta));
  }
  error(message: string, error?: unknown, meta?: Record<string, unknown>) {
    console.error(`[error] ${message}`, error, this.merge(meta));
  }
  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger({ ...this.bindings, ...bindings });
  }
}

export const logger: Logger = new ConsoleLogger();
