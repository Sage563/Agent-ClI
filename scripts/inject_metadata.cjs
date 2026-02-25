const rcedit = require("rcedit").rcedit;
const path = require("path");
const fs = require("fs");

const ROOT = process.cwd();
const EXE_PATH = path.join(ROOT, "release", "agent_cli.exe");

async function inject() {
    console.log(`Injecting metadata into ${EXE_PATH}...`);

    if (!fs.existsSync(EXE_PATH)) {
        console.error("Binary not found at " + EXE_PATH);
        process.exit(1);
    }

    try {
        const year = new Date().getFullYear().toString();
        await rcedit(EXE_PATH, {
            "product-version": "1.5.0",
            "file-version": "1.5.0",
            "version-string": {
                CompanyName: "Agent CLI Open Source Team",
                FileDescription: "Professional Agentic Coding Assistant CLI",
                ProductName: "Agent CLI",
                InternalName: "agent_cli",
                LegalCopyright: `Copyright (c) ${year} Agent CLI Contributors`,
                OriginalFilename: "agent_cli.exe",
                LegalTrademarks: "Agent CLI is a trademark of the Agent CLI Open Source project.",
                Comments: "Built with Node.js SEA technology for high performance."
            }
        });
        console.log("Metadata injected successfully!");
    } catch (err) {
        console.error("Failed to inject metadata: " + err.message);
        process.exit(1);
    }
}

inject();
