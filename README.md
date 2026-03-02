<div align="center">
  <h1>Agent CLI</h1>
  <p><strong>A powerful, terminal-first, autonomous AI coding assistant.</strong></p>
</div>

---

## Overview

**Agent CLI** is not just another autocomplete tool. It is an **autonomous, terminal-first AI coding assistant** that acts as a true agent in your workflow. Like Claude Code or Aider, it doesn't simply suggest code—it actively executes real project work, refactors entire components, and runs terminal commands autonomously. 

Built for developers who live in the terminal, Agent CLI provides a robust CLI/TUI hybrid experience that keeps you informed with transparent task lifecycle updates, streaming output, and deep integration with your workspace.

---

## Key Features

- **True Autonomous Agent**: Talks, codes, and executes tasks directly within your project workspace.
- **Code-First Architecture**: Built natively to focus on generating file changes (`changes[]`) and executing system actions (`commands[]`).
- **Comprehensive TUI**: A rich terminal UI featuring an active mission board, real-time status updates, and streaming model output.
- **Granular Access Control**: Flexible session-level policy (`full` or `selective` workspace access) to keep your project secure.
- **Multi-Provider Support**: Seamlessly switch between top-tier AI models from **OpenAI**, **Anthropic**, **Gemini**, **DeepSeek**, **Hugging Face**, or run entirely locally via **Ollama**.
- **Model Context Protocol (MCP)**: Out-of-the-box support for the MCP ecosystem, enabling rich external tool integrations.
- **Advanced Autonomous Tooling**: Includes built-in web search, deep project indexing, and a powerful "Mission Mode" for multi-step, sustained task execution.
- **Standalone Binary**: Deploy as a native standalone `.exe` for zero-dependency execution in any environment.

---

## Installation & Prerequisites

### Prerequisites
- Node.js (Version 20+)
- npm (Node Package Manager)
- *(Optional)* Windows environment for compiling native binaries.

### Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Sage563/Agent-CLI.git
   cd Agent-CLI
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Launch the CLI:**
   ```bash
   npm run dev
   ```

---

## Model Configuration

Agent CLI handles both local and cloud-based providers with native support for specialized reasoning models.

### Local Models (Ollama)

1. **Install [Ollama](https://ollama.com/)**.
2. **Pull and configure your model:**
   ```bash
   /provider ollama
   /config endpoint http://localhost:11434
   /model qwen3:14b
   ```

### Cloud Providers (`openai`, `anthropic`, `gemini`, `deepseek`)

1. **Select provider and model:**
   ```bash
   /provider anthropic
   /model claude-3-5-sonnet-20241022
   ```
2. **Configure API Key:**
   ```bash
   /config anthropic_api_key your-api-key-here
   ```

### Hugging Face (Inference API)

Agent CLI can interface with thousands of models on Hugging Face using their standard Inference API.

1. **Set your API Token:**
   ```bash
   /provider hf
   /config hf_api_key your-token-here
   ```
2. **Choose a model ID or custom Endpoint:**
   ```bash
   /model meta-llama/Llama-2-7b-chat-hf
   # OR use a custom inference endpoint
   /config endpoint https://your-custom-endpoint.huggingface.co
   ```

---

## Usage Guide

### Starting the Agent

To start the interactive Terminal UI, run:
```bash
npm run dev
```

### Core Commands

Inside the Agent CLI environment, you can use these core slash-commands:

```bash
/help                   # View all available commands
/config                 # View and modify current configuration
/config -h              # View configuration options help
/access prompt          # Request/reset file access permissions
/list_diff 20           # View recent file diffs
/timeout unlimited      # Adjust task timeout limits
/search <query>         # Perform Web searches natively
/status                 # Run a diagnostic check on providers
/logs 20                # Tail the underlying command logs
```

### Transparent reasoning

Agent CLI makes the AI's "thought stream" visible in real-time. You can monitor the agent's strategy through dedicated live headers:
- `----AGENT THINKING--------`: Raw reasoning and logic steps.
- `----AGENT PLAN--------`: The multi-step execution strategy.
- `— AI RESPONSE —`: The final conversational output.

### Execution Directives

- **Inline Shell Execution**: Prefix any terminal command with `!` to run it directly:
  ```bash
  !git status
  ```
- **Contextual File References**: Simply mention files in your natural language prompt and the agent will detect and read them:
  ```text
  Please fix the error handling in src/core/agent.ts
  ```

---

## Configuration & Environment

Configuration is stored securely in your user application data directory (`%APPDATA%/agent-cli` on Windows).

### Environment Variables Bootstrap

To avoid typing keys manually, setup an `.env` file in the root directory. This data bridges into the application's secure configuration at startup (if `env_bridge_enabled=true`).

*Copy the example template (`docs/.env.example`) to `.env` and fill it in:*
```env
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
GEMINI_API_KEY=your_gemini_key
DEEPSEEK_API_KEY=your_deepseek_key
HUGGINGFACE_API_KEY=your_huggingface_key
OLLAMA_ENDPOINT=http://localhost:11434
```

### Key Configuration Options

You can modify behavior via the `/config` command:
- `run_policy`: Set auto-execution behavior (`ask` | `always` | `never`).
- `stream` / `stream_print`: Toggle AI output streaming.
- `command_timeout_ms`: Maximum execution time for shell commands (`0` for unlimited).
- `max_budget`: Limit token spending/budget.

---

## Model Context Protocol (MCP)

Agent CLI provides deep integration with the **Model Context Protocol (MCP)**, allowing your AI to query external databases, interact with GitHub, fetch weather, and more.

**Quick Commands:**
```bash
/mcp enable             # Turn on MCP integration
/mcp status             # View active MCP servers
/mcp list               # List all configured servers
/mcp add <name> <cmd>   # Add a new tool server
/mcp tools              # See available external tools
```

*For a comprehensive guide, see the [MCP Documentation](docs/mcp.md).*

---

## Development & Deployment

### Development Mode

Run the continuous development build:
```bash
npm run dev
```

### Code Quality

Ensure your commits pass standard checks:
```bash
npm run lint
npm run test
```

### Production Builds

**Standard Node Build:**
```bash
npm run build
npm run start
```

**Standalone Windows Executable (.exe):**
```bash
npm run compile
.\release\agent_cli.exe
```

**Docker Container:**
```bash
docker build -t agent-cli:latest .
docker run --rm -it agent-cli:latest
```

---

## Architecture

Agent CLI is designed with a robust, modular architecture:

- `src/core`: The heart of the application—handles the agent loop, access permissions, telemetry, the command runner, and event buses.
- `src/providers`: Clean adapter abstractions for LLM providers.
- `src/ui`: The layout engine, mission board, and rendering logic for the TUI.
- `src/commands`: The registry and handlers for all interactive slash-commands.
- `src/applier.ts`: A transactional file change manager with automatic rollback capabilities.

*For a detailed breakdown, see the [Architecture Overview](docs/architecture.md).*

---

## Troubleshooting

Encountering issues? See the [Troubleshooting Guide](docs/troubleshooting.md) for solutions to common problems, including:
- API Key Validation Failures
- Streaming Stalls & UI Freezes
- File Access Denied Errors
- Command Execution Timeouts

---

## Contributing

We welcome community contributions!

1. Fork and create a feature branch.
2. Implement your changes.
3. Validate your code:
   ```bash
   npm run lint && npm run test && npm run build
   ```
4. Open a Pull Request detailing the changes, behaviors, and testing steps.
