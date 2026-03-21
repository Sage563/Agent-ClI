# Agent CLi

Terminal-first coding agent with VS Code companion support.

## What is new

- Copilot-inspired assistant flows via `/assist`
- Local skill management via `/skills`
- Better interactive CLI input UI with live command hints
- Stronger project bootstrap flow with `/init` -> `AGENTS.md`
- VS Code extension now persists chats as multiple session files in `%APPDATA%/agent-cli/sessions/vscode_chats/`
- Ollama `/api/chat` fallback to `/v1/api/chat` when needed
- Per-provider `thinking` toggle for reasoning output and printing
- UI output now strips internal format-instruction noise and falls back to plain text if markdown rendering fails
- Context picker now pauses prompt rendering/scroll regions and restores terminal state on exit
- Prompt queuing via `;;` or `/queue` for sequential execution
- TUI layout with chat, tools, files, preview, and status panels
## Core features

- Multi-provider chat and coding workflows (OpenAI, Anthropic, Gemini, Ollama, DeepSeek, HF)
- Mission mode for autonomous multi-step execution
- Planning mode for explicit plan-then-apply flow
- Inline file edits, command execution, and diff tracking
- MCP support for external tools
- Session memory and context-aware project operation

## Build

### Requirements

- Node.js 18+
- npm

### Install dependencies

```bash
npm install
```

### Build CLI

```bash
npm run build
```

### Build release executable (optional)

```bash
npm run exe
```

## Use

### Start interactive CLI

```bash
npm start
```

### Run one prompt and exit

```bash
npm start -- --print "summarize this repository"
```

### Start with useful flags

```bash
npm start -- --plan
npm start -- --fast
npm start -- --model gpt-4o
```

### TUI Mode

TUI is enabled by default. Toggle it with:

```bash
/config tui_enabled false
/config tui_enabled true
```

## Most useful commands

- `/help`: full command reference
- `/commands <query>`: search command list
- `/assist explain|fix|tests|docs|review|commit <target>`: guided coding workflows
- `/files`: list project files (alias for `/ls`)
- `/open <file>`: open a file preview (alias for `/read`)
- `/run <command>`: run a shell command (alias for `!`)
- `/skills list|init|where`: manage local skills in `.agent/skills`
- `/config max_requests <number>`: limit AI requests per session (`0` = unlimited)
- `/init`: generate `AGENTS.md` for project-specific instructions
- `/plan`, `/mission`, `/fast`: execution modes
- `/clear`: clear the terminal screen (alias for `/cls`)
- `!<command>`: run shell commands inline
- `@`: open context picker to attach files

## Skills in CLI

`/skills` creates and manages local skills under:

```text
.agent/skills/
```

Each skill scaffold includes:

- `SKILL.md`
- `agents/openai.yaml`
- `references/`
- `scripts/`
- `assets/`

## AGENTS.md

Agent CLi auto-loads project instructions from `AGENTS.md` in the repo root.

Generate a starter file:

```bash
/init
```

Then customize conventions, architecture notes, and guardrails for your codebase.
Run /donut for a little fun!!!
