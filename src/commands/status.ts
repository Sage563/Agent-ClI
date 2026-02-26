import { registry } from "./registry";
import { cfg } from "../config";
import { getProvider } from "../providers/manager";
import { printInfo, printSuccess, printError } from "../ui/console";

registry.register("/status", "Check connectivity to the active AI provider")(async () => {
    const providerName = cfg.getActiveProvider();
    const model = cfg.getModel(providerName);

    printInfo(`Checking status for provider: ${providerName} (model: ${model})...`);

    try {
        const provider = await getProvider(providerName);
        if (!provider.validate) {
            printInfo("Provider does not support direct validation, attempting a simple ping...");
            // Fallback check if validate is not implemented
            printInfo("Status check not fully implemented for this provider.");
            return true;
        }

        const result = await provider.validate();
        if (result.ok) {
            printSuccess(`[ONLINE] ${result.message}`);
        } else {
            printError(`[OFFLINE] ${result.message}`);
        }
    } catch (error) {
        printError(`Failed to check provider status: ${String(error)}`);
    }

    return true;
});
