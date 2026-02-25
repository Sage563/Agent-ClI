import fs from "fs-extra";
import path from "path";
import { registry } from "./registry";
import { printError, printInfo, printSuccess } from "../ui/console";

const TECH_SIGNATURES: Record<string, string> = {
  "package.json": "Node.js",
  "requirements.txt": "Python",
  Pipfile: "Python (Pipenv)",
  "pyproject.toml": "Python (Poetry/PEP 517)",
  "Cargo.toml": "Rust",
  "go.mod": "Go",
  "pom.xml": "Java (Maven)",
  "build.gradle": "Java (Gradle)",
  Gemfile: "Ruby",
  "composer.json": "PHP",
  "CMakeLists.txt": "C/C++ (CMake)",
  Makefile: "Make",
  Dockerfile: "Docker",
  "docker-compose.yml": "Docker Compose",
  ".env": "Environment Variables",
  "tsconfig.json": "TypeScript",
  "vite.config.ts": "Vite",
  "next.config.js": "Next.js",
  "webpack.config.js": "Webpack",
  ".eslintrc.json": "ESLint",
  ".prettierrc": "Prettier",
  "jest.config.js": "Jest",
  "pytest.ini": "Pytest",
  "setup.py": "Python (setuptools)",
};

const IGNORE_DIRS = new Set([".git", "venv", "node_modules", "__pycache__", ".vscode", "dist", "build", ".pytest_cache", ".mypy_cache"]);

registry.register("/init", "Analyze project and generate AGENTS.md")(async () => {
  const agentsPath = path.resolve(process.cwd(), "AGENTS.md");
  if (fs.existsSync(agentsPath)) {
    printInfo("AGENTS.md already exists. Overwrite? (y/n)");
    const answer = (await (await import("../ui/console")).console.input("> ")).trim().toLowerCase();
    if (answer !== "y") {
      printInfo("Aborted.");
      return true;
    }
  }

  printInfo("Scanning project...");
  const detectedTech = Object.entries(TECH_SIGNATURES)
    .filter(([sig]) => fs.existsSync(path.resolve(process.cwd(), sig)))
    .map(([, tech]) => tech);

  const structureLines: string[] = [];
  const walk = (current: string, depth: number) => {
    if (depth > 2) return;
    const folder = path.basename(current) || ".";
    const indent = "  ".repeat(depth);
    structureLines.push(`${indent}${folder}/`);
    const entries = fs.readdirSync(current, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).slice(0, 10);
    files.forEach((f) => structureLines.push(`${indent}  ${f.name}`));
    const count = entries.filter((e) => e.isFile()).length;
    if (count > 10) structureLines.push(`${indent}  ... (+${count - 10} more)`);
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".") && !IGNORE_DIRS.has(e.name));
    dirs.forEach((d) => walk(path.join(current, d.name), depth + 1));
  };
  walk(process.cwd(), 0);

  const entryPoints = ["main.py", "app.py", "index.js", "index.ts", "src/main.py", "src/index.js", "src/main.ts"].filter((p) =>
    fs.existsSync(path.resolve(process.cwd(), p)),
  );
  const commands: string[] = [];
  if (fs.existsSync("package.json")) commands.push("npm install / npm run dev");
  if (fs.existsSync("requirements.txt")) commands.push("pip install -r requirements.txt");
  if (fs.existsSync("Makefile")) commands.push("make");
  if (fs.existsSync("Dockerfile")) commands.push("docker build -t app .");

  let content = "# Project Instructions\n\n";
  content += "This file is automatically read by Agent CLI to understand your project.\n";
  content += "Edit it to customize the agent's behavior for this project.\n\n";
  content += "## Tech Stack\n";
  if (detectedTech.length) detectedTech.forEach((tech) => (content += `- ${tech}\n`));
  else content += "- (no frameworks detected, add manually)\n";
  content += "\n## Project Structure\n```\n";
  content += structureLines.slice(0, 40).join("\n");
  content += "\n```\n\n";
  if (entryPoints.length) {
    content += "## Entry Points\n";
    entryPoints.forEach((ep) => (content += `- \`${ep}\`\n`));
    content += "\n";
  }
  if (commands.length) {
    content += "## Build & Run\n";
    commands.forEach((cmd) => (content += `- \`${cmd}\`\n`));
    content += "\n";
  }
  content += "## Conventions\n- (Add your coding style, naming conventions, and rules here)\n\n";
  content += "## Important Notes\n- (Add any project-specific notes, gotchas, or context here)\n";

  try {
    fs.writeFileSync(agentsPath, content, "utf8");
    printSuccess(`Generated AGENTS.md (${content.length} bytes)`);
    printInfo("Edit AGENTS.md to add your project conventions and rules.");
  } catch (error) {
    printError(String(error));
  }
  return true;
});

export function registerInit() {
  return true;
}
