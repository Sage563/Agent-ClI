#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require("child_process");
const path = require("path");

const projectRoot = path.join(__dirname, "..");

function run(command) {
  execSync(command, {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

run("npx tsc -p ./");
run("node scripts/local_deploy.js");
