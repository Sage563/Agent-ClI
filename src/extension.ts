import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AgentWebviewProvider } from './webview/AgentWebviewProvider';
import { BUILTIN_PROVIDERS, getProviderLabel } from './providers/catalog';
import { cfg } from './config';
import { isFullAccess } from './core/permissions';

let activeProvider: AgentWebviewProvider | null = null;

export function activate(context: vscode.ExtensionContext) {
    const provider = new AgentWebviewProvider(context.extensionUri, context);
    activeProvider = provider;

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(AgentWebviewProvider.viewType, provider),

        // Chat management
        vscode.commands.registerCommand('agentcli.newChat', () => provider.newChat()),
        vscode.commands.registerCommand('agentcli.clearChat', () => provider.newChat()),
        vscode.commands.registerCommand('agentcli.deleteChat', () => {
            const sessions = provider.agent.getSessions();
            const items = sessions.map(s => ({ label: s.title || 'New Chat', description: new Date(s.createdAt).toLocaleString(), value: s.id }));
            vscode.window.showQuickPick(items, { placeHolder: 'Select chat to delete' }).then(p => {
                if (p) provider.agent.deleteChat((p as any).value);
            });
        }),
        vscode.commands.registerCommand('agentcli.exportChat', async () => {
            const session = provider.agent.getSession();
            if (!session?.messages.length) { vscode.window.showWarningMessage('No messages to export.'); return; }
            let md = `# ${session.title}\n_Exported ${new Date().toLocaleString()}_\n\n`;
            for (const m of session.messages) {
                md += `### ${m.role === 'user' ? ' You' : ' Agent CLi'}\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}\n\n---\n\n`;
            }

            const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(`chat_${session.id}.md`), filters: { 'Markdown': ['md'] } });
            if (uri) { fs.writeFileSync(uri.fsPath, md, 'utf8'); vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`); }
        }),
        vscode.commands.registerCommand('agentcli.searchChats', async () => {
            const sessions = provider.agent.getSessions();
            const items = sessions.map(s => ({ label: s.title || 'New Chat', description: `${s.messages.length} messages · ${new Date(s.createdAt).toLocaleDateString()}`, value: s.id }));
            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Search chats...' });
            if (picked) provider.agent.switchChat((picked as any).value);
        }),

        // Provider & model
        vscode.commands.registerCommand('agentcli.selectProvider', async () => {
            const items = BUILTIN_PROVIDERS.map(p => ({ label: `${p === cfg.getActiveProvider() ? '● ' : ''}${getProviderLabel(p)}`, description: `Model: ${cfg.getModel(p)}`, value: p }));
            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select AI Provider' });
            if (picked) { await cfg.set('provider', (picked as any).value); vscode.window.showInformationMessage(`Provider: ${picked.label}`); }
        }),
        vscode.commands.registerCommand('agentcli.selectModel', async () => {
            const p = cfg.getActiveProvider();
            const val = await vscode.window.showInputBox({ prompt: `Model for ${getProviderLabel(p)}`, value: cfg.getModel(p) });
            if (val !== undefined) { await cfg.set(`${p}.model`, val); vscode.window.showInformationMessage(`Model: ${val}`); }
        }),
        vscode.commands.registerCommand('agentcli.configureApiKey', async () => {
            const p = cfg.getActiveProvider();
            const label = getProviderLabel(p);
            const current = cfg.getApiKey(p);
            const masked = current ? `${current.slice(0, 6)}...${current.slice(-4)}` : '(not set)';
            const val = await vscode.window.showInputBox({ prompt: `API Key for ${label} (current: ${masked})`, password: true, placeHolder: 'sk-...' });
            if (val !== undefined) { await cfg.set(`${p}.apiKey`, val); vscode.window.showInformationMessage(`API key saved for ${label}`); }
        }),
        vscode.commands.registerCommand('agentcli.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', 'agentcli')),

        // File operations
        vscode.commands.registerCommand('agentcli.attachFile', async () => {
            const uris = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Attach to Chat' });
            if (uris?.length) vscode.window.showInformationMessage(`Attached ${uris.length} file(s)`);
        }),
        vscode.commands.registerCommand('agentcli.attachImage', async () => {
            const uris = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] } });
            if (uris?.length) vscode.window.showInformationMessage(`Image attached`);
        }),
        vscode.commands.registerCommand('agentcli.openFile', async () => {
            const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 200);
            const items = files.map(f => ({ label: path.basename(f.fsPath), description: vscode.workspace.asRelativePath(f), uri: f }));
            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Open file in editor' });
            if (picked) vscode.window.showTextDocument((picked as any).uri);
        }),

        // Agent control
        vscode.commands.registerCommand('agentcli.stopGeneration', () => provider.stop()),
        vscode.commands.registerCommand('agentcli.togglePlanningMode', async () => {
            const current = cfg.isPlanningMode();
            await cfg.set('planningMode', !current);
            vscode.window.showInformationMessage(`${!current ? 'Planning mode ON' : 'Planning mode OFF'}`);
        }),

        // Permissions
        vscode.commands.registerCommand('agentcli.setAccessFull', async () => {
            await cfg.set('access_scope', 'full');
            vscode.window.showInformationMessage('Full access mode');
        }),
        vscode.commands.registerCommand('agentcli.setAccessLimited', async () => {
            await cfg.set('access_scope', 'limited');
            vscode.window.showInformationMessage('Limited access mode');
        }),
        vscode.commands.registerCommand('agentcli.resetPermissions', async () => {
            await cfg.set('access_scope', 'limited');
            // Session access reset handled via reload or manual reset if exposed
            vscode.window.showInformationMessage('Permissions reset to limited');
        }),

        // Cost
        vscode.commands.registerCommand('agentcli.showCostSummary', () => vscode.window.showInformationMessage('Cost tracking is shown per-turn in the chat panel.')),

        // Focus
        vscode.commands.registerCommand('agentcli.focusChat', () => vscode.commands.executeCommand('agentcli.chatView.focus')),

        // Terminal
        vscode.commands.registerCommand('agentcli.runCommand', async () => {
            const cmd = await vscode.window.showInputBox({ prompt: 'Command to run', placeHolder: 'npm install' });
            if (cmd) {
                const terminal = vscode.window.createTerminal('Agent CLi');
                terminal.show();
                terminal.sendText(cmd);
            }

        }),
        vscode.commands.registerCommand('agentcli.explainCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const selection = editor.document.getText(editor.selection);
                if (selection) {
                    await vscode.commands.executeCommand('agentcli.chatView.focus');
                    provider.agent.chat(`Explain this code:\n\n\`\`\`\n${selection}\n\`\`\``, [], null, (ev) => { });
                }
            }
        }),
        vscode.commands.registerCommand('agentcli.fixCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const selection = editor.document.getText(editor.selection);
                if (selection) {
                    await vscode.commands.executeCommand('agentcli.chatView.focus');
                    provider.agent.chat(`Fix any issues or suggest improvements for this code:\n\n\`\`\`\n${selection}\n\`\`\``, [], null, (ev) => { });
                }
            }
        }),
        vscode.commands.registerCommand('agentcli.openManager', () => {
            vscode.commands.executeCommand('agentcli.chatView.focus');
        }),
        vscode.commands.registerCommand('agentcli.openDetachedChat', () => {
            provider.openDetachedChat();
        }),
    );

    // Status bar item
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '$(comment) Agent CLi';
    statusBar.command = 'agentcli.focusChat';
    statusBar.tooltip = 'Open Agent CLi Chat';
    statusBar.show();

    context.subscriptions.push(statusBar);
}

export function deactivate() {
    try {
        activeProvider?.agent.persistNow();
    } catch {
        // best effort on shutdown
    }
    activeProvider = null;
}

