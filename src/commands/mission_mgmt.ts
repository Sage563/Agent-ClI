import Table from "cli-table3";
import { cfg } from "../config";
import { manager as procManager } from "../core/process";
import { listCheckpoints, loadCheckpoint } from "../core/utils";
import { printError, printInfo, printSuccess } from "../ui/console";
import { registry } from "./registry";

registry.register("/checkpoint", "Save the current mission state.")(() => {
  const missionId = `mission_${Math.floor(Date.now() / 1000)}`;
  printInfo(`Checkpointing system state to '${missionId}'...`);
  return true;
});

registry.register("/resume", "List or resume a saved mission. Usage: /resume [id]")((_, args) => {
  const checkpoints = listCheckpoints();
  if (args.length < 2) {
    if (!checkpoints.length) printError("No checkpoints found.");
    else {
      printInfo("Available checkpoints:");
      checkpoints.forEach((cp) => printInfo(` - ${cp}`));
    }
    return true;
  }
  const missionId = args[1];
  const state = loadCheckpoint(missionId);
  if (!state) {
    printError(`Checkpoint '${missionId}' not found.`);
    return true;
  }
  printSuccess(`Resuming mission '${missionId}'...`);
  return true;
});

registry.register("/budget", "Set the session cost limit. Usage: /budget <usd>")((_, args) => {
  if (args.length < 2) {
    printInfo(`Current budget: $${cfg.get("max_budget", 5.0)}`);
    return true;
  }
  const parsed = Number(args[1]);
  if (Number.isNaN(parsed)) {
    printError("Invalid budget amount.");
    return true;
  }
  cfg.set("max_budget", parsed);
  cfg.save();
  printSuccess(`Budget set to $${parsed.toFixed(2)}`);
  return true;
});

registry.register("/ps", "List active background processes.")(() => {
  const processes = procManager.listActive();
  if (!processes.length) {
    printInfo("No active background processes.");
    return true;
  }
  const table = new Table({ head: ["Handle", "Command", "Status"], style: { head: ["cyan"] } });
  processes.forEach((p) => table.push([p.handle, p.command, p.status]));
  console.log(table.toString());
  return true;
});

registry.register("/kill", "Kill a background process. Usage: /kill <handle>")((_, args) => {
  if (args.length < 2) {
    printError("Handle required.");
    return true;
  }
  if (procManager.kill(args[1])) {
    printSuccess(`Process ${args[1]} killed.`);
  } else {
    printError(`Process ${args[1]} not found.`);
  }
  return true;
});
