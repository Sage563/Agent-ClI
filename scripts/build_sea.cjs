const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const RELEASE_DIR = path.join(ROOT, "release");
const BUILD_DIR = path.join(ROOT, "build");
const EXE_NAME = "agent_cli.exe";
const OUTPUT_EXE = path.join(RELEASE_DIR, EXE_NAME);
const EXE_BASE = path.basename(EXE_NAME, ".exe");
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

async function loadRcedit() {
    try {
        const mod = await import("rcedit");
        const fn = mod.default || mod.rcedit || mod;
        if (typeof fn === "function") return fn;
    } catch {
        // fall through to require path below
    }

    try {
        let mod = require("rcedit");
        mod = mod.default || mod.rcedit || mod;
        if (typeof mod === "function") return mod;
    } catch {
        // handled by final throw
    }

    throw new Error("Unable to load rcedit module.");
}

async function tryInjectMetadata(exePath) {
    console.log("Injecting metadata...");
    const year = new Date().getFullYear().toString();
    const iconPath = path.join(ROOT, "assets", "icon.ico");
    const options = {
        "product-version": "1.5.0",
        "file-version": "1.5.0",
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
    };
    if (fs.existsSync(iconPath)) {
        options.icon = iconPath;
    }

    try {
        const rcedit = await loadRcedit();
        await rcedit(exePath, options);
        console.log("Metadata injected.");
    } catch (error) {
        const msg = error && error.message ? error.message : String(error);
        console.warn(`Metadata injection skipped: ${msg}`);
    }
}

function safeRemove(filePath) {
    try {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
        return true;
    } catch {
        return false;
    }
}

function timestampTag() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function safeRenameOrCopy(sourcePath, preferredTargetPath) {
    const candidates = [preferredTargetPath];
    candidates.push(path.join(RELEASE_DIR, `${EXE_BASE}-${timestampTag()}.exe`));

    for (const targetPath of candidates) {
        if (path.resolve(sourcePath) === path.resolve(targetPath)) return targetPath;
        if (!safeRemove(targetPath) && fs.existsSync(targetPath)) continue;
        try {
            fs.renameSync(sourcePath, targetPath);
            return targetPath;
        } catch {
            try {
                fs.copyFileSync(sourcePath, targetPath);
                safeRemove(sourcePath);
                return targetPath;
            } catch {
                // try next candidate
            }
        }
    }

    throw new Error(
        `Could not write output executable (file may be locked). Close running agent_cli.exe instances and retry.`,
    );
}

function ensureSeaInjected(exePath) {
    const buf = fs.readFileSync(exePath);
    const marker = Buffer.from("NODE_SEA_BLOB");
    if (!buf.includes(marker)) {
        throw new Error(`SEA injection marker missing in ${path.basename(exePath)}. Build output would behave like plain node.exe.`);
    }
}

async function build() {
    const tempExe = path.join(BUILD_DIR, `${EXE_BASE}.tmp.exe`);
    let finalExe = OUTPUT_EXE;
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

        // 4. Copy system node.exe to a temp destination (atomic publish later)
        console.log(`Copying current node.exe from ${SYSTEM_NODE}...`);
        safeRemove(tempExe);
        fs.copyFileSync(SYSTEM_NODE, tempExe);

        // 5. Detect fuse
        const fuse = findFuse(SYSTEM_NODE);
        if (!fuse) throw new Error("Could not find SEA fuse in " + SYSTEM_NODE);

        // 6. Inject metadata when supported (non-blocking)
        await tryInjectMetadata(tempExe);

        // 7. Inject the blob
        console.log(`Injecting SEA blob with detected fuse: ${fuse}...`);
        const postjectPath = path.join(ROOT, "node_modules", ".bin", "postject.cmd");
        run(`"${postjectPath}" "${tempExe}" NODE_SEA_BLOB "${SEA_PREP}" --sentinel-fuse ${fuse}`);

        ensureSeaInjected(tempExe);
        finalExe = safeRenameOrCopy(tempExe, OUTPUT_EXE);

        console.log(`\nSUCCESS: Branded SEA binary created at ${finalExe}`);
        if (path.resolve(finalExe) !== path.resolve(OUTPUT_EXE)) {
            console.warn(`NOTE: ${EXE_NAME} was locked. Wrote fallback output: ${path.basename(finalExe)}`);
        }
    } catch (err) {
        safeRemove(tempExe);
        console.error(`\nFAILED: ${err.message}`);
        process.exit(1);
    }
}

build();
