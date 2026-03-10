#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require("child_process");
const path = require("path");

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function runNpm(script) {
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const cmd = `${npmBin} run ${script}`;
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function runLocalTsc(args) {
  const tscPath = path.join("node_modules", "typescript", "bin", "tsc");
  const cmd = `node "${tscPath}" ${args}`.trim();
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function runOptional(cb, label) {
  try {
    cb();
  } catch (error) {
    const msg = error && error.message ? error.message : String(error);
    console.warn(`${label || "Optional step"} warning: ${msg}`);
  }
}

function main() {
  let exitCode = 0;
  try {
    console.log("Starting release compile pipeline...");
    runOptional(() => runNpm("clean:artifacts"), "Pre-clean");
    runOptional(() => runNpm("clean:release"), "Release pre-clean");
    runNpm("gen:runtime-assets");
    runLocalTsc("-p tsconfig.json --noEmit");
    run("node scripts/build_sea.cjs");
    runNpm("release:checksum");
    console.log("Release compile completed.");
  } catch (error) {
    exitCode = 1;
    console.error(`\nCompile failed: ${error && error.message ? error.message : String(error)}`);
  } finally {
    runOptional(() => runNpm("clean:artifacts"), "Cleanup");
    process.exit(exitCode);
  }
}

main();
