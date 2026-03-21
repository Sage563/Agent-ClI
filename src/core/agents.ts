/**
 * Agent Presets — Build, Plan, Explore, General, and system agents.
 * Support for Tab-switchable agents and @mention subagents.
 */
import { cfg } from "../config";
import type { ToolPermission } from "../types";

export interface AgentPreset {
    name: string;
    label: string;
    description: string;
    mode: "primary" | "subagent" | "system";
    color: string;
    permissions: Record<string, ToolPermission>;
    hidden?: boolean;
    maxSteps?: number;
}

const BUILD_AGENT: AgentPreset = {
    name: "build",
    label: "Build",
    description: "Full-access agent for development work",
    mode: "primary",
    color: "green",
    permissions: {
        bash: "allow", edit: "allow", read: "allow", grep: "allow", glob: "allow",
        webfetch: "allow", websearch: "allow", todowrite: "allow", todoread: "allow", lsp: "allow",
    },
};

const PLAN_AGENT: AgentPreset = {
    name: "plan",
    label: "Plan",
    description: "Read-only agent for analysis and planning",
    mode: "primary",
    color: "blue",
    permissions: {
        bash: "ask", edit: "deny", read: "allow", grep: "allow", glob: "allow",
        webfetch: "allow", websearch: "allow", todowrite: "deny", todoread: "allow", lsp: "allow",
    },
};

const EXPLORE_AGENT: AgentPreset = {
    name: "explore",
    label: "Explore",
    description: "Fast read-only agent for codebase exploration",
    mode: "subagent",
    color: "magenta",
    maxSteps: 20,
    permissions: {
        bash: "deny", edit: "deny", read: "allow", grep: "allow", glob: "allow",
        webfetch: "deny", websearch: "deny", todowrite: "deny", todoread: "deny", lsp: "allow",
    },
};

const GENERAL_AGENT: AgentPreset = {
    name: "general",
    label: "General",
    description: "Full-access subagent for parallel multi-step work",
    mode: "subagent",
    color: "cyan",
    maxSteps: 50,
    permissions: {
        bash: "allow", edit: "allow", read: "allow", grep: "allow", glob: "allow",
        webfetch: "allow", websearch: "allow", todowrite: "deny", todoread: "deny", lsp: "allow",
    },
};

const MULTI_AGENT: AgentPreset = {
    name: "multi",
    label: "Multi",
    description: "Higher Pricing. Orchestrates multiple agents concurrently.",
    mode: "primary",
    color: "yellow",
    permissions: {
        bash: "allow", edit: "allow", read: "allow", grep: "allow", glob: "allow",
        webfetch: "allow", websearch: "allow", todowrite: "allow", todoread: "allow", lsp: "allow",
    },
};

const COMPACTION_AGENT: AgentPreset = {
    name: "compaction",
    label: "Compaction",
    description: "System agent for compacting long context",
    mode: "system",
    color: "gray",
    hidden: true,
    permissions: {
        bash: "deny", edit: "deny", read: "allow", grep: "deny", glob: "deny",
        webfetch: "deny", websearch: "deny", todowrite: "deny", todoread: "deny", lsp: "deny",
    },
};

const TITLE_AGENT: AgentPreset = {
    name: "title",
    label: "Title",
    description: "System agent for generating session titles",
    mode: "system",
    color: "gray",
    hidden: true,
    permissions: {
        bash: "deny", edit: "deny", read: "deny", grep: "deny", glob: "deny",
        webfetch: "deny", websearch: "deny", todowrite: "deny", todoread: "deny", lsp: "deny",
    },
};

const AGENT_PRESETS: Record<string, AgentPreset> = {
    build: BUILD_AGENT,
    plan: PLAN_AGENT,
    explore: EXPLORE_AGENT,
    general: GENERAL_AGENT,
    multi: MULTI_AGENT,
    compaction: COMPACTION_AGENT,
    title: TITLE_AGENT,
};

let activeAgentName = "build";

export function getActiveAgent(): AgentPreset {
    return AGENT_PRESETS[activeAgentName] || BUILD_AGENT;
}

export function getActiveAgentName(): string {
    return activeAgentName;
}

export function switchAgent(name: string): AgentPreset | null {
    const preset = AGENT_PRESETS[name.toLowerCase()];
    if (!preset || preset.hidden) return null;
    activeAgentName = preset.name;
    if (preset.name === "plan") {
        cfg.setPlanningMode(true);
    } else {
        cfg.setPlanningMode(false);
    }
    return preset;
}

/**
 * Toggle between primary agents (build ↔ plan) via Tab key.
 */
export function toggleAgent(): AgentPreset {
    const primaryAgents = Object.values(AGENT_PRESETS).filter((a) => a.mode === "primary");
    const currentIdx = primaryAgents.findIndex((a) => a.name === activeAgentName);
    const next = primaryAgents[(currentIdx + 1) % primaryAgents.length] || BUILD_AGENT;
    return switchAgent(next.name)!;
}

export function isToolAllowed(toolName: string): ToolPermission {
    const agent = getActiveAgent();
    return agent.permissions[toolName] || "allow";
}

/**
 * List all non-hidden agents.
 */
export function listAgents(): AgentPreset[] {
    return Object.values(AGENT_PRESETS).filter((a) => !a.hidden);
}

/**
 * List subagents available for @mention invocation.
 */
export function listSubagents(): AgentPreset[] {
    return Object.values(AGENT_PRESETS).filter((a) => a.mode === "subagent");
}

/**
 * Get a subagent by name for @mention invocation.
 */
export function getSubagent(name: string): AgentPreset | null {
    const agent = AGENT_PRESETS[name.toLowerCase()];
    if (!agent || agent.mode === "system") return null;
    return agent;
}

/**
 * Check if input contains a @mention for a subagent.
 * Returns { agentName, task } if found, null otherwise.
 */
export function parseSubagentMention(input: string): { agentName: string; task: string } | null {
    const match = input.match(/^@(explore|general)\s+(.+)$/is);
    if (!match) return null;
    return { agentName: match[1].toLowerCase(), task: match[2].trim() };
}

/**
 * Get system agent for internal operations.
 */
export function getSystemAgent(name: string): AgentPreset | null {
    const agent = AGENT_PRESETS[name.toLowerCase()];
    if (!agent || agent.mode !== "system") return null;
    return agent;
}
