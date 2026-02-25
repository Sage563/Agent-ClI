import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let originalCwd = "";
let tempDir = "";

describe("config compatibility", () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-cli-config-"));
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

  it("loads defaults and persists Python-compatible json files", async () => {
    const mod = await import("../config");
    const config = new mod.Config();
    expect(config.getActiveProvider()).toBe("ollama");
    expect(config.isNewlineSupport()).toBe(true);
    expect(config.isMcpEnabled()).toBe(false);

    config.setApiKey("openai", "sk-test");
    config.setModel("openai", "gpt-4o-mini");
    config.setActiveProvider("openai");

    expect(await fs.pathExists(path.join(tempDir, "agent.config.json"))).toBe(true);
    expect(await fs.pathExists(path.join(tempDir, ".secrets.json"))).toBe(true);

    const onDiskConfig = await fs.readJson(path.join(tempDir, "agent.config.json"));
    const onDiskSecrets = await fs.readJson(path.join(tempDir, ".secrets.json"));
    expect(onDiskConfig.active_provider).toBe("openai");
    expect(onDiskConfig.providers.openai.model).toBe("gpt-4o-mini");

    const { decryptSecret } = await import("../crypto_store");
    expect(decryptSecret(onDiskSecrets.openai_api_key)).toBe("sk-test");
  });
});
