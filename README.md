# Agent CLi for VS Code

**The Premium AI Coding Experience — Standalone & Powerful.**

This directory contains the production-grade VS Code extension for **Agent CLi**. Experience a fluid, glassmorphism-inspired UI coupled with the most advanced autonomous coding engine available.

---

## Key Extension Features

- **Glassmorphism UI**: High-end translucent interface that blends perfectly with modern VS Code themes.
- **GSAP Animations**: Fluid transitions and real-time "Thinking" pulses for a responsive feel.
- **Smart History**: Date-grouped chat sessions with semantic search.
- **Unified Backend**: Runs the exact same high-performance core as the CLI version.
- **Live HUD**: Monitor token usage and cost estimations in real-time.
- **Quick Assist Bar**: Copilot-inspired `Explain`, `Fix`, `Tests`, `Docs`, and `Review` actions directly in chat.
- **Slash Assist**: `/assist explain|fix|tests|docs|review|commit <target>` command parity in extension runtime.

## Recent UI Updates

- Fixed webview load issues that could leave the chat area hidden or broken on startup.
- Replaced corrupted icon glyph rendering with reliable codicon-based icons.
- Added top controls for `Model`, `Reasoning`, and independent `Plan`/`Fast`/`Mission` toggles.
- Kept quick actions (`EXPLAIN`, `FIX`, `TESTS`, `DOCS`, `REVIEW`) as a secondary row.
- Improved composer behavior with auto-expanding textarea and stable chat-area layout.
- Added clearer context visibility and preserved file/image attach, stop, and send workflows.
- Added detached fullscreen chat panel support for a larger focused chat surface.

---

## Build

### Requirements

- VS Code 1.85+
- Node.js 18+
- npm

### Install and compile

```sh
cd VSCODE
npm install
npm run compile
```

## Use

### Run extension locally

1. Open the `VSCODE/` folder in VS Code.
2. Press `F5` to launch the Extension Development Host.
3. Click **Agent CLi** in the activity bar.
4. Configure provider/model/API key.
5. Start chatting in the panel.

### Recommended first actions in chat

- Use quick buttons: `EXPLAIN`, `FIX`, `TESTS`, `DOCS`, `REVIEW`
- Attach files/images with the input buttons
- Use slash commands:
  - `/assist explain <target>`
  - `/assist fix <target>`
  - `/config max_requests 20`
  - `/config stream_timeout_ms false`

---

## Configuration & Privacy

Agent CLi puts you in control. Configuration is handled through local JSON files and the VS Code Secure Secret Store. Configure your MCP servers directly through the integrated management UI.

Key config examples:

```sh
/config max_requests 20
/config stream_timeout_ms false
```

## Project Instructions

The extension also respects project-level instructions from `AGENTS.md` in your workspace root.
For extension-specific guidance in this folder, see:

- `VSCODE/AGENTS.md`

---
*Professional grade AI for the modern developer.*
