#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGETS = ["dist", "build"];
const LOCK_CODES = new Set(["EPERM", "ENOTEMPTY", "EBUSY", "EACCES"]);

function sleepMs(ms) {
  const delay = Math.max(0, Math.floor(ms));
  if (!delay) return;
  const sab = new SharedArrayBuffer(4);
  const arr = new Int32Array(sab);
  Atomics.wait(arr, 0, 0, delay);
}

function tryRemove(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
  return !fs.existsSync(targetPath);
}

function removeWithRetries(targetPath, attempts = 8) {
  if (!fs.existsSync(targetPath)) return true;

  for (let i = 1; i <= attempts; i += 1) {
    try {
      if (tryRemove(targetPath)) return true;
    } catch (error) {
      if (!LOCK_CODES.has(String(error && error.code ? error.code : ""))) {
        const msg = error && error.message ? error.message : String(error);
        console.warn(`clean: failed removing ${path.relative(ROOT, targetPath)}: ${msg}`);
        return false;
      }
      sleepMs(Math.min(1200, 120 * i));
    }
  }

  // Last resort on Windows: rename out of the way, then delete renamed path.
  const moved = `${targetPath}.delete-${Date.now()}-${process.pid}`;
  try {
    fs.renameSync(targetPath, moved);
    try {
      fs.rmSync(moved, { recursive: true, force: true });
    } catch {
      // Non-fatal; renamed path is out of normal build flow.
    }
    return !fs.existsSync(targetPath);
  } catch (error) {
    const msg = error && error.message ? error.message : String(error);
    console.warn(`clean: skipped locked path ${path.relative(ROOT, targetPath)}: ${msg}`);
    return false;
  }
}

function main() {
  const strict = String(process.env.CLEAN_STRICT || "").trim() === "1";
  let failures = 0;
  for (const rel of TARGETS) {
    const full = path.join(ROOT, rel);
    const ok = removeWithRetries(full);
    if (!ok) failures += 1;
  }
  if (strict && failures > 0) {
    process.exit(1);
  }
}

main();
