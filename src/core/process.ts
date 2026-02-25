import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

class BackgroundProcess {
  command: string;
  handle: string;
  process: ChildProcessWithoutNullStreams;
  outputQueue: string[] = [];
  errorQueue: string[] = [];
  isRunning = true;

  constructor(command: string, handle: string) {
    this.command = command;
    this.handle = handle;
    this.process = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"] });

    this.process.stdout.on("data", (chunk: Buffer) => {
      this.outputQueue.push(chunk.toString("utf8"));
    });
    this.process.stderr.on("data", (chunk: Buffer) => {
      this.errorQueue.push(chunk.toString("utf8"));
    });
    this.process.on("exit", () => {
      this.isRunning = false;
    });
  }

  sendInput(text: string) {
    if (!this.isRunning || !this.process.stdin.writable) return;
    this.process.stdin.write(text.endsWith("\n") ? text : `${text}\n`);
  }

  readOutput() {
    const out = this.outputQueue.join("");
    const err = this.errorQueue.map((x) => `[ERR] ${x}`).join("");
    this.outputQueue = [];
    this.errorQueue = [];
    return `${out}${err}`;
  }

  kill() {
    this.process.kill();
    this.isRunning = false;
  }
}

export class ProcessManager {
  processes = new Map<string, BackgroundProcess>();

  spawn(command: string) {
    const handle = `proc_${Math.floor(Date.now() / 1000)}`;
    this.processes.set(handle, new BackgroundProcess(command, handle));
    return handle;
  }

  send(handle: string, text: string) {
    const proc = this.processes.get(handle);
    if (!proc) return false;
    proc.sendInput(text);
    return true;
  }

  read(handle: string) {
    const proc = this.processes.get(handle);
    if (!proc) return "Error: Handle not found.";
    return proc.readOutput();
  }

  kill(handle: string) {
    const proc = this.processes.get(handle);
    if (!proc) return false;
    proc.kill();
    this.processes.delete(handle);
    return true;
  }

  listActive() {
    const active: Array<{ handle: string; command: string; status: string }> = [];
    for (const [handle, proc] of this.processes.entries()) {
      if (proc.process.exitCode === null) {
        active.push({ handle, command: proc.command, status: "running" });
      } else {
        active.push({ handle, command: proc.command, status: "finished" });
      }
    }
    return active;
  }
}

export const manager = new ProcessManager();
