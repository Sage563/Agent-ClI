import { describe, expect, it } from "vitest";
import { listRecentDiffBatches, recordDiffBatch } from "../core/diff_tracker";

describe("diff tracker", () => {
  it("records and lists recent diff batches", () => {
    const before = listRecentDiffBatches(200).length;
    recordDiffBatch("test task", [
      { file: "src/a.ts", added: 10, removed: 2 },
      { file: "src/b.ts", added: 1, removed: 0 },
    ]);
    const after = listRecentDiffBatches(200);
    expect(after.length).toBeGreaterThanOrEqual(before + 1);
    const last = after[after.length - 1];
    expect(last.task).toContain("test task");
    expect(last.files.length).toBe(2);
    expect(last.files[0].file).toContain("src/a.ts");
  });
});

