/**
 * Lightweight LSP (Language Server Protocol) client.
 * Experimental feature — gated behind `lsp_enabled` config flag.
 * Provides code intelligence to the AI agent: definitions, references, hover, symbols.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

interface LSPRequest {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
}

export interface LSPServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    rootUri?: string;
}

export interface LSPSymbol {
    name: string;
    kind: string;
    location: string;
    range?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

export class LSPClient {
    private proc: ChildProcessWithoutNullStreams | null = null;
    private id = 0;
    private pending = new Map<number, LSPRequest>();
    private buffered = "";
    private contentLength = -1;
    private config: LSPServerConfig;

    constructor(config: LSPServerConfig) {
        this.config = config;
    }

    private nextId(): number {
        return ++this.id;
    }

    private send(payload: Record<string, unknown>): void {
        if (!this.proc?.stdin.writable) {
            throw new Error("LSP server not started.");
        }
        const body = JSON.stringify(payload);
        const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
        this.proc.stdin.write(header + body);
    }

    private request(method: string, params: Record<string, unknown> = {}): Promise<any> {
        const id = this.nextId();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`LSP request '${method}' timed out after 15s`));
            }, 15000);

            this.pending.set(id, {
                resolve: (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                reject: (reason) => {
                    clearTimeout(timer);
                    reject(reason);
                },
            });

            this.send({ jsonrpc: "2.0", id, method, params });
        });
    }

    private notify(method: string, params: Record<string, unknown> = {}): void {
        this.send({ jsonrpc: "2.0", method, params });
    }

    private onMessage(msg: any): void {
        if (msg.id !== undefined && this.pending.has(msg.id)) {
            const handler = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) {
                handler.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
                handler.resolve(msg.result);
            }
        }
    }

    private processBuffer(): void {
        while (true) {
            if (this.contentLength < 0) {
                const headerEnd = this.buffered.indexOf("\r\n\r\n");
                if (headerEnd < 0) return;
                const header = this.buffered.slice(0, headerEnd);
                const match = header.match(/Content-Length:\s*(\d+)/i);
                if (!match) {
                    this.buffered = this.buffered.slice(headerEnd + 4);
                    continue;
                }
                this.contentLength = parseInt(match[1], 10);
                this.buffered = this.buffered.slice(headerEnd + 4);
            }

            if (this.buffered.length < this.contentLength) return;

            const body = this.buffered.slice(0, this.contentLength);
            this.buffered = this.buffered.slice(this.contentLength);
            this.contentLength = -1;

            try {
                const msg = JSON.parse(body);
                this.onMessage(msg);
            } catch { /* ignore malformed */ }
        }
    }

    async start(): Promise<void> {
        if (this.proc) return;

        this.proc = spawn(this.config.command, this.config.args || [], {
            env: { ...process.env, ...(this.config.env || {}) },
            stdio: ["pipe", "pipe", "pipe"],
        });

        this.proc.stdout.on("data", (chunk: Buffer) => {
            this.buffered += chunk.toString("utf8");
            this.processBuffer();
        });

        this.proc.on("exit", () => {
            this.proc = null;
            for (const [, handler] of this.pending) {
                handler.reject(new Error("LSP server exited"));
            }
            this.pending.clear();
        });

        // Initialize
        const rootUri = this.config.rootUri || `file://${process.cwd().replace(/\\/g, "/")}`;
        await this.request("initialize", {
            processId: process.pid,
            capabilities: {
                textDocument: {
                    definition: { dynamicRegistration: false },
                    references: { dynamicRegistration: false },
                    hover: { contentFormat: ["plaintext", "markdown"] },
                    documentSymbol: { dynamicRegistration: false },
                },
                workspace: {
                    symbol: { dynamicRegistration: false },
                },
            },
            rootUri,
            workspaceFolders: [{ uri: rootUri, name: "workspace" }],
        });

        this.notify("initialized");
    }

    async goToDefinition(filePath: string, line: number, character: number): Promise<any> {
        const uri = `file://${filePath.replace(/\\/g, "/")}`;
        return this.request("textDocument/definition", {
            textDocument: { uri },
            position: { line, character },
        });
    }

    async findReferences(filePath: string, line: number, character: number): Promise<any> {
        const uri = `file://${filePath.replace(/\\/g, "/")}`;
        return this.request("textDocument/references", {
            textDocument: { uri },
            position: { line, character },
            context: { includeDeclaration: true },
        });
    }

    async hover(filePath: string, line: number, character: number): Promise<any> {
        const uri = `file://${filePath.replace(/\\/g, "/")}`;
        return this.request("textDocument/hover", {
            textDocument: { uri },
            position: { line, character },
        });
    }

    async documentSymbol(filePath: string): Promise<any> {
        const uri = `file://${filePath.replace(/\\/g, "/")}`;
        return this.request("textDocument/documentSymbol", {
            textDocument: { uri },
        });
    }

    async workspaceSymbol(query: string): Promise<any> {
        return this.request("workspace/symbol", { query });
    }

    close(): void {
        if (this.proc) {
            try { this.send({ jsonrpc: "2.0", id: this.nextId(), method: "shutdown" }); } catch { /* ignore */ }
            setTimeout(() => {
                try { this.notify("exit"); } catch { /* ignore */ }
                setTimeout(() => {
                    if (this.proc) {
                        this.proc.kill();
                        this.proc = null;
                    }
                }, 500);
            }, 500);
        }
    }
}
