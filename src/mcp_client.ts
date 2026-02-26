import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { cfg } from "./config";

export class MCPClientError extends Error { }

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
      shell: true,
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

let mcpPromptCache: { expiresAt: number; prompt: string } | null = null;
const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes

export async function getMcpSystemPrompt(): Promise<string> {
  if (!cfg.isMcpEnabled()) return "";

  const servers = cfg.getMcpServers();
  const serverNames = Object.keys(servers);
  if (!serverNames.length) return "";

  if (mcpPromptCache && Date.now() < mcpPromptCache.expiresAt) {
    return mcpPromptCache.prompt;
  }

  const lines: string[] = [
    "[MCP (Model Context Protocol) TOOLS AVAILABLE]",
    "You have access to the following external MCP servers and their tools.",
    "To call an MCP tool, include a JSON block in your exact top-level response like this:",
    '{"mcp_call": {"server": "server_name", "tool": "tool_name", "args": {"arg1": "value"}}}',
    "The tool will be executed and the output will be provided to you in the next turn.",
    "",
  ];

  const fetchPromises = serverNames.map(async (name) => {
    const spec = servers[name] as Record<string, unknown>;
    const command = String(spec.command || "");
    const args = Array.isArray(spec.args) ? spec.args : [];
    const env = (spec.env || {}) as Record<string, string>;

    const client = new MCPClient(command, args, env, 15000);
    try {
      const res = await client.listTools() as any;
      const tools = Array.isArray(res?.result?.tools) ? res.result.tools : [];
      if (tools.length) {
        let serverText = `### Server: ${name}\n`;
        tools.forEach((t: any) => {
          serverText += `- **${t.name}**: ${t.description || "No description"}\n`;
          serverText += `  Args: ${JSON.stringify(t.inputSchema || {})}\n`;
        });
        return serverText;
      }
    } catch (e) {
      // Ignore servers that fail to start or list tools
    } finally {
      client.close();
    }
    return null;
  });

  const results = await Promise.all(fetchPromises);
  const activeServers = results.filter(Boolean);

  if (!activeServers.length) {
    return "";
  }

  lines.push(...activeServers.map(s => String(s)));

  const prompt = lines.join("\n");
  mcpPromptCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    prompt,
  };

  return prompt;
}

export async function runMcpTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
  const servers = cfg.getMcpServers();
  const spec = servers[serverName] as Record<string, unknown>;
  if (!spec) {
    return `Error: MCP server '${serverName}' not found or not configured.`;
  }

  const command = String(spec.command || "");
  const spawnArgs = Array.isArray(spec.args) ? spec.args : [];
  const env = (spec.env || {}) as Record<string, string>;

  const client = new MCPClient(command, spawnArgs, env, 30000);
  try {
    const res = await client.callTool(toolName, args);
    return JSON.stringify(res, null, 2);
  } catch (error) {
    return `MCP Tool Execution Error (${serverName}:${toolName}): ${String(error)}`;
  } finally {
    client.close();
  }
}
