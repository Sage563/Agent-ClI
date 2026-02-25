import { describe, expect, it } from "vitest";
import { extractJson, sanitizeAiEditedContent } from "../core/utils";

describe("core/utils", () => {
  it("extractJson finds valid JSON inside markdown fences", () => {
    const text = [
      "Some preface text",
      "```json",
      '{"response":"ok","plan":["a","b"]}',
      "```",
      "suffix",
    ].join("\n");
    const parsed = JSON.parse(extractJson(text));
    expect(parsed.response).toBe("ok");
    expect(parsed.plan).toEqual(["a", "b"]);
  });

  it("sanitizeAiEditedContent strips outer fences", () => {
    const raw = "```ts\nconst x = 1;\n```\n";
    expect(sanitizeAiEditedContent(raw)).toBe("const x = 1;");
  });
});
