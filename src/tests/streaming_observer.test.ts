import { describe, expect, it } from "vitest";
import { StreamingJsonObserver } from "../core/streaming";

describe("StreamingJsonObserver", () => {
  it("reassembles fragmented JSON fields and detects tool keys", () => {
    const observer = new StreamingJsonObserver(["web_search", "changes"]);
    const payload =
      '{"response":"Hello world","thought":"plan","web_search":["query"],"changes":[{"file":"src/a.ts","original":"","edited":"x"}]}';
    const chunks = [payload.slice(0, 17), payload.slice(17, 43), payload.slice(43, 88), payload.slice(88)];
    let combinedResponse = "";

    for (const chunk of chunks) {
      const out = observer.ingest(chunk);
      combinedResponse += out.deltas.response;
    }

    const snapshot = observer.snapshot();
    expect(snapshot.response).toBe("Hello world");
    expect(snapshot.thought).toBe("plan");
    expect(snapshot.seenToolKeys.includes("web_search")).toBe(true);
    expect(snapshot.seenToolKeys.includes("changes")).toBe(true);
    expect(combinedResponse.includes("Hello world")).toBe(true);
  });
});

