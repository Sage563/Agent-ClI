# Architecture Overview

## Runtime Flow
1. `src/index.ts` bootstraps process warnings + launches `runMain()`.
2. `src/main.ts` loads runtime assets, onboarding, provider/model state, and input loop.
3. `src/core/agent.ts` is the execution engine:
   - builds task payload (`task_builder`)
   - calls provider adapter
   - parses structured JSON response
   - runs tools/search
   - applies file changes
   - executes commands
4. `src/ui/*` renders terminal UI state (panels, mission board, workspace layout).

## Core Modules
- `src/core/agent.ts`: central task lifecycle orchestration.
- `src/core/events.ts`: typed execution event bus.
- `src/core/session_access.ts`: session-level file access policy (`full` or `selective`).
- `src/core/command_runner.ts`: safe command execution with timeout/logging.
- `src/core/streaming.ts`: stream observer, throttled rendering, retry/fallback.
- `src/core/tools.ts`: web search/browse, project search, lint/index hooks.

## Providers
`src/providers/*` contains adapter implementations for:
- Ollama (local)
- OpenAI
- Anthropic
- Gemini
- DeepSeek

Each provider implements `Provider.call()` + `Provider.validate()`.

## Commands
`src/commands/*` registers slash commands through `registry.ts`.
Notable:
- `/config`, `/provider`, `/model`
- `/access`, `/logs`, `/search`
- `/mission`, `/plan`, `/fast`
- `/mcp` for MCP integration

## File Editing
- Model returns `changes[]` items.
- `src/applier.ts` applies transactional replacements with rollback on failure.
- Diffs shown through `src/ui/agent_ui.ts`.

## Session and Storage
Stored under app data directory (`%APPDATA%/agent-cli` on Windows):
- `agent.config.json`
- `.secrets.json`
- `sessions/*.json`
- `logs/commands-YYYY-MM-DD.ndjson`

