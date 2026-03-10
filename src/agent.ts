import * as vscode from 'vscode';
import * as path from 'path';
import fs from 'fs-extra';
import { getProvider } from './providers/manager';
import { apply as applyChanges } from './applier';
import { cfg } from './config';
import { getMcpSystemPrompt, runMcpTool } from './mcp_client';
import { calculateCost } from './cost';
import { isFullAccess } from './core/permissions';
import { createFile, deleteFile } from './core/tools';
import { APP_SESSIONS_DIR } from './app_dirs';
import type { Message, AgentResponse, ChatSession, TaskPayload } from './types';

let abortController: AbortController | null = null;

import { GENERATED_DEFAULT_PROMPT_B64 } from './runtime_assets.generated';

function getSystemPrompt(): string {
    try {
        return Buffer.from(GENERATED_DEFAULT_PROMPT_B64, 'base64').toString('utf8');
    } catch { }
    return `You are Agent CLi — an expert AI coding agent embedded in VS Code.

RULES:
1. Return exactly ONE valid JSON object. No markdown fences, no extra text outside the JSON.
2. Always include "thought" with your internal reasoning.
3. Use "response" for your visible reply to the user (full markdown supported).
4. For code edits, use "changes" array. For new files use "create_file". For shell commands use "commands".
5. Use "mode" to indicate: "chat" (conversation), "apply" (making changes), "plan" (planning before applying).
6. When planning, set "plan" to your step-by-step plan. User can approve before you apply.
7. Set "mission_complete" to true when the user's full task is done.

JSON SHAPE:
{
  "thought": "internal reasoning (shown in thinking block)",
  "response": "markdown answer shown to user",
  "mode": "chat|apply|plan",
  "plan": "step-by-step plan if mode=plan",
  "confidence": 0.0-1.0,
  "changes": [{"file":"relative/path","original":"exact block to find","edited":"replacement block"}],
  "create_file": {"file":"relative/path","content":"full file content"} | null,
  "delete_file": {"file":"relative/path"} | null,
  "commands": [{"command":"shell command","reason":"why"}],
  "request_files": ["paths to request from user"],
  "mission_complete": false
}`;
}


function parseAgentJson(text: string): AgentResponse | null {
    const trimmed = text.trim();
    try { return JSON.parse(trimmed); } catch { }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
        try { return JSON.parse(trimmed.substring(start, end + 1)); } catch { }
    }
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fenceMatch) { try { return JSON.parse(fenceMatch[1].trim()); } catch { } }
    return null;
}

export type AgentEvent =
    | { type: 'chunk'; value: string }
    | { type: 'thinking'; value: string }
    | { type: 'changes'; data: any[] }
    | { type: 'create_file'; data: { file: string; content: string } }
    | { type: 'delete_file'; data: { file: string } }
    | { type: 'commands'; data: any[] }
    | { type: 'request_files'; data: string[] }
    | { type: 'plan'; data: string }
    | { type: 'mode'; data: string }
    | { type: 'web_search_result'; data: { results: string; queries?: string[] } }
    | { type: 'web_browse_result'; data: { content: string; urls: string[] } }
    | { type: 'search_results'; data: { results: string; pattern: string } }
    | { type: 'ask_user'; data: { questions: string[] } }
    | { type: 'mission_complete' }
    | { type: 'mcp_call'; data: { server: string; tool: string; args: any } }
    | { type: 'mcp_result'; data: string }
    | { type: 'cost'; data: { input: number; output: number; cost: string; model: string } }
    | { type: 'permission'; data: { action: string; path: string; allowed: boolean } }
    | { type: 'stopped' }
    | { type: 'error'; message: string };


class VscodeUISink implements UISink {
    constructor(private onEvent: (e: AgentEvent) => void) { }
    print(text: string) { this.onEvent({ type: 'chunk', value: text }); }
    printActivity(text: string) { this.onEvent({ type: 'thinking', value: text }); }
    printError(text: string, title?: string) { this.onEvent({ type: 'error', message: title ? `${title}: ${text}` : text }); }
    printInfo(text: string) { this.onEvent({ type: 'thinking', value: text }); }
    printWarning(text: string, title?: string) { vscode.window.showWarningMessage(title ? `${title}: ${text}` : text); }
    printSuccess(text: string) { this.onEvent({ type: 'thinking', value: `\u2713 ${text}` }); }
    printPanel(content: string, title: string, style: string, border?: boolean) {
        this.onEvent({ type: 'thinking', value: `--- ${title} ---\n${content}` });
    }
    startThinking() { }
    stopThinking() { }
    async promptConfirm(title: string, question: string) {
        const choice = await vscode.window.showInformationMessage(`${title}: ${question}`, 'Yes', 'No');
        return choice === 'Yes';
    }
    async askInput(prompt: string) {
        return await vscode.window.showInputBox({ prompt }) || '';
    }
    showDiff(file: string, original: string, edited: string) {
        // Implementation for showing diffs in VS Code if needed
    }
    updateMissionStatus(data: any) {
        if (data.status) this.onEvent({ type: 'mode', data: data.status.toLowerCase() });
        if (data.thought) this.onEvent({ type: 'thinking', value: data.thought });
        if (data.log) this.onEvent({ type: 'thinking', value: data.log });
    }
    setMissionProgressDone(count: number) { }
}

import { handle as coreHandle, setAgentContext, AgentContext, UISink } from './core/agent';

export class Agent {
    private sessions: ChatSession[] = [];
    private activeSessionId: string = '';
    private static readonly CHAT_STATE_FILE = 'vscode_chats.json';
    private static readonly CHAT_STORAGE_DIR = 'vscode_chats';
    private static readonly CHAT_INDEX_FILE = 'index.json';

    constructor(private context: vscode.ExtensionContext) {
        this.loadSessions();
        if (!this.sessions.length) this.newChat();
    }

    private chatStatePath(): string {
        fs.ensureDirSync(APP_SESSIONS_DIR());
        return path.join(APP_SESSIONS_DIR(), Agent.CHAT_STATE_FILE);
    }

    private chatStorageDir(): string {
        const dir = path.join(APP_SESSIONS_DIR(), Agent.CHAT_STORAGE_DIR);
        fs.ensureDirSync(dir);
        return dir;
    }

    private chatIndexPath(): string {
        return path.join(this.chatStorageDir(), Agent.CHAT_INDEX_FILE);
    }

    private chatSessionPath(id: string): string {
        return path.join(this.chatStorageDir(), `${id}.json`);
    }

    private normalizeSession(raw: any): ChatSession | null {
        if (!raw || typeof raw !== 'object') return null;
        const id = String(raw.id || '').trim();
        if (!id) return null;
        const title = String(raw.title || 'New Chat');
        const createdAt = Number(raw.createdAt || Date.now());
        const messages = Array.isArray(raw.messages) ? raw.messages : [];
        const safeMessages = messages
            .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system'))
            .map((m: any) => ({ role: m.role, content: String(m.content || '') }));
        return { id, title, createdAt, messages: safeMessages };
    }

    private loadSessionsFromDisk(): { sessions: ChatSession[]; activeSessionId: string } | null {
        try {
            const indexPath = this.chatIndexPath();
            if (!fs.existsSync(indexPath)) return null;

            const indexData = fs.readJsonSync(indexPath) as { sessionOrder?: string[]; activeSessionId?: string };
            const order = Array.isArray(indexData?.sessionOrder) ? indexData.sessionOrder.map((id) => String(id)) : [];

            const loaded = new Map<string, ChatSession>();
            for (const id of order) {
                const p = this.chatSessionPath(id);
                if (!fs.existsSync(p)) continue;
                const session = this.normalizeSession(fs.readJsonSync(p));
                if (session) loaded.set(session.id, session);
            }

            // Fallback: include any chat files not referenced by index order.
            for (const file of fs.readdirSync(this.chatStorageDir())) {
                if (!file.endsWith('.json') || file === Agent.CHAT_INDEX_FILE) continue;
                const id = file.replace(/\.json$/i, '');
                if (loaded.has(id)) continue;
                const p = this.chatSessionPath(id);
                const session = this.normalizeSession(fs.readJsonSync(p));
                if (session) loaded.set(session.id, session);
            }

            const sessions = [...loaded.values()];
            if (!sessions.length) return null;

            const activeSessionIdRaw = typeof indexData?.activeSessionId === 'string' ? indexData.activeSessionId : '';
            const activeSessionId = sessions.some((s) => s.id === activeSessionIdRaw) ? activeSessionIdRaw : sessions[0].id;
            return { sessions, activeSessionId };
        } catch {
            return null;
        }
    }

    private loadLegacySessionsFromDisk(): { sessions: ChatSession[]; activeSessionId: string } | null {
        try {
            const p = this.chatStatePath();
            if (!fs.existsSync(p)) return null;
            const data = fs.readJsonSync(p) as { sessions?: ChatSession[]; activeSessionId?: string };
            const sessions = (Array.isArray(data?.sessions) ? data.sessions : [])
                .map((s) => this.normalizeSession(s))
                .filter((s): s is ChatSession => Boolean(s));
            if (!sessions.length) return null;
            const activeSessionIdRaw = typeof data?.activeSessionId === 'string' ? data.activeSessionId : '';
            const activeSessionId = sessions.some((s) => s.id === activeSessionIdRaw) ? activeSessionIdRaw : sessions[0].id;
            return { sessions, activeSessionId };
        } catch {
            return null;
        }
    }

    private loadSessions() {
        const diskState = this.loadSessionsFromDisk();
        if (diskState) {
            this.sessions = diskState.sessions;
            this.activeSessionId = diskState.activeSessionId;
            return;
        }

        const legacyDiskState = this.loadLegacySessionsFromDisk();
        if (legacyDiskState) {
            this.sessions = legacyDiskState.sessions;
            this.activeSessionId = legacyDiskState.activeSessionId;
            this.save();
            return;
        }

        this.sessions = this.context.globalState.get<ChatSession[]>('agentcli.sessions', []);
        this.activeSessionId = this.context.globalState.get<string>('agentcli.activeSession', '');

        // One-time migration path for users with existing globalState chats.
        if (this.sessions.length) this.save();
    }

    private save() {
        try {
            const dir = this.chatStorageDir();
            const keep = new Set<string>();

            for (const session of this.sessions) {
                const normalized = this.normalizeSession(session);
                if (!normalized) continue;
                keep.add(normalized.id);
                fs.writeJsonSync(this.chatSessionPath(normalized.id), normalized, { spaces: 2 });
            }

            for (const file of fs.readdirSync(dir)) {
                if (!file.endsWith('.json') || file === Agent.CHAT_INDEX_FILE) continue;
                const id = file.replace(/\.json$/i, '');
                if (!keep.has(id)) fs.removeSync(path.join(dir, file));
            }

            fs.writeJsonSync(
                this.chatIndexPath(),
                {
                    version: 2,
                    savedAt: Date.now(),
                    activeSessionId: this.activeSessionId,
                    sessionOrder: this.sessions.map((s) => s.id),
                },
                { spaces: 2 },
            );
        } catch {
            // best effort
        }
        this.context.globalState.update('agentcli.sessions', this.sessions);
        this.context.globalState.update('agentcli.activeSession', this.activeSessionId);
    }

    persistNow() { this.save(); }

    getSession(): ChatSession { return this.sessions.find(s => s.id === this.activeSessionId) || this.sessions[0]; }
    getSessions(): ChatSession[] { return this.sessions; }

    newChat(): string {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const session: ChatSession = { id, title: 'New Chat', messages: [], createdAt: Date.now() };
        this.sessions.unshift(session);
        this.activeSessionId = id;
        this.save();
        return id;
    }

    switchChat(id: string) { this.activeSessionId = id; this.save(); }

    deleteChat(id: string) {
        this.sessions = this.sessions.filter(s => s.id !== id);
        if (this.activeSessionId === id) {
            this.activeSessionId = this.sessions[0]?.id || '';
            if (!this.sessions.length) this.newChat();
        }
        this.save();
    }

    stopGeneration() { if (abortController) { abortController.abort(); abortController = null; } }

    async chat(text: string, contextFiles: string[], imageBase64: string | null, onEvent: (e: AgentEvent) => void) {
        const session = this.getSession();
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

        const sink = new VscodeUISink(onEvent);
        const ctx: AgentContext = {
            ui: sink,
            cwd: wsRoot
        };
        setAgentContext(ctx);

        // Build core Agent payload/history
        session.messages.push({ role: 'user', content: text });
        if (session.title === 'New Chat' && text.length > 0) {
            session.title = text.slice(0, 50) + (text.length > 50 ? '...' : '');
        }
        this.save();

        try {
            const result = (await coreHandle(text, { yes: true })) as AgentResponse & {
                cost?: { input: number; output: number; cost: string; model: string };
                permission?: { action: string; path: string; allowed: boolean };
            };
            if (!result) return;

            if (result.mode) onEvent({ type: 'mode', data: String(result.mode) });
            if (result.plan) onEvent({ type: 'plan', data: String(result.plan) });
            if (Array.isArray(result.changes) && result.changes.length) onEvent({ type: 'changes', data: result.changes });
            if (result.create_file) onEvent({ type: 'create_file', data: result.create_file });
            if (result.delete_file) onEvent({ type: 'delete_file', data: result.delete_file });
            if (Array.isArray(result.commands) && result.commands.length) onEvent({ type: 'commands', data: result.commands });
            if (Array.isArray(result.request_files) && result.request_files.length) onEvent({ type: 'request_files', data: result.request_files });
            
            // Emit web search results if available
            if (result.web_results) {
                const queries = Array.isArray(result.web_search) ? result.web_search : (typeof result.web_search === 'string' ? [result.web_search] : []);
                onEvent({ type: 'web_search_result', data: { results: String(result.web_results), queries } });
            }
            
            // Emit web browse results if available
            if (result.web_browse_results || result.web_browse_content) {
                const urls = Array.isArray(result.web_browse) ? result.web_browse : (typeof result.web_browse === 'string' ? [result.web_browse] : []);
                onEvent({ type: 'web_browse_result', data: { content: String(result.web_browse_results || result.web_browse_content || ''), urls } });
            }
            
            // Emit project search results if available
            if (result.project_search) {
                const pattern = typeof result.search_project === 'string' ? result.search_project : '';
                onEvent({ type: 'search_results', data: { results: String(result.project_search), pattern } });
            }
            
            // Emit ask_user prompts if available
            const questions = Array.isArray(result.ask_user_questions) ? result.ask_user_questions : 
                             (typeof result.ask_user === 'string' ? [result.ask_user] : []);
            if (questions.length) {
                onEvent({ type: 'ask_user', data: { questions } });
            }
            
            if (result.permission) onEvent({ type: 'permission', data: result.permission });
            if (result.cost) onEvent({ type: 'cost', data: result.cost });
            if (result.mission_complete) onEvent({ type: 'mission_complete' });

            if (result.response) {
                onEvent({ type: 'chunk', value: result.response });
                session.messages.push({ role: 'assistant', content: result.response });
                this.save();
            }
        } catch (e: any) {
            onEvent({ type: 'error', message: String(e.message || e) });
        }
    }

    applyFileChanges(changes: any[]) {
        try {
            applyChanges(changes);
            vscode.window.showInformationMessage(`Applied ${changes.length} changes`);
        } catch (e: any) {
            vscode.window.showWarningMessage(`Apply failed: ${e.message}`);
        }
    }

    applyCreateFile(data: { file: string; content: string }) {
        createFile(data.file, data.content);
        vscode.window.showInformationMessage(`Created: ${data.file}`);
    }

    applyDeleteFile(data: { file: string }) {
        deleteFile(data.file);
        vscode.window.showInformationMessage(`Deleted: ${data.file}`);
    }

    async runTerminalCommand(cmd: string): Promise<string> {
        return new Promise((resolve) => {
            const { exec } = require('child_process');
            const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            exec(cmd, { cwd: wsRoot, timeout: 30000, maxBuffer: 1024 * 1024 }, (err: any, stdout: string, stderr: string) => {
                let out = stdout || '';
                if (stderr) out += '\n' + stderr;
                if (err && !stdout && !stderr) out = `Error: ${err.message}`;
                resolve(out);
            });
        });
    }

    appendMessage(role: 'user' | 'assistant', content: string) {
        const session = this.getSession();
        if (session) {
            session.messages.push({ role, content });
            this.save();
        }
    }

    async getWorkspaceFiles(): Promise<string[]> {
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!wsRoot) return [];
        const uris = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 200);
        return uris.map(u => vscode.workspace.asRelativePath(u));
    }
}
