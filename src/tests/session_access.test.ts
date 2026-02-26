import { describe, expect, it } from "vitest";
import {
  ensureSessionAccessForPaths,
  getSessionAccessGrant,
  resetSessionAccessGrant,
  setSelectivePathDecision,
  setSessionAccessMode,
} from "../core/session_access";

describe("session access state", () => {
  it("honors allowlist in selective mode without prompting", async () => {
    resetSessionAccessGrant();
    setSessionAccessMode("selective");
    setSelectivePathDecision(["src/core/agent.ts"], true);
    const result = await ensureSessionAccessForPaths(["src/core/agent.ts"]);
    expect(result.allowed).toBe(true);
    expect(result.denied_paths.length).toBe(0);
  });

  it("returns denied paths from denylist", async () => {
    resetSessionAccessGrant();
    setSessionAccessMode("selective");
    setSelectivePathDecision(["src/private.ts"], false);
    const result = await ensureSessionAccessForPaths(["src/private.ts"]);
    expect(result.allowed).toBe(false);
    expect(result.denied_paths.length).toBe(1);
    const grant = getSessionAccessGrant();
    expect(grant.denylist.length).toBe(1);
  });
});

