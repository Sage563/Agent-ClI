import { describe, expect, it } from "vitest";
import { formatSearchCitations } from "../core/tools";

describe("search citation formatter", () => {
  it("renders numbered source entries", () => {
    const text = formatSearchCitations(
      {
        "test query": [
          {
            index: 1,
            title: "Example Title",
            url: "https://example.com",
            snippet: "Snippet text",
            source: "Example Source",
            date: "2026-01-01",
          },
        ],
      },
      "text",
    );
    expect(text.includes("Search Results for: test query")).toBe(true);
    expect(text.includes("https://example.com")).toBe(true);
    expect(text.includes("Example Source")).toBe(true);
  });
});

