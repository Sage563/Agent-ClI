const fs = require("fs-extra");
const os = require("os");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const nodeModulesDir = path.join(projectRoot, "node_modules");
const packageJsonPath = path.join(projectRoot, "package.json");
const pkg = fs.readJsonSync(packageJsonPath);

const extBaseDir = path.join(os.homedir(), ".vscode", "extensions");
const extensionDirName = `${pkg.publisher}.${pkg.name}-${pkg.version}`;
const extensionDir = path.join(extBaseDir, extensionDirName);

function deploy() {
  try {
    console.log(`Deploying compiled extension to ${extensionDir} ...`);

    fs.ensureDirSync(extBaseDir);
    fs.removeSync(extensionDir);
    fs.ensureDirSync(extensionDir);

    fs.copySync(distDir, path.join(extensionDir, "dist"));
    fs.copySync(path.join(projectRoot, "src", "webview"), path.join(extensionDir, "dist", "webview"));
    fs.copySync(path.join(projectRoot, "assets"), path.join(extensionDir, "assets"));
    if (fs.existsSync(nodeModulesDir)) {
      fs.copySync(nodeModulesDir, path.join(extensionDir, "node_modules"));
    }
    fs.copyFileSync(packageJsonPath, path.join(extensionDir, "package.json"));

    const readmePath = path.join(projectRoot, "README.md");
    if (fs.existsSync(readmePath)) {
      fs.copyFileSync(readmePath, path.join(extensionDir, "README.md"));
    }

    console.log("Successfully deployed extension.");
  } catch (err) {
    console.error("Deployment failed:", err);
    process.exit(1);
  }
}

deploy();
