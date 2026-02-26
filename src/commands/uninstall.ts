import fs from "fs-extra";

import { console } from "../ui/console";
import { appDataDir } from "../app_dirs";
import { registry } from "./registry";


registry.register("/uninstall", "Completely remove all Agent CLI data and session history.", ["/purge"])(async () => {
    console.print("\n[WARNING] This will delete ALL configured providers, api keys, and session memories.");
    const answer = await console.input("Are you sure you want to completely wipe all Agent CLI data? (yes/no): ");

    if (answer.trim().toLowerCase() === "yes") {
        const targetDir = appDataDir();
        try {
            if (fs.existsSync(targetDir)) {
                fs.rmSync(targetDir, { recursive: true, force: true });
                console.print("\n[SUCCESS] Successfully removed all Agent CLI configuration data from: " + targetDir);
                console.print("You may now freely delete the `agent_cli.exe` binary to complete the uninstallation.");
                process.exit(0);
            } else {
                console.print("\n[INFO] No configuration directory found. Uninstallation not needed.");
            }
        } catch (e: any) {
            console.print(`\n[ERROR] Failed to wipe directory: ${String(e)}`);
            console.print(`Attempted to delete: ${targetDir}`);
            console.print("Please manually delete that folder and the executable.");
        }
    } else {
        console.print("\n[INFO] Uninstall aborted.");
    }
    return true;
});
