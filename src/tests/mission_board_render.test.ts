import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("log-update", () => {
  const fn = vi.fn();
  (fn as any).clear = vi.fn();
  (fn as any).done = vi.fn();
  return { default: fn };
});

vi.mock("../ui/tui", () => ({
  isTuiEnabled: vi.fn(() => false),
  appendChat: vi.fn(),
  appendTool: vi.fn(),
  setStatus: vi.fn()
}));

import { MissionBoard } from "../ui/console";

describe("MissionBoard rendering", () => {
  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => { });
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true as any);
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

  beforeEach(() => {
    vi.useFakeTimers();
    consoleSpy.mockClear();
    stdoutSpy.mockClear();
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "rows", { value: 24, configurable: true });
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

  it("updates the live block on timer ticks using absolute positioning", () => {
    const board = new MissionBoard("test");
    board.update({ status: "STREAMING", live_text: "Currently Editing src/core/agent.ts", tasks: [{ text: "edit", done: false }] });
    stdoutSpy.mockClear();

    vi.advanceTimersByTime(150);

    // Should call write for at least the progress line and the thinking line
    expect(stdoutSpy).toHaveBeenCalled();
    const calls = stdoutSpy.mock.calls.map(c => c[0] as string);
    // Should contain CSI escape sequences for positioning (\x1b[row;colH)
    expect(calls.some(c => c.includes("\x1b["))).toBe(true);
    board.close();
  });
});
