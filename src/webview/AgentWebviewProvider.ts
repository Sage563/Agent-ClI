import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Agent } from '../agent';
import { BUILTIN_PROVIDERS, getProviderLabel } from '../providers/catalog';
import { cfg, KNOWN_MODELS } from '../config';
import { isFullAccess } from '../core/permissions';

export class AgentWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'agentcli.chatView';
    private _view?: vscode.WebviewView;
    private _detachedPanel?: vscode.WebviewPanel;
    private _clients = new Set<vscode.Webview>();
    private _webviewKind = new WeakMap<vscode.Webview, 'view' | 'panel'>();
    private _agent: Agent;

    constructor(private readonly _extUri: vscode.Uri, private readonly _ctx: vscode.ExtensionContext) {
        this._agent = new Agent(_ctx);
    }

    get agent() { return this._agent; }

    public resolveWebviewView(wv: vscode.WebviewView) {
        this._view = wv;
        this._registerWebview(wv.webview, 'view');
        setTimeout(() => this._push(), 150);
    }

    public newChat() { this._agent.newChat(); this._push(); this._post({ type: 'clear' }); }
    public stop() { this._agent.stopGeneration(); }
    public openDetachedChat() {
        if (this._detachedPanel) {
            this._detachedPanel.reveal(vscode.ViewColumn.Active, true);
            this._push();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'agentcli.chatDetached',
            'Agent CLi Chat',
            vscode.ViewColumn.Active,
            { enableScripts: true, localResourceRoots: [this._extUri] },
        );
        this._detachedPanel = panel;
        this._registerWebview(panel.webview, 'panel');
        panel.onDidDispose(() => {
            this._clients.delete(panel.webview);
            this._detachedPanel = undefined;
        });
        this._push();
    }
    private _post(msg: any) {
        for (const client of this._clients) {
            client.postMessage(msg);
        }
    }

    private _registerWebview(wv: vscode.Webview, kind: 'view' | 'panel') {
        wv.options = { enableScripts: true, localResourceRoots: [this._extUri] };
        wv.html = this._html();
        this._clients.add(wv);
        this._webviewKind.set(wv, kind);
        this._wire(wv);
    }

    private _push() {
        const s = this._agent.getSession();
        const activeProvider = cfg.getActiveProvider();
        const activeModel = cfg.getModel(activeProvider);
        const known = (KNOWN_MODELS[activeProvider] || []).slice();
        const modelOptions = known.includes(activeModel) ? known : [activeModel, ...known];

        // Get cost budgets and context windows from config
        const maxBudget = cfg.get('max_budget') as number | undefined;
        const maxRequests = cfg.get('max_requests') as number | undefined;

        // Get context window info if available (estimate for now)
        const contextWindows: Record<string, number> = {
            'gpt-4o': 128000,
            'gpt-4-turbo': 128000,
            'gpt-4': 8192,
            'gpt-3.5-turbo': 4096,
            'claude-3-5-sonnet-20241022': 200000,
            'claude-3-opus-20240229': 200000,
            'claude-3-haiku-20240307': 200000,
            'gemini-1.5-pro': 1000000,
            'gemini-1.5-flash': 1000000,
        };
        const contextWindow = contextWindows[activeModel] || null;

        // Calculate context used from session history
        const contextUsed = s?.messages?.reduce((sum, m) => sum + (String(m.content || '').length / 4), 0) || 0;
        const contextLeft = contextWindow ? Math.max(0, contextWindow - contextUsed) : null;

        this._post({
            type: 'state',
            provider: activeProvider,
            providerLabel: getProviderLabel(activeProvider),
            model: activeModel,
            modelOptions,
            reasoningLevel: cfg.getReasoningLevel(),
            missionMode: cfg.isMissionMode(),
            sessions: this._agent.getSessions().map(s => ({ id: s.id, title: s.title, createdAt: s.createdAt, msgCount: s.messages.length, active: s.id === this._agent.getSession()?.id })),
            messages: s?.messages || [],
            onboarded: this._ctx.globalState.get('agentcli.onboarded', false),
            planning: cfg.isPlanningMode(),
            access: cfg.getAccessMode(),
            showCost: cfg.showCost(),
            hasKey: !!cfg.getApiKey(cfg.getActiveProvider()),
            mcpServers: (vscode.workspace.getConfiguration('agentcli').get('mcpServers') || {}),
            fastMission: cfg.isFastMission(),
            showSessionPicker: !s && this._agent.getSessions().length > 0,
            // Enhanced context tracking
            max_budget: maxBudget,
            max_requests: maxRequests,
            context_window: contextWindow,
            context_used: Math.round(contextUsed),
            context_left: contextLeft ? Math.round(contextLeft) : null
        });
    }

    private _wire(wv: vscode.Webview) {
        wv.onDidReceiveMessage(async (m: any) => {
            switch (m.type) {
                case 'chat': return this._handleChat(m.text, m.files || [], m.image || null);
                case 'quickAction': return this._runQuickAction(m.action, m.text || "", m.files || [], m.image || null);
                case 'newChat': return this.newChat();
                case 'switchChat': this._agent.switchChat(m.id); return this._push();
                case 'deleteChat': this._agent.deleteChat(m.id); return this._push();
                case 'stop': return this.stop();
                case 'accept': return this._agent.applyFileChanges(m.changes);
                case 'acceptCreate': return this._agent.applyCreateFile(m.data);
                case 'acceptDelete': return this._agent.applyDeleteFile(m.data);
                case 'runCmd': {
                    const out = await this._agent.runTerminalCommand(m.cmd);
                    return this._post({ type: 'cmdResult', cmd: m.cmd, output: out });
                }
                case 'pickFiles': return this._pickFiles();
                case 'pickImage': return this._pickImage();
                case 'pickProvider': return this._pickProvider();
                case 'pickModel': return this._pickModel();
                case 'openDetachedChat': {
                    this.openDetachedChat();
                    return;
                }
                case 'setModel': {
                    const provider = cfg.getActiveProvider();
                    const next = String(m.model || "").trim();
                    if (next) {
                        await cfg.set(`${provider}.model`, next);
                        this._push();
                    }
                    return;
                }
                case 'setReasoning': {
                    const level = String(m.level || "").toLowerCase();
                    if (["low", "standard", "high"].includes(level)) {
                        cfg.setReasoningLevel(level);
                        this._push();
                    }
                    return;
                }
                case 'configKey': return this._configKey();
                case 'openFile': return this._openFile(m.path);
                case 'togglePlanning': {
                    const v = !cfg.isPlanningMode();
                    await cfg.set('planningMode', v);
                    this._push();
                    return;
                }
                case 'toggleFastMission': {
                    const v = !cfg.isFastMission();
                    await cfg.setFastMission(v);
                    this._push();
                    return;
                }
                case 'toggleMissionMode': {
                    const v = !cfg.isMissionMode();
                    cfg.setMissionMode(v);
                    this._push();
                    return;
                }
                case 'exit': {
                    const kind = this._webviewKind.get(wv);
                    if (kind === 'panel' && this._detachedPanel) this._detachedPanel.dispose();
                    else vscode.commands.executeCommand('workbench.action.closeSidebar');
                    return;
                }
                case 'setAccess': {
                    await cfg.set('access_scope', m.mode);
                    await cfg.set('accessMode', m.mode);
                    this._push();
                    return;
                }
                case 'onboard': {
                    if (m.provider) await cfg.set('provider', m.provider);
                    if (m.key && m.provider) await cfg.set(`${m.provider}.apiKey`, m.key);
                    if (m.endpoint && m.provider) await cfg.set(`${m.provider}.endpoint`, m.endpoint);
                    await this._ctx.globalState.update('agentcli.onboarded', true);
                    return this._push();
                }
                case 'getState': return this._push();
                case 'suggestFiles': return this._suggestFiles(m.query);
                case 'getFilePreview': return this._getFilePreview(m.path);
                case 'exportChat': return vscode.commands.executeCommand('agentcli.exportChat');
                case 'insertAtCursor': return this._insertAtCursor(m.text);
                case 'saveMcp': {
                    await vscode.workspace.getConfiguration('agentcli').update('mcpServers', m.servers, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage('MCP Servers updated.');
                    return this._push();
                }
            }
        });
    }

    private async _insertAtCursor(text: string) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.edit(editBuilder => {
                editBuilder.insert(editor.selection.active, text);
            });
        } else {
            vscode.window.showErrorMessage('No active editor to insert code block.');
        }
    }

    private async _handleChat(text: string, files: string[], image: string | null) {
        const trimmed = text.trim();

        // Handle Slash Commands
        if (trimmed.startsWith('/')) {
            const cmd = trimmed.split(' ')[0].toLowerCase();
            if (cmd === '/clear' || cmd === '/new') {
                this.newChat();
                return;
            }
            if (cmd === '/export') {
                await vscode.commands.executeCommand('agentcli.exportChat');
                return;
            }
            if (cmd === '/skills') {
                this._handleSkillsCommand(trimmed);
                return;
            }
        }

        // Handle Shell Commands (!)
        if (trimmed.startsWith('!')) {
            const shellCmd = trimmed.slice(1).trim();
            if (shellCmd) {
                this._post({ type: 'streamStart' });
                this._post({ type: 'event', event: { type: 'thinking', value: `Running command: ${shellCmd}` } });
                const out = await this._agent.runTerminalCommand(shellCmd);
                const resultText = `\n**Command Output:**\n\`\`\`\n${out}\n\`\`\`\n`;
                this._post({ type: 'event', event: { type: 'chunk', value: resultText } });
                this._post({ type: 'streamEnd' });

                // Also save to history so the agent sees the context
                this._agent.appendMessage('user', text);
                this._agent.appendMessage('assistant', resultText);
                return;
            }
        }

        this._post({ type: 'streamStart' });
        await this._agent.chat(text, files, image, (ev) => this._post({ type: 'event', event: ev }));
        this._post({ type: 'streamEnd' });
    }

    private _buildQuickActionPrompt(actionRaw: string, inputText: string) {
        const action = String(actionRaw || "").toLowerCase();
        const target = String(inputText || "").trim() || "the current task";
        const editor = vscode.window.activeTextEditor;
        const selection = editor ? editor.document.getText(editor.selection).trim() : "";
        const selectionBlock = selection
            ? `\n\nCurrent editor selection:\n\`\`\`\n${selection}\n\`\`\``
            : "";

        if (action === "explain") {
            return `Explain this clearly and concisely: ${target}.${selectionBlock}`;
        }
        if (action === "fix") {
            return `Diagnose and fix this issue: ${target}. Keep edits minimal and safe.${selectionBlock}`;
        }
        if (action === "tests") {
            return `Create or improve tests for: ${target}. Focus on behavior and edge cases.${selectionBlock}`;
        }
        if (action === "docs") {
            return `Write developer docs for: ${target}. Include quickstart and examples.${selectionBlock}`;
        }
        if (action === "review") {
            return `Review this with a code-review mindset: ${target}. List findings by severity and include missing tests.${selectionBlock}`;
        }
        return target;
    }

    private async _runQuickAction(action: string, text: string, files: string[], image: string | null) {
        const prompt = this._buildQuickActionPrompt(action, text);
        this._post({ type: 'streamStart' });
        await this._agent.chat(prompt, files, image, (ev) => this._post({ type: 'event', event: ev }));
        this._post({ type: 'streamEnd' });
    }

    private _handleSkillsCommand(cmdText: string) {
        const args = cmdText.split(/\s+/).slice(1);
        const action = (args[0] || 'list').toLowerCase();

        if (action === 'where') {
            const skillsDir = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.agent', 'skills');
            vscode.window.showInformationMessage(`Skills directory: ${skillsDir}`);
            return;
        }

        if (action === 'init') {
            vscode.window.showInputBox({
                prompt: 'Enter skill name (e.g., my-skill)',
                placeHolder: 'skill-name'
            }).then(name => {
                if (name) {
                    const skillName = name.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
                    const skillsDir = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.agent', 'skills', skillName);
                    const msg = `To create skill '${skillName}', run in terminal:\n\`/skills init ${skillName}\`\n\nOr use the CLI directly.`;
                    vscode.window.showInformationMessage(msg);
                }
            });
            return;
        }

        // List skills
        const skillsDir = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.agent', 'skills');
        if (!fs.existsSync(skillsDir)) {
            vscode.window.showInformationMessage('No skills directory found. Create one with /skills init <name>');
            return;
        }

        try {
            const skills = fs.readdirSync(skillsDir, { withFileTypes: true })
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name)
                .sort();

            if (!skills.length) {
                vscode.window.showInformationMessage('No skills found. Create one with /skills init <name>');
                return;
            }

            vscode.window.showQuickPick(skills, {
                placeHolder: 'Select a skill to view'
            }).then(selected => {
                if (selected) {
                    const skillPath = path.join(skillsDir, selected, 'SKILL.md');
                    vscode.workspace.openTextDocument(skillPath).then(doc => {
                        vscode.window.showTextDocument(doc);
                    }, () => {
                        vscode.window.showErrorMessage(`Could not open skill: ${selected}`);
                    });
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading skills: ${error}`);
        }
    }

    private async _pickFiles() {
        const files = await this._agent.getWorkspaceFiles();
        const items = files.map(f => ({ label: f.split(/[/\\]/).pop() || f, description: f, value: f }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: ' Select files', canPickMany: true });
        if (picked?.length) this._post({ type: 'filesAttached', files: picked.map((p: any) => p.value) });
    }

    private async _pickImage() {
        const uris = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] } });
        if (uris?.[0]) {
            const data = await vscode.workspace.fs.readFile(uris[0]);
            const b64 = Buffer.from(data).toString('base64');
            const ext = uris[0].path.split('.').pop() || 'png';
            this._post({ type: 'imageAttached', data: `data:image/${ext};base64,${b64}`, name: uris[0].path.split('/').pop() });
        }
    }

    private async _pickProvider() {
        const items = BUILTIN_PROVIDERS.map(p => ({ label: `${p === cfg.getActiveProvider() ? '● ' : ''}${getProviderLabel(p)}`, description: cfg.getModel(p), value: p }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select Provider' });
        if (picked) { await cfg.set('provider', (picked as any).value); this._push(); }
    }

    private async _pickModel() {
        const p = cfg.getActiveProvider();
        const val = await vscode.window.showInputBox({ prompt: `Model for ${getProviderLabel(p)}`, value: cfg.getModel(p) });
        if (val !== undefined) { await cfg.set(`${p}.model`, val); this._push(); }
    }

    private async _configKey() {
        const p = cfg.getActiveProvider();
        const current = cfg.getApiKey(p);
        const masked = current ? `${current.slice(0, 5)}...${current.slice(-3)}` : '(none)';
        const val = await vscode.window.showInputBox({ prompt: `API Key for ${getProviderLabel(p)} [${masked}]`, password: true });
        if (val !== undefined) { await cfg.set(`${p}.apiKey`, val); vscode.window.showInformationMessage(`Key saved`); this._push(); }
    }

    private async _openFile(filePath: string) {
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const abs = require('path').resolve(wsRoot, filePath);
        try { await vscode.window.showTextDocument(vscode.Uri.file(abs)); }
        catch { vscode.window.showErrorMessage(`Cannot open: ${filePath}`); }
    }

    private async _suggestFiles(query: string) {
        const files = await this._agent.getWorkspaceFiles();
        const q = query.toLowerCase();
        this._post({ type: 'fileSuggestions', files: files.filter(f => f.toLowerCase().includes(q)).slice(0, 15) });
    }

    private async _getFilePreview(filePath: string) {
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const abs = path.resolve(wsRoot, filePath);
        try {
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
                const content = fs.readFileSync(abs, 'utf8');
                const lines = content.split('\n').slice(0, 25).join('\n');
                this._post({ type: 'filePreview', path: filePath, content: lines });
            }
        } catch { }
    }

    private _html(): string {
        const candidates = [
            path.join(this._extUri.fsPath, 'dist', 'webview', 'chat.html'),
            path.join(this._extUri.fsPath, 'src', 'webview', 'chat.html')
        ];
        for (const p of candidates) {
            try {
                if (fs.existsSync(p)) {
                    return fs.readFileSync(p, 'utf8');
                }
            } catch {
                // Try next candidate.
            }
        }
        return `<h1>Error loading webview</h1><p>Tried:</p><ul>${candidates.map(p => `<li>${p}</li>`).join('')}</ul>`;
    }
}

