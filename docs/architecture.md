# Architecture Overview

The Agent CLi is structured around a central orchestration engine, provider adapters, and a reactive terminal user interface.

##  Runtime Flow

The application execution lifecycle follows these primary steps:

1. **Bootstrap (`src/index.ts`)**: Initializes the process, handles top-level warnings, and launches `runMain()`.
2. **Setup (`src/main.ts`)**: Loads runtime assets, user onboarding data, provider/model states, and starts the core input loop.
3. **Execution Engine (`src/core/agent.ts`)**: The heart of the application. It:
   - Compiles the system state into a prompt payload via `task_builder.ts`.
   - Sends requests to the configured provider API.
   - Parses the structured JSON responses.
   - Autonomously executes built-in tools (search, read, etc.).
   - Applies filesystem changes transactionally.
   - Executes terminal commands safely.
4. **Presentation (`src/ui/*`)**: Renders the terminal UI, updating the active mission board, status panels, and workspace layouts in real-time.

---

##  Core Modules

- **`src/core/agent.ts`**: Orchestrates the central task lifecycle.
- **`src/core/events.ts`**: A robust, strongly-typed event bus for execution state broadcasting.
- **`src/core/session_access.ts`**: Manages session-level file access security policies (`full` vs `selective`).
- **`src/core/command_runner.ts`**: Provides safe local command execution, featuring strict timeouts and comprehensive output logging.
- **`src/core/streaming.ts`**: Handles LLM output streams, providing throttled UI rendering, retry logic, and fallback mechanisms.
- **`src/core/tools.ts`**: Implements built-in autonomous functions like web search, project indexing, and code linting.
- **`src/applier.ts`**: Applies code modifications safely, backing up files temporarily to ensure reliable rollbacks on failure.
- **`src/task_builder.ts`**: Assembles the LLM context payload, gathering system info, history, and tool schemas.

---

##  Provider Adapters

The system interfaces with Large Language Models through unified provider adapters located in `src/providers/*`:

- **Ollama** (Local inference)
- **OpenAI**
- **Anthropic**
- **Gemini**
- **DeepSeek**
- **Hugging Face**

Every provider implements the core `Provider` interface, exposing a standardized `call()` method for generation and a `validate()` method for startup diagnostics.

---

## ⌨️ Command Registry

Slash commands are managed in `src/commands/*` and registered centrally via `registry.ts`.
Key categories include:

- **Configuration**: `/config`, `/provider`, `/model`
- **Security & Inspection**: `/access`, `/logs`, `/status`
- **Workflows**: `/mission`, `/plan`, `/fast`
- **Integrations**: `/mcp`, `/search`

---

##  Session & Storage Hierarchy

All user configuration, secrets, and historical session logs are stored securely in the local application data directory.

**Path on Windows:** `%APPDATA%/agent-cli`

### Directory Structure
- `agent.config.json`: The primary configuration settings.
- `.secrets.json`: Secure storage for API keys.
- `sessions/*.json`: Serialized state of past and active conversational sessions.
- `logs/commands-YYYY-MM-DD.ndjson`: Detailed, structured logs of all executed terminal commands and their outputs.
