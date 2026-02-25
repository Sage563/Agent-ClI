const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const RELEASE_DIR = path.join(ROOT, "release");
const BUILD_DIR = path.join(ROOT, "build");
const EXE_NAME = "agent_cli.exe";
const OUTPUT_EXE = path.join(RELEASE_DIR, EXE_NAME);
const SEA_CONFIG = path.join(ROOT, "sea-config.json");
const SEA_PREP = path.join(BUILD_DIR, "sea-prep.blob");

// DISCOVERED FUSE for this Node build: 
function findFuse(nodePath) {
    const buffer = fs.readFileSync(nodePath);
    const text = buffer.toString('binary');
    const regex = /NODE_SEA_FUSE_[a-f0-9]{32}/g;
    const matches = text.match(regex);
    return matches ? matches[0] : null;
}

const SYSTEM_NODE = process.execPath;

function run(cmd) {
    console.log(`> ${cmd}`);
    execSync(cmd, { stdio: "inherit" });
}

async function build() {
    try {
        // 1. Ensure directories
        if (!fs.existsSync(RELEASE_DIR)) fs.mkdirSync(RELEASE_DIR);
        if (!fs.existsSync(BUILD_DIR)) fs.mkdirSync(BUILD_DIR);

        // 2. Bundle with esbuild
        console.log("Bundling with esbuild...");
        run("npm run bundle:exe");

        // 3. Generate SEA blob
        console.log("Generating SEA blob...");
        run(`node --experimental-sea-config ${SEA_CONFIG}`);

        // 4. Copy system node.exe to the output destination
        console.log(`Copying current node.exe from ${SYSTEM_NODE}...`);
        try {
            if (fs.existsSync(OUTPUT_EXE)) {
                fs.rmSync(OUTPUT_EXE, { force: true });
            }
        } catch (e) {
            throw new Error(`Cannot delete existing ${EXE_NAME}. Is the app running or locked by antivirus?`);
        }

        try {
            fs.writeFileSync(OUTPUT_EXE, fs.readFileSync(SYSTEM_NODE));
        } catch (e) {
            throw new Error(`Failed to write to ${OUTPUT_EXE}: ${e.message}`);
        }

        // 5. Detect fuse
        const fuse = findFuse(SYSTEM_NODE);
        if (!fuse) throw new Error("Could not find SEA fuse in " + SYSTEM_NODE);

        // 6. Inject Metadata using rcedit (Must happen BEFORE postject)
        console.log("Injecting metadata...");
        let rcedit = require("rcedit");
        if (typeof rcedit !== "function" && typeof rcedit.rcedit === "function") {
            rcedit = rcedit.rcedit;
        }

        if (typeof rcedit !== "function") throw new Error("rcedit is not a function");

        const year = new Date().getFullYear().toString();
        await rcedit(OUTPUT_EXE, {
            "product-version": "1.5.0",
            "file-version": "1.5.0",
            "icon": path.join(ROOT, "assets", "icon.ico"),
            "version-string": {
                CompanyName: "Agent CLI Open Source Team",
                FileDescription: "Professional Agentic Coding Assistant CLI",
                ProductName: "Agent CLI",
                InternalName: "agent_cli",
                LegalCopyright: `Copyright (c) ${year} Agent CLI Contributors`,
                OriginalFilename: EXE_NAME,
                LegalTrademarks: "Agent CLI is a trademark of the Agent CLI Open Source project.",
                Comments: "Built with Node.js SEA technology for high performance."
            }
        });

        // 7. Inject the blob
        console.log(`Injecting SEA blob with detected fuse: ${fuse}...`);
        const postjectPath = path.join(ROOT, "node_modules", ".bin", "postject.cmd");
        run(`"${postjectPath}" ${OUTPUT_EXE} NODE_SEA_BLOB ${SEA_PREP} --sentinel-fuse ${fuse}`);

        console.log(`\nSUCCESS: Branded SEA binary created at ${OUTPUT_EXE}`);
    } catch (err) {
        console.error(`\nFAILED: ${err.message}`);
        process.exit(1);
    }
}

build();
