import { cfg } from "../config";
import { MCPClient, MCPClientError } from "../mcp_client";
import { printError, printInfo, printSuccess } from "../ui/console";
import { registry } from "./registry";

registry.register("/mcp", "Manage MCP servers (list, resources, run)")(async (_, args) => {
  if (args.length < 2) {
    printError("Usage: /mcp [enable|disable|list|tools|describe|prompts|resources|open|run]");
    return true;
  }

  const sub = args[1].toLowerCase();
  if (sub === "enable" || sub === "on") {
    cfg.setMcpEnabled(true);
    printSuccess("MCP: ENABLED");
    return true;
  }
  if (sub === "disable" || sub === "off") {
    cfg.setMcpEnabled(false);
    printInfo("MCP: DISABLED");
    return true;
  }

  if (!cfg.isMcpEnabled()) {
    printError("MCP is disabled. Use /mcp enable to turn it on.");
    return true;
  }

  const servers = cfg.getMcpServers();
  if (sub === "list") {
    if (!Object.keys(servers).length) {
      printInfo("No MCP servers configured.");
      printInfo("Add one in agent.config.json under mcp_servers.");
      return true;
    }
    printInfo("MCP Servers:");
    Object.entries(servers).forEach(([name, spec]: [string, any]) => {
      const command = spec.command || "";
      const commandArgs = Array.isArray(spec.args) ? spec.args : [];
      printInfo(` - ${name}: ${command} ${commandArgs.join(" ")}`);
    });
    return true;
  }

  const name = args[2];
  const spec = servers[name];
  if (!name || !spec) {
    printError(`Unknown MCP server: ${name || "(missing)"}`);
    return true;
  }
  const client = new MCPClient(spec.command || "", spec.args || [], spec.env || {});

  try {
    if (sub === "tools") {
      printSuccess(JSON.stringify(await client.listTools(), null, 2));
    } else if (sub === "describe") {
      const toolName = args[3];
      if (!toolName) {
        printError("Usage: /mcp describe <server> <tool>");
      } else {
        const list = (await client.listTools()) as any;
        const tools = list?.result?.tools || [];
        const match = tools.find((tool: any) => tool?.name === toolName);
        if (!match) printError(`Tool not found: ${toolName}`);
        else printSuccess(JSON.stringify(match, null, 2));
      }
    } else if (sub === "prompts") {
      printSuccess(JSON.stringify(await client.listPrompts(), null, 2));
    } else if (sub === "resources") {
      printSuccess(JSON.stringify(await client.listResources(), null, 2));
    } else if (sub === "open") {
      const uri = args.slice(3).join(" ").trim();
      if (!uri) printError("Usage: /mcp open <server> <uri>");
      else printSuccess(JSON.stringify(await client.readResource(uri), null, 2));
    } else if (sub === "run") {
      const toolName = args[3];
      if (!toolName) {
        printError("Usage: /mcp run <server> <tool> [json-args]");
      } else {
        const rawArgs = args.slice(4).join(" ").trim();
        let parsedArgs: Record<string, unknown> = {};
        if (rawArgs) {
          try {
            parsedArgs = JSON.parse(rawArgs);
          } catch {
            printError('Invalid JSON args. Example: {"path":"src"}');
            client.close();
            return true;
          }
        }
        printSuccess(JSON.stringify(await client.callTool(toolName, parsedArgs), null, 2));
      }
    } else {
      printError("Usage: /mcp [enable|disable|list|tools|describe|prompts|resources|open|run]");
    }
  } catch (error) {
    if (error instanceof MCPClientError) printError(error.message);
    else printError(String(error));
  } finally {
    client.close();
  }
  return true;
});

export function registerMcp() {
  return true;
}
