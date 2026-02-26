#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require("child_process");

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function runOptional(cmd, label) {
  try {
    run(cmd);
  } catch (error) {
    const msg = error && error.message ? error.message : String(error);
    console.warn(`${label || "Optional step"} warning: ${msg}`);
  }
}

function main() {
  let exitCode = 0;
  try {
    console.log("Starting release compile pipeline...");
    runOptional("npm run clean:artifacts", "Pre-clean");
    runOptional("npm run clean:release", "Release pre-clean");
    run("npm run gen:runtime-assets");
    run("tsc -p tsconfig.json --noEmit");
    run("node scripts/build_sea.cjs");
    run("npm run release:checksum");
    console.log("Release compile completed.");
  } catch (error) {
    exitCode = 1;
    console.error(`\nCompile failed: ${error && error.message ? error.message : String(error)}`);
  } finally {
    runOptional("npm run clean:artifacts", "Cleanup");
    process.exit(exitCode);
  }
}

main();
