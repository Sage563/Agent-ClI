# Model Context Protocol (MCP) in Agent CLI

Agent CLI natively supports the **Model Context Protocol (MCP)**. This powerful protocol allows the autonomous agent to interface with a massive, growing ecosystem of external tools, prompts, databases, and resources.

---

## Quick Start

### 1. Enable MCP Integration
MCP may be disabled by default. You can enable it via the CLI:
```bash
/mcp enable
```

### 2. View System Status
Check if MCP is active and see the total number of configured servers:
```bash
/mcp status
```

### 3. List Active Servers
Display all configured servers alongside their startup commands:
```bash
/mcp list
```

---

## Configuring MCP Servers

Servers running MCP tools can be configured directly in your `agent.config.json` (located in `%APPDATA%/agent-cli` on Windows).

### Adding Servers via CLI
You can add a completely new server natively through an Agent CLI session:
```bash
/mcp add weather npx -y @modelcontextprotocol/server-weather
```

### Manual Configuration
You can also manually edit your `agent.config.json` file. Append a new entry to the `mcp_servers` object block:
```json
"mcp_servers": {
  "my-server": {
    "command": "npx",
    "args": ["-y", "@author/my-mcp-server"],
    "env": {
      "API_KEY": "your-key-here"
    }
  }
}
```

---

## Using MCP Tools

### Autonomous Invocation in Chat
When MCP is enabled, the AI agent dynamically loads tool schemas from your configured servers directly into its system prompt. When you ask a question requiring an external tool (e.g., "What is the weather in Seattle?"), the agent dynamically reasons over these schemas and **calls the relevant tool autonomously**.

### Manual Tool Invocation
To test connections, bypass the LLM, or manually run an MCP tool, use the `/mcp run` command:
```bash
/mcp run weather get_forecast {"city": "Seattle"}
```

---

## Subcommands Reference

| Subcommand | Description |
|---|---|
| `/mcp enable` / `/mcp disable` | Toggle MCP engine integration on or off. |
| `/mcp status` | Show overarching status and tool injection count. |
| `/mcp list` | Enumerate all configured servers. |
| `/mcp add <name> <cmd> [args...]`| Inject a new, reusable MCP server. |
| `/mcp tools [server]` | Probe exposed tools across one or all servers. |
| `/mcp inspect <server>` | Show diagnostic counts of tools, prompts, and resources. |
| `/mcp test <server>` | Validate functional connectivity to a specific server. |
| `/mcp run <server> <tool> <json>`| Fire a manual JSON payload event to an external tool. |

---

## Popular Extensible MCP Servers

| Server Purpose | NPM Package / Command |
|---|---|
| **Brave Search** | `npx -y @modelcontextprotocol/server-brave-search` |
| **Filesystem Interaction** | `npx -y @modelcontextprotocol/server-filesystem <path>` |
| **GitHub Operations** | `npx -y @modelcontextprotocol/server-github` |
| **Long-term Memory** | `npx -y @modelcontextprotocol/server-memory` |
| **SQLite Interaction** | `uvx mcp-server-sqlite --db-path <path>` |

---

> [!TIP]
> **Use `--yes` (`-y`) for `npx`:** Make sure to append `-y` for Node-based MCP server execution commands. This prevents `npx` from indefinitely stalling on an installation prompt (`"Need to install the following packages..."`), ensuring stable continuous integration.
