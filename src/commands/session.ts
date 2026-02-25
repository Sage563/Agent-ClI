import { registry } from "./registry";
import {
  clear,
  clearOllamaSessionContext,
  deleteSession,
  getActiveSessionName,
  listSessions,
  renameSession,
  setActiveSessionName,
} from "../memory";
import { printError, printInfo, printSuccess } from "../ui/console";

registry.register("/session", "Manage sessions (list, new, load, delete, rename)")((_, args) => {
  if (args.length < 2) {
    printInfo(`Active Session: ${getActiveSessionName()}`);
    return true;
  }
  const sub = args[1].toLowerCase();
  if (sub === "list") {
    const sessions = listSessions();
    const current = getActiveSessionName();
    printInfo("Available Sessions:");
    if (!sessions.length) {
      printInfo("  (none)");
      return true;
    }
    sessions.forEach((name) => {
      printInfo(` ${name === current ? "*" : " "} ${name}`);
    });
    return true;
  }
  if (sub === "new") {
    const name = args[2] || `session_${Math.floor(Date.now() / 1000)}`;
    setActiveSessionName(name);
    clear();
    printSuccess(`Started new session: ${name}`);
    return true;
  }
  if (sub === "load") {
    if (args.length < 3) {
      printError("Usage: /session load <name>");
      return true;
    }
    const name = args[2];
    if (listSessions().includes(name)) {
      setActiveSessionName(name);
      printSuccess(`Switched to session: ${name}`);
    } else {
      printError(`Session not found: ${name}`);
    }
    return true;
  }
  if (sub === "delete") {
    if (args.length < 3) {
      printError("Usage: /session delete <name>");
      return true;
    }
    const name = args[2];
    if (!listSessions().includes(name)) {
      printError(`Session not found: ${name}`);
      return true;
    }
    deleteSession(name);
    printSuccess(`Deleted session: ${name}`);
    return true;
  }
  if (sub === "rename") {
    if (args.length < 4) {
      printError("Usage: /session rename <old_name> <new_name>");
      return true;
    }
    const oldName = args[2];
    const newName = args[3];
    if (!listSessions().includes(oldName)) {
      printError(`Session not found: ${oldName}`);
      return true;
    }
    if (listSessions().includes(newName)) {
      printError(`Session already exists: ${newName}`);
      return true;
    }
    if (renameSession(oldName, newName)) {
      printSuccess(`Renamed session: ${oldName} -> ${newName}`);
    } else {
      printError(`Failed to rename session: ${oldName}`);
    }
    return true;
  }
  printError("Usage: /session [list|new|load|delete|rename]");
  return true;
});

registry.register("/reset", "Clear current session memory")(() => {
  clear();
  clearOllamaSessionContext();
  printSuccess("Memory cleared.");
  return true;
});

export function registerSession() {
  return true;
}
    
