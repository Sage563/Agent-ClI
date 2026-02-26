import { cfg } from "../config";
import { MCPClient, MCPClientError } from "../mcp_client";
import { printError, printInfo, printPanel, printSuccess, printWarning } from "../ui/console";
import { registry } from "./registry";

function usage() {
  printPanel(
    [
      "Usage: /mcp <subcommand> ...",
      "",
      "Subcommands:",
      "- enable|disable",
      "- status",
      "- list",
      "- tools [server]",
      "- inspect <server>",
      "- describe <server> <tool>",
      "- prompts <server>",
      "- resources <server>",
      "- open <server> <uri>",
      "- run|call <server> <tool> [json-args]",
      "- test <server>",
      "- add <name> <command> [args...]",
      "- remove <name>",
    ].join("\n"),
    "MCP Help",
    "cyan",
    true,
  );
}

function getServerSpec(name: string) {
  const servers = cfg.getMcpServers();
  const spec = servers[name];
  if (!spec) {
    printError(`Unknown MCP server: ${name}`);
    return null;
  }
  return spec as Record<string, unknown>;
}

function createClient(name: string) {
  const spec = getServerSpec(name);
  if (!spec) return null;
  return new MCPClient(
    String(spec.command || ""),
    Array.isArray(spec.args) ? (spec.args as string[]) : [],
    (spec.env || {}) as Record<string, string>,
  );
}

function serverNames() {
  return Object.keys(cfg.getMcpServers());
}

async function listToolsAcrossServers(names: string[]) {
  const lines: string[] = [];
  for (const name of names) {
    const client = createClient(name);
    if (!client) continue;
    try {
      const res = (await client.listTools()) as any;
      const tools = Array.isArray(res?.result?.tools) ? res.result.tools : [];
      lines.push(`## ${name}`);
      if (!tools.length) lines.push("- (no tools)");
      else tools.forEach((tool: any) => lines.push(`- \`${String(tool?.name || "unknown")}\``));
      lines.push("");
    } catch (error) {
      lines.push(`## ${name}`);
      lines.push(`- Error: ${String(error)}`);
      lines.push("");
    } finally {
      client.close();
    }
  }
  return lines.join("\n").trim();
}

registry.register("/mcp", "Manage MCP servers (list, tools, inspect, run)")(async (_, args) => {
  const sub = String(args[1] || "").toLowerCase();
  if (!sub) {
    usage();
    return true;
  }

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
  if (sub === "status") {
    const names = serverNames();
    printPanel(
      [
        `Enabled: **${cfg.isMcpEnabled() ? "yes" : "no"}**`,
        `Configured servers: **${names.length}**`,
        "",
        ...names.map((name) => `- \`${name}\``),
      ].join("\n"),
      "MCP Status",
      "cyan",
      true,
    );
    return true;
  }

  if (!cfg.isMcpEnabled()) {
    printError("MCP is disabled. Use /mcp enable to turn it on.");
    return true;
  }

  const names = serverNames();
  if (sub === "list") {
    if (!names.length) {
      printInfo("No MCP servers configured.");
      printInfo("Add one in agent.config.json under mcp_servers.");
      return true;
    }
    const lines = names.map((name) => {
      const spec = cfg.getMcpServers()[name] as any;
      const cmd = String(spec?.command || "");
      const cmdArgs = Array.isArray(spec?.args) ? spec.args.join(" ") : "";
      return `- \`${name}\`: ${cmd} ${cmdArgs}`.trim();
    });
    printPanel(lines.join("\n"), "MCP Servers", "cyan", true);
    return true;
  }

  if (sub === "add") {
    const nameArg = String(args[2] || "");
    const commandArg = String(args[3] || "");
    if (!nameArg || !commandArg) {
      printError("Usage: /mcp add <name> <command> [args...]");
      printInfo("Example: /mcp add weather npx -y @modelcontextprotocol/server-weather");
      return true;
    }
    const serverArgs = args.slice(4);

    // Simple GitHub detection: if the command looks like a github URL or user/repo
    const finalCommand = commandArg;
    const finalArgs = [...serverArgs];

    if (commandArg.startsWith("https://github.com/") || (commandArg.includes("/") && !commandArg.startsWith("-") && !commandArg.startsWith("."))) {
      // If it looks like a github reference but no npx/uvx, maybe suggest or wrap?
      // For now, we'll just let the user be explicit, but we can detect if they forgot npx
      if (!commandArg.startsWith("npx") && !commandArg.startsWith("uvx") && !commandArg.startsWith("node") && !commandArg.startsWith("python")) {
        printWarning(`Note: ${commandArg} looks like a GitHub reference. If this is a Node package, you might need 'npx' before it.`);
      }
    }

    cfg.setMcpServer(nameArg, finalCommand, finalArgs);
    printSuccess(`MCP server '${nameArg}' added successfully.`);
    return true;
  }

  if (sub === "remove" || sub === "rm" || sub === "delete") {
    const nameArg = String(args[2] || "");
    if (!nameArg) {
      printError("Usage: /mcp remove <name>");
      return true;
    }
    cfg.removeMcpServer(nameArg);
    printSuccess(`MCP server '${nameArg}' removed.`);
    return true;
  }

  if (sub === "tools" && args.length < 3) {
    const text = await listToolsAcrossServers(names);
    printPanel(text || "No tools found.", "MCP Tools (All Servers)", "cyan", true);
    return true;
  }

  const name = String(args[2] || "");
  if (!name) {
    usage();
    return true;
  }
  const client = createClient(name);
  if (!client) return true;

  try {
    if (sub === "inspect") {
      const [tools, prompts, resources] = await Promise.all([
        client.listTools().catch((e) => ({ error: String(e) })),
        client.listPrompts().catch((e) => ({ error: String(e) })),
        client.listResources().catch((e) => ({ error: String(e) })),
      ]);
      const toolCount = Array.isArray((tools as any)?.result?.tools) ? (tools as any).result.tools.length : 0;
      const promptCount = Array.isArray((prompts as any)?.result?.prompts) ? (prompts as any).result.prompts.length : 0;
      const resourceCount = Array.isArray((resources as any)?.result?.resources) ? (resources as any).result.resources.length : 0;
      printPanel(
        [
          `Server: **${name}**`,
          `Tools: **${toolCount}**`,
          `Prompts: **${promptCount}**`,
          `Resources: **${resourceCount}**`,
        ].join("\n"),
        "MCP Inspect",
        "green",
        true,
      );
      return true;
    }

    if (sub === "test") {
      await client.listTools();
      printSuccess(`MCP server '${name}' is reachable and responding.`);
      return true;
    }

    if (sub === "tools") {
      printSuccess(JSON.stringify(await client.listTools(), null, 2));
      return true;
    }
    if (sub === "describe") {
      const toolName = String(args[3] || "");
      if (!toolName) {
        printError("Usage: /mcp describe <server> <tool>");
        return true;
      }
      const list = (await client.listTools()) as any;
      const tools = list?.result?.tools || [];
      const match = tools.find((tool: any) => String(tool?.name || "") === toolName);
      if (!match) printError(`Tool not found: ${toolName}`);
      else printSuccess(JSON.stringify(match, null, 2));
      return true;
    }
    if (sub === "prompts") {
      printSuccess(JSON.stringify(await client.listPrompts(), null, 2));
      return true;
    }
    if (sub === "resources") {
      printSuccess(JSON.stringify(await client.listResources(), null, 2));
      return true;
    }
    if (sub === "open") {
      const uri = args.slice(3).join(" ").trim();
      if (!uri) {
        printError("Usage: /mcp open <server> <uri>");
        return true;
      }
      printSuccess(JSON.stringify(await client.readResource(uri), null, 2));
      return true;
    }
    if (sub === "run" || sub === "call") {
      const toolName = String(args[3] || "");
      if (!toolName) {
        printError("Usage: /mcp run <server> <tool> [json-args]");
        return true;
      }
      const rawArgs = args.slice(4).join(" ").trim();
      let parsedArgs: Record<string, unknown> = {};
      if (rawArgs) {
        try {
          parsedArgs = JSON.parse(rawArgs);
        } catch {
          printError('Invalid JSON args. Example: {"path":"src"}');
          return true;
        }
      }
      printSuccess(JSON.stringify(await client.callTool(toolName, parsedArgs), null, 2));
      return true;
    }

    printWarning(`Unknown /mcp subcommand: ${sub}`);
    usage();
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

