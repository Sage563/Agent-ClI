import type { ExecutionEvent } from "../types";

type Listener = (event: ExecutionEvent) => void;

class ExecutionEventBus {
  private listeners = new Set<Listener>();
  private history: ExecutionEvent[] = [];
  private readonly maxHistory = 200;

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: Omit<ExecutionEvent, "timestamp">) {
    const finalEvent: ExecutionEvent = {
      ...event,
      timestamp: Date.now(),
    };
    this.history.push(finalEvent);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }

    for (const listener of this.listeners) {
      try {
        listener(finalEvent);
      } catch {
        // Listener failures should never break execution flow.
      }
    }
  }

  getRecent(limit = 40) {
    const size = Math.max(1, Math.floor(limit));
    return this.history.slice(-size);
  }

  clear() {
    this.history = [];
  }
}

export const eventBus = new ExecutionEventBus();

