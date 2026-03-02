import { describe, expect, it, vi } from "vitest";
import { displayThinking } from "../ui/agent_ui";

describe("mission output gating", () => {
  it("suppresses thought output when UI rendering is disabled", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await displayThinking("hidden thought", "", false, false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("suppresses thought output while mission board is active", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await displayThinking("hidden thought", "", true, true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("prints thought output in non-mission interactive mode", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await displayThinking("visible thought", "", true, false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
