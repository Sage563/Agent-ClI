import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("log-update", () => {
  const fn = vi.fn();
  (fn as any).clear = vi.fn();
  (fn as any).done = vi.fn();
  return { default: fn };
});

import logUpdate from "log-update";
import { MissionBoard } from "../ui/console";

describe("MissionBoard rendering", () => {
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

  beforeEach(() => {
    vi.useFakeTimers();
    consoleSpy.mockClear();
    vi.mocked(logUpdate).mockClear();
    (logUpdate.clear as any).mockClear();
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ttyDescriptor) {
      Object.defineProperty(process.stdout, "isTTY", ttyDescriptor);
    }
  });

  it("does not append history lines for repeated transient updates", () => {
    const board = new MissionBoard("test");
    board.update({ status: "MISSION START", log: "Objective", tasks: [] });
    consoleSpy.mockClear();

    board.update({ status: "STREAMING", live_text: "Thinking...", tasks: [{ text: "step", done: false }] });
    board.update({ status: "STREAMING", live_text: "Thinking...", tasks: [{ text: "step", done: false }] });

    expect(consoleSpy).not.toHaveBeenCalled();
    board.close();
  });

  it("updates the live block on timer ticks without printing history", () => {
    const board = new MissionBoard("test");
    board.update({ status: "STREAMING", live_text: "Currently Editing src/core/agent.ts", tasks: [{ text: "edit", done: false }] });
    consoleSpy.mockClear();

    vi.advanceTimersByTime(150);

    expect(vi.mocked(logUpdate).mock.calls.length).toBeGreaterThan(1);
    expect(consoleSpy).not.toHaveBeenCalled();
    board.close();
  });
});
