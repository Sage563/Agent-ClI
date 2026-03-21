import { registry } from "./registry";
import { cfg, KNOWN_MODELS } from "../config";
import { BUILTIN_PROVIDERS, getProviderLabel } from "../providers/catalog";
import { getProvider } from "../providers/manager";
import { printError, printInfo, printPanel, printSuccess, printWarning } from "../ui/console";
import inquirer from "inquirer";

registry.register("/connect", "Interactive provider setup — choose a provider, enter API key, and validate", ["/auth"])(async () => {
    const choices: Array<{ name: string; value: string }> = BUILTIN_PROVIDERS
        .filter((p): p is Exclude<typeof p, "ollama"> => p !== "ollama") // Ollama doesn't need API keys
        .map((p) => ({ name: `${getProviderLabel(p)} (${p})`, value: p as string }));
    choices.unshift({ name: `${getProviderLabel("ollama")} (ollama) — No API key needed`, value: "ollama" });

    printPanel(
        "Connect to an AI provider. Select a provider, enter your API key, and we'll validate it.",
        "Provider Setup",
        "cyan",
        true,
    );

    const { provider } = await inquirer.prompt([
        {
            type: "list",
            name: "provider",
            message: "Select a provider:",
            choices,
            pageSize: 12,
        },
    ]);

    if (provider === "ollama") {
        cfg.setActiveProvider("ollama");
        printSuccess("Active provider set to Ollama (local). No API key required.");
        const models = KNOWN_MODELS.ollama || [];
        if (models.length) {
            printInfo(`Available models (configure with /model): ${models.join(", ")}`);
        } else {
            printInfo("Run `ollama list` to see your locally installed models, then use /model to set one.");
        }
        return true;
    }

    // Ask for API key
    const { apiKey } = await inquirer.prompt([
        {
            type: "password",
            name: "apiKey",
            message: `Enter your ${getProviderLabel(provider)} API key:`,
            mask: "•",
            validate: (input: string) => (input.trim().length > 0 ? true : "API key cannot be empty."),
        },
    ]);

    // Store the key
    cfg.setApiKey(provider, apiKey.trim());
    cfg.setActiveProvider(provider);
    printInfo(`API key stored for ${getProviderLabel(provider)}. Validating...`);

    // Validate
    try {
        const prov = await getProvider(provider);
        const result = await prov.validate();
        if (result.ok) {
            printSuccess(`✓ ${result.message}`);
        } else {
            printWarning(`Validation warning: ${result.message}`);
            printInfo("The key has been saved. You can try sending a message to test it.");
        }
    } catch (error) {
        printWarning(`Could not validate key: ${String(error)}`);
        printInfo("The key has been saved anyway. Try sending a message to test it.");
    }

    // Suggest models
    const models = KNOWN_MODELS[provider] || [];
    const currentModel = cfg.getModel(provider);
    if (models.length) {
        printInfo(`\nAvailable models for ${getProviderLabel(provider)}:`);
        for (const m of models) {
            const marker = m === currentModel ? " ← current" : "";
            printInfo(`  • ${m}${marker}`);
        }
        if (!models.includes(currentModel) || currentModel === "unknown") {
            cfg.setModel(provider, models[0]);
            printSuccess(`Default model set to: ${models[0]}`);
        }
    }

    printSuccess(`\n✓ Provider ${getProviderLabel(provider)} is now active. Start chatting!`);
    return true;
});

export function registerConnect() {
    return true;
}
