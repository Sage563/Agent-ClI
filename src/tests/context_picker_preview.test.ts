import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { readPreviewLines } from "../ui/context_picker";

const tmpDirs: string[] = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cli-preview-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0, tmpDirs.length)) {
    fs.removeSync(dir);
  }
});

describe("context picker preview", () => {
  it("returns first 20 lines and marks truncation", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, "long.txt");
    const content = Array.from({ length: 30 }, (_, i) => `line-${i + 1}`).join("\n");
    fs.writeFileSync(file, content, "utf8");

    const rel = path.relative(process.cwd(), file);
    const preview = readPreviewLines(rel, 20);
    expect(preview.lines.length).toBe(20);
    expect(preview.lines[0]).toBe("line-1");
    expect(preview.lines[19]).toBe("line-20");
    expect(preview.truncated).toBe(true);
    expect(preview.binary).toBe(false);
  });

  it("marks binary preview as unavailable", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, "bin.dat");
    fs.writeFileSync(file, Buffer.from([0, 1, 2, 3, 4]));

    const rel = path.relative(process.cwd(), file);
    const preview = readPreviewLines(rel, 20);
    expect(preview.binary).toBe(true);
    expect(preview.lines[0]).toContain("Binary file preview unavailable");
  });
});
