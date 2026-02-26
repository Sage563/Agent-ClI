# Agent CLI

## Overview
Agent CLI is an autonomous, terminal-first AI coding assistant that acts as a true agent—it talks with you and writes code directly in your project. Similar to tools like **Claude Code** and **Aider**, it doesn't just suggest code; it actively executes real project work, refactors, and runs terminal commands autonomously. It supports local and remote models, structured file edits, command execution, mission mode, web search, and transparent task lifecycle updates.

## Features
- **True AI Agent**: It talks, codes, and executes tasks directly in your workspace.
- CLI/TUI workspace with activity, status, and streaming output.
- Code-first agent behavior (`changes[]` and `commands[]` focused).
- Session-level access control (`full` or `selective` file access).
- Provider support: Ollama, OpenAI, Anthropic, Gemini, DeepSeek.
- Web search and browse tooling with visible sources.
- Mission mode for autonomous multi-step execution.
- Command logging with exit codes and captured output.

## Installation
### Prerequisites
- Node.js 20+
- npm
- Windows recommended for `.exe` compile (`npm run compile`)

### Install
```bash
git clone github.com/Sage563/Agent-ClI.git
cd Agent-ClI
npm install
```

## Model Setup
### Local Models (Ollama)
1. Install Ollama.
2. Pull a model:
```bash
ollama pull qwen3:14b
```
3. In Agent CLI:
```bash
/provider ollama
/config endpoint http://localhost:11434
/model qwen3:14b
```

### Remote API Models
Pick a provider and set model:
```bash
/provider openai
/model gpt-4o
```
Supported providers: `openai`, `anthropic`, `gemini`, `deepseek`.

## API Key Setup
### Option A: CLI Config Commands
```bash
/config openai_api_key <key>
/config anthropic_api_key <key>
/config gemini_api_key <key>
/config deepseek_api_key <key>
```

### Option B: `.env` Bootstrap (Bridge to runtime config)
Create `.env` in repo root (see `docs/.env.example`):
```env
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
DEEPSEEK_API_KEY=...
OLLAMA_ENDPOINT=http://localhost:11434
```
On startup, if `env_bridge_enabled=true`, values are synced into app config/secrets.

## Usage
Start:
```bash
npm run dev
```

Core examples:
```bash
/help
/config
/access prompt
/list_diff 20
/timeout unlimited
/mcp status
/search latest typescript release notes
/logs 20
```

Inline shell:
```bash
!git status
```

Attach files:
```text
Fix this bug in @src/core/agent.ts
```

## Configuration
App config is stored in user app-data (`%APPDATA%/agent-cli` on Windows).

Useful keys:
- `run_policy`: `ask | always | never`
- `stream`, `stream_print`
- `stream_timeout_ms`, `stream_retry_count`, `stream_render_fps`
- `command_timeout_ms` (`0` means unlimited), `command_log_enabled`
- `env_bridge_enabled`
- `max_budget`

See:
```bash
/config -h
```

### Model Context Protocol (MCP)
Agent CLI supports MCP out of the box. For a full guide on configuring and using MCP servers, see [docs/mcp.md](docs/mcp.md).

Quick commands:
```bash
/mcp enable             # Turn on MCP integration
/mcp status             # Check status and server count
/mcp list               # List all configured servers
/mcp add <name> <cmd>   # Add a new MCP server
/mcp tools              # List available tools
/mcp inspect <server>   # Inspect tools, prompts, resources
```

Example config: `docs/config.example.json`

## Development
### Development mode
```bash
npm run dev
```

### Test
```bash
npm run test
```

### Lint
```bash
npm run lint
```

### Production build (Node dist)
```bash
npm run build
npm run start
```

### Production build (Windows EXE)
```bash
npm run compile
.\release\agent_cli.exe
```

### Docker
```bash
docker build -t agent-cli:latest .
docker run --rm -it agent-cli:latest
```

## Architecture Overview
High-level module map:
- `src/core`: agent loop, permissions, tools, events, command runner, session access.
- `src/providers`: model adapters for each provider.
- `src/ui`: terminal panels, mission board, session GUI, workspace layout.
- `src/commands`: slash-command registry and handlers.
- `src/task_builder.ts`: request payload assembly and context gathering.
- `src/applier.ts`: transactional file change apply/rollback.

Detailed architecture: `docs/architecture.md`

## Troubleshooting
See `docs/troubleshooting.md` for common issues:
- provider/API key validation failures
- streaming timeout/fallback behavior
- permission/access prompts
- command timeout failures
- CI lint/test/build failures

## Contributing
1. Create a branch.
2. Implement changes with tests.
3. Run:
```bash
npm run lint
npm run test
npm run build
```
4. Open a PR with behavior summary and validation notes.
