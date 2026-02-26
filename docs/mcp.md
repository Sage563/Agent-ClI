# Model Context Protocol (MCP) in Agent CLI

Agent CLI natively supports the **Model Context Protocol (MCP)**, allowing the AI to use an ever-growing ecosystem of external tools, prompts, and resources.

## Quick Start

### 1. Enable MCP
By default, MCP might be disabled. Turn it on using:
```bash
/mcp enable
```

### 2. View Status
Check if MCP is active and see how many servers are configured:
```bash
/mcp status
```

### 3. List Servers
See all configured servers and their startup commands:
```bash
/mcp list
```

## Configuring MCP Servers

MCP servers are defined in your `agent.config.json` (located in `%APPDATA%/agent-cli` on Windows).

### Adding via CLI
You can add new servers directly from the Agent CLI session:
```bash
/mcp add weather npx -y @modelcontextprotocol/server-weather
```

### Manual Configuration
Add a new entry to the `mcp_servers` object in your config:
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

## Using MCP Tools

### In Chat
The AI agent automatically sees tools provided by enabled MCP servers in its system prompt. If you ask a question that requires an external tool (e.g., "What is the weather in Seattle?"), the agent will autonomously call the relevant MCP tool.

### Manual Tool Invocation
You can manually test tools using the `/mcp run` command:
```bash
/mcp run weather get_forecast {"city": "Seattle"}
```

## Subcommands Reference

| Subcommand | Description |
|------------|-------------|
| `enable` / `disable` | Toggle MCP integration. |
| `status` | Show overall MCP status. |
| `list` | List all configured servers. |
| `add <name> <cmd> [args...]` | Add a new MCP server. |
| `tools [server]` | List tools from one or all servers. |
| `inspect <server>` | Show counts of tools, prompts, and resources. |
| `test <server>` | Verify connectivity to a server. |
| `run <server> <tool> <json>`| Manually call a specific tool. |


## Popular MCP Servers

| Server | NPM Package / Command |
|--------|-----------------------|
| Brave Search | `npx -y @modelcontextprotocol/server-brave-search` |
| Filesystem | `npx -y @modelcontextprotocol/server-filesystem <path>` |
| GitHub | `npx -y @modelcontextprotocol/server-github` |
| Memory | `npx -y @modelcontextprotocol/server-memory` |
| SQLite | `uvx mcp-server-sqlite --db-path <path>` |

---

> [!TIP]
> Use `npx -y` for Node-based servers to ensure they are downloaded and run in one step without manual installation.
