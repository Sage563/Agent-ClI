import fs from "fs-extra";
import path from "path";
import { registry } from "./registry";
import { printError, printInfo, printPanel, printSuccess } from "../ui/console";
import { getActiveSessionName, load } from "../memory";

registry.register("/share", "Export the current session as a shareable markdown or JSON file", ["/export"])(async (_, args) => {
    const format = (args[1] || "md").toLowerCase();
    const data = load();
    const session = data.session || [];
    const sessionName = getActiveSessionName();

    if (!session.length) {
        printError("No session history to export.");
        return true;
    }

    if (format === "json") {
        const outPath = path.resolve(process.cwd(), `${sessionName}_session.json`);
        fs.writeJsonSync(outPath, {
            name: sessionName,
            exported_at: new Date().toISOString(),
            turns: session.length,
            messages: session,
        }, { spaces: 2 });
        printSuccess(`Session exported to: ${outPath}`);
        return true;
    }

    // Default: Markdown
    const lines: string[] = [
        `# Session: ${sessionName}`,
        `> Exported at ${new Date().toISOString()}`,
        `> ${session.length} messages`,
        "",
    ];

    for (const msg of session) {
        const role = String(msg.role || "unknown").toUpperCase();
        const content = typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content, null, 2);
        const time = msg.time ? new Date(msg.time * 1000).toLocaleTimeString() : "";
        lines.push(`## ${role}${time ? ` (${time})` : ""}`);
        lines.push("");
        lines.push(content);
        lines.push("");
        lines.push("---");
        lines.push("");
    }

    const outPath = path.resolve(process.cwd(), `${sessionName}_session.md`);
    fs.writeFileSync(outPath, lines.join("\n"), "utf8");
    printSuccess(`Session exported to: ${outPath}`);
    return true;
});

export function registerShare() {
    return true;
}
