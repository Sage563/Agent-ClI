import { describe, expect, it } from "vitest";
import { registry } from "../commands/registry";

describe("command registry", () => {
  it("executes registered command and resolves aliases", async () => {
    const stamp = Date.now();
    const commandName = `/test-${stamp}`;
    const aliasName = `/t-${stamp}`;
    let called = "";

    registry.register(commandName, "test command", [aliasName])((_input, args) => {
      called = args.join(" ");
      return true;
    });

    const aliasResult = await registry.execute(`${aliasName} hello world`);
    expect(aliasResult).toBe(true);
    expect(called).toBe(`${aliasName} hello world`);

    const canonicalResult = await registry.execute(`${commandName} ok`);
    expect(canonicalResult).toBe(true);
    expect(called).toBe(`${commandName} ok`);
  });

  it("parses quoted command arguments", async () => {
    const stamp = Date.now();
    const commandName = `/quoted-${stamp}`;
    let captured: string[] = [];

    registry.register(commandName, "quoted args test")((_input, args) => {
      captured = args;
      return true;
    });

    const ok = await registry.execute(`${commandName} "hello world" 'x y' z`);
    expect(ok).toBe(true);
    expect(captured).toEqual([commandName, "hello world", "x y", "z"]);
  });

  it("suggests nearby commands", () => {
    const stamp = Date.now();
    const commandName = `/alpha-${stamp}`;
    registry.register(commandName, "suggestion test")(() => true);
    const suggestions = registry.suggestCommands(`/alp-${stamp}`, 5);
    expect(suggestions.includes(commandName)).toBe(true);
  });
});
