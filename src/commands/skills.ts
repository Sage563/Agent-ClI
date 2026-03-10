import fs from "fs-extra";
import path from "path";
import { registry } from "./registry";
import { printError, printInfo, printPanel, printSuccess, printWarning } from "../ui/console";

const SKILLS_ROOT = path.resolve(process.cwd(), ".agent", "skills");

function normalizeSkillName(raw: string) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function skillTemplate(name: string) {
  return [
    "---",
    `name: ${name}`,
    `description: Purpose-built workflow for ${name}. Trigger when users ask for ${name}-specific tasks.`,
    "---",
    "",
    `# ${name}`,
    "",
    "Use this skill to execute the workflow reliably.",
    "",
    "## Workflow",
    "1. Confirm the user goal and constraints.",
    "2. Identify required files and dependencies.",
    "3. Execute changes with tests and verification.",
    "4. Summarize outcomes and next steps.",
    "",
    "## References",
    "- Add task-specific references in references/.",
    "",
    "## Scripts",
    "- Add deterministic helpers in scripts/ when repetition is high.",
    "",
    "## Assets",
    "- Add reusable templates or starter files in assets/.",
    "",
  ].join("\n");
}

function openAiYamlTemplate(name: string) {
  const title = name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return [
    "version: 1",
    "interface:",
    `  display_name: ${title}`,
    `  short_description: ${title} workflow skill`,
    `  default_prompt: Use the ${title} skill workflow for this task.`,
    "",
  ].join("\n");
}

function ensureSkillScaffold(name: string) {
  const skillDir = path.join(SKILLS_ROOT, name);
  if (fs.existsSync(skillDir)) {
    throw new Error(`Skill already exists: ${name}`);
  }
  fs.ensureDirSync(path.join(skillDir, "agents"));
  fs.ensureDirSync(path.join(skillDir, "references"));
  fs.ensureDirSync(path.join(skillDir, "scripts"));
  fs.ensureDirSync(path.join(skillDir, "assets"));
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), skillTemplate(name), "utf8");
  fs.writeFileSync(path.join(skillDir, "agents", "openai.yaml"), openAiYamlTemplate(name), "utf8");
  return skillDir;
}

registry.register("/skills", "Manage local CLI skills. Usage: /skills [list|init|where]")((_, args) => {
  const action = String(args[1] || "list").toLowerCase();

  if (action === "where") {
    printPanel(`Skills directory:\n\`${SKILLS_ROOT}\``, "Skills Path", "cyan", true);
    return true;
  }

  if (action === "init") {
    const rawName = args[2] || "";
    const name = normalizeSkillName(rawName);
    if (!name) {
      printError("Usage: /skills init <skill-name>");
      return true;
    }
    if (name.length > 64) {
      printError("Skill name must be <= 64 characters.");
      return true;
    }
    try {
      const skillDir = ensureSkillScaffold(name);
      printSuccess(`Created skill scaffold: ${skillDir}`);
      printInfo("Edit SKILL.md and references/scripts as needed.");
    } catch (error) {
      printError(String(error));
    }
    return true;
  }

  if (action !== "list") {
    printWarning("Usage: /skills [list|init|where]");
    return true;
  }

  fs.ensureDirSync(SKILLS_ROOT);
  const dirs = fs
    .readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (!dirs.length) {
    printPanel(
      [
        "No local skills found.",
        "",
        "Create one:",
        "- /skills init my-skill",
      ].join("\n"),
      "Skills",
      "yellow",
      true,
    );
    return true;
  }

  const lines = dirs.map((name) => `- ${name}`);
  printPanel(lines.join("\n"), `Local Skills (${dirs.length})`, "cyan", true);
  return true;
});

export function registerSkills() {
  return true;
}