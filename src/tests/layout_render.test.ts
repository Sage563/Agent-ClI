import { describe, expect, it } from "vitest";
import { renderWorkspaceLayout } from "../ui/layout";

describe("workspace layout", () => {
  it("renders deterministically for identical input", () => {
    const input = {
      title: "Agent CLI Workspace",
      status: "STREAMING",
      response: "Hello",
      thought: "Plan",
      activity: ["Thinking", "Reading file"],
      fileTree: ["src/core/agent.ts", "src/ui/console.ts"],
      terminalOutput: "npm test",
    };
    const a = renderWorkspaceLayout(input);
    const b = renderWorkspaceLayout(input);
    expect(a).toBe(b);
  });
});

