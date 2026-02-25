import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let originalCwd = "";
let tempDir = "";

describe("memory compatibility", () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-cli-memory-"));
    process.chdir(tempDir);
    const appDirs = await import("../app_dirs");
    appDirs.setBaseDir(tempDir);
  });

  afterEach(async () => {
    const appDirs = await import("../app_dirs");
    appDirs.resetBaseDir();
    process.chdir(originalCwd);
    await fs.remove(tempDir);
  });

  it("writes and reads sessions in Python-compatible files", async () => {
    const memory = await import("../memory");
    memory.setActiveSessionName("alpha");
    memory.clear();
    memory.add({ role: "user", input: "hello" });
    memory.add({ role: "assistant", response: "hi there" });

    const sessionPath = path.join(tempDir, "sessions", "alpha.json");
    const activePath = path.join(tempDir, ".active_session");
    expect(await fs.pathExists(sessionPath)).toBe(true);
    expect(await fs.pathExists(activePath)).toBe(true);

    const loaded = memory.load("alpha");
    expect(loaded.name).toBe("alpha");
    expect(loaded.session.length).toBe(2);
    expect(loaded.session[0].role).toBe("user");
    expect(loaded.session[1].role).toBe("assistant");
  });
});
