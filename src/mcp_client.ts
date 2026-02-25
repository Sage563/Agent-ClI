import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

export class MCPClientError extends Error {}

export class MCPClient {
  command: string;
  args: string[];
  env: Record<string, string>;
  timeout: number;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private id = 0;
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
  private buffered = "";

  constructor(command: string, args: string[] = [], env: Record<string, string> = {}, timeout = 20_000) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.timeout = timeout;
  }

  private start() {
    if (this.proc) return;
    this.proc = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    const proc = this.proc;
    if (!proc) throw new MCPClientError("Failed to start MCP process.");

    proc.stdout.on("data", (chunk: Buffer) => {
      this.buffered += chunk.toString("utf8");
      let index = this.buffered.indexOf("\n");
      while (index >= 0) {
        const line = this.buffered.slice(0, index).trim();
        this.buffered = this.buffered.slice(index + 1);
        index = this.buffered.indexOf("\n");
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          const msgId = Number(msg.id || 0);
          const resolver = this.pending.get(msgId);
          if (resolver) {
            this.pending.delete(msgId);
            resolver(msg);
          }
        } catch {
          // ignore malformed lines
        }
      }
    });
  }

  private nextId() {
    this.id += 1;
    return this.id;
  }

  private send(payload: Record<string, unknown>) {
    if (!this.proc?.stdin.writable) {
      throw new MCPClientError("MCP process not started.");
    }
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private recv(id: number) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new MCPClientError("Timed out waiting for MCP response."));
      }, this.timeout);

      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  private async initialize() {
    const initId = this.nextId();
    this.send({
      jsonrpc: "2.0",
      id: initId,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "Agent CLI", version: "1.0" },
      },
    });
    await this.recv(initId);
    this.send({ jsonrpc: "2.0", method: "initialized" });
  }

  private async ensureStarted() {
    if (!this.proc) {
      this.start();
      await this.initialize();
    }
  }

  async listTools() {
    await this.ensureStarted();
    const id = this.nextId();
    this.send({ jsonrpc: "2.0", id, method: "tools/list" });
    return this.recv(id);
  }

  async listPrompts() {
    await this.ensureStarted();
    const id = this.nextId();
    this.send({ jsonrpc: "2.0", id, method: "prompts/list" });
    return this.recv(id);
  }

  async listResources() {
    await this.ensureStarted();
    const id = this.nextId();
    this.send({ jsonrpc: "2.0", id, method: "resources/list" });
    return this.recv(id);
  }

  async readResource(uri: string) {
    await this.ensureStarted();
    const id = this.nextId();
    this.send({
      jsonrpc: "2.0",
      id,
      method: "resources/read",
      params: { uri },
    });
    return this.recv(id);
  }

  async callTool(name: string, argumentsValue: Record<string, unknown>) {
    await this.ensureStarted();
    const id = this.nextId();
    this.send({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: argumentsValue },
    });
    return this.recv(id);
  }

  close() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

export async function describeServer(url: string) {
  return { error: `Not implemented in stdio MCP mode: ${url}` };
}

export async function runTool(url: string, tool: string, args: Record<string, unknown>) {
  return { error: `Not implemented in stdio MCP mode: ${url} (${tool})`, args };
}
