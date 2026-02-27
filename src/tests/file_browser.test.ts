import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getProjectFiles, rankProjectFile, searchProjectFiles, type ProjectFileEntry } from "../file_browser";

const tmpDirs: string[] = [];

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cli-file-browser-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0, tmpDirs.length)) {
    fs.removeSync(dir);
  }
});

describe("file browser", () => {
  it("ignores known heavy directories in project indexing", () => {
    const dir = makeTmpDir();
    fs.ensureDirSync(path.join(dir, "src"));
    fs.ensureDirSync(path.join(dir, "node_modules", "x"));
    fs.writeFileSync(path.join(dir, "src", "app.ts"), "export {};\n", "utf8");
    fs.writeFileSync(path.join(dir, "node_modules", "x", "index.js"), "module.exports = 1;\n", "utf8");

    const files = getProjectFiles(dir).map((x) => x.path);
    expect(files).toContain("src/app.ts");
    expect(files.some((x) => x.includes("node_modules"))).toBe(false);
  });

  it("ranks exact basename over loose substring", () => {
    const entries: ProjectFileEntry[] = [
      { path: "src/core/agent.ts", basename: "agent.ts", segments: ["src", "core", "agent.ts"] },
      { path: "docs/agent-notes.md", basename: "agent-notes.md", segments: ["docs", "agent-notes.md"] },
    ];
    const ranked = searchProjectFiles(entries, "agent.ts", 10);
    expect(ranked[0]?.path).toBe("src/core/agent.ts");
    expect(rankProjectFile(entries[0], "agent.ts")).toBeGreaterThan(rankProjectFile(entries[1], "agent.ts"));
  });
});
