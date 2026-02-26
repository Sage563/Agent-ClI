#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const RELEASE_DIR = path.join(ROOT, "release");

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function main() {
  if (!fs.existsSync(RELEASE_DIR)) {
    console.log("release directory not found, skipping checksum.");
    return;
  }

  const entries = fs.readdirSync(RELEASE_DIR).filter((f) => f.toLowerCase().endsWith(".exe"));
  if (!entries.length) {
    console.log("no exe files found, skipping checksum.");
    return;
  }

  for (const name of entries) {
    try {
      const exePath = path.join(RELEASE_DIR, name);
      const sum = sha256(exePath);
      const outPath = path.join(RELEASE_DIR, `${name}.sha256`);
      fs.writeFileSync(outPath, `${sum}  ${name}\n`, "utf8");
      console.log(`wrote ${path.relative(ROOT, outPath)}`);
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      console.warn(`skipped checksum for ${name}: ${msg}`);
    }
  }
}

main();

