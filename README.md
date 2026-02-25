# Agent CLI

Agent CLI is a terminal coding agent with mission mode, provider switching, and SEA executable packaging.

## Features

- Single executable build pipeline (Node SEA + checksum artifact)
- Mission mode orchestration for multi-step autonomous work
- Provider support: Ollama, OpenAI, Anthropic, Gemini, DeepSeek
- MCP integration and command/tool execution flow
- Streamed UI with activity and schema-aware output panels

## Requirements

- Node.js 18+
- npm
- Windows (for SEA `.exe` build)

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

## Production Deployability

### CI Pipelines

- `.github/workflows/ci.yml`
  - Lint, test, and build checks
  - Windows SEA compile smoke build
- `.github/workflows/release-exe.yml`
  - Manual/tag-based Windows release artifact build

### Build Windows EXE

```bash
npm run compile
.\release\agent_cli.exe
```

### Container Build

```bash
docker build -t agent-cli:latest .
docker run --rm -it agent-cli:latest
```

## NPM Scripts

- `npm run dev`: Launch the agent in development mode
- `npm run build`: Compile TypeScript to `dist/`
- `npm run test`: Run tests
- `npm run compile`: Build SEA executable into `release/`
- `npm run clean`: Remove build artifacts
- `npm run clean:all`: Full reset of build/release/generated assets

## Project Structure

- `src/`: TypeScript application source
- `scripts/`: build and asset tooling
- `assets/`: static assets/icons
- `release/`: generated distribution artifacts

## Scalability Baseline

- Structured provider abstraction and runtime model/provider switching
- Mission loop with tool execution, approvals, and apply pipeline
- Stream parsing + activity output for long-running tasks
- Reproducible release artifacts with checksum
- CI gate to prevent broken builds from shipping

## Feature Parity Roadmap

If you want closer parity with full “Claude Code-like” capability, implement in phases:
1. Reliability: strict response schema validation, retries, timeout policies, recovery.
2. Tooling: richer MCP servers, safer execution boundaries, policy-driven permissions.
3. Context: stronger indexing/RAG, memory compaction, relevance scoring.
4. Collaboration: review mode, confidence scoring, test-first patch flows.
5. Operations: telemetry hooks, structured logs, metrics/SLO dashboards.

---
*Built with precision for the modern developer.*

*Run `/donut` for a little fun.*
