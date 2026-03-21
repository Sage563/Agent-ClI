import { describe, it, expect } from "vitest";
import { StreamingJsonObserver } from "../core/streaming";

describe("StreamingJsonObserver features", () => {
  const toolKeys = ["web_search", "commands", "changes"];

  it("should discover file edits for diff/creation signals", () => {
    const observer = new StreamingJsonObserver(toolKeys);
    const chunk1 = '{"response": "Editing...", "changes": [{"file": "src/main.ts", "diff": "..."}]}';
    const result = observer.ingest(chunk1);
    expect(result.fileEdits).toContain("src/main.ts");
  });

  it("should discover tool signals for command execution detection", () => {
    const observer = new StreamingJsonObserver(toolKeys);
    const chunk1 = '{"commands": [{"command": "npm test"}]}';
    const result = observer.ingest(chunk1);
    expect(result.toolSignals).toContain("commands");
    expect(observer.snapshot().seenToolKeys).toContain("commands");
  });

  it("should capture thinking/thought fields", () => {
    const observer = new StreamingJsonObserver(toolKeys);
    const chunk1 = '{"thought": "I will search...",';
    observer.ingest(chunk1);
    expect(observer.snapshot().thought).toBe("I will search...");
    
    const chunk2 = ' "response": "Results found"}';
    observer.ingest(chunk2);
    expect(observer.snapshot().response).toBe("Results found");
  });

  it("should handle partial JSON for live updates", () => {
    const observer = new StreamingJsonObserver(toolKeys);
    observer.ingest('{"response": "Hello ');
    expect(observer.snapshot().response).toBe("Hello ");
    observer.ingest('world"}');
    expect(observer.snapshot().response).toBe("Hello world");
  });

  it("should handle mixed raw text and structured data (simulated)", () => {
    const observer = new StreamingJsonObserver(toolKeys);
    // In our system, if it's raw text, the observer might not find anything.
    // We want to verify that snapshot still provides the raw buffer tail for fallbacks.
    observer.ingest("This is raw text");
    expect(observer.snapshot().rawTail).toContain("This is raw text");
  });
});
