#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const RELEASE_DIR = path.join(ROOT, "release");

function shouldDelete(name) {
  return /\.exe(\.sha256)?$/i.test(name);
}

function main() {
  if (!fs.existsSync(RELEASE_DIR)) return;
  const entries = fs.readdirSync(RELEASE_DIR);
  for (const name of entries) {
    if (!shouldDelete(name)) continue;
    const p = path.join(RELEASE_DIR, name);
    try {
      fs.rmSync(p, { force: true });
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      console.warn(`clean:release skipped locked file: ${name} (${msg})`);
    }
  }
}

main();
