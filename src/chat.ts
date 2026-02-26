import readline from "readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { handle } from "./core/agent";
import { readSession, writeSession } from "./memory";

export async function startChat() {
  const rl = readline.createInterface({ input, output });
  console.log("Starting interactive chat. Type /exit to quit, /help for commands.");
  const previous = (readSession("last_chat") || {}) as Record<string, unknown>;
  const previousMessages = Array.isArray(previous.messages)
    ? (previous.messages as Array<{ role: string; text: string }>)
    : [];
  const messages: { role: string; text: string }[] = [...previousMessages];
  if (previousMessages.length) {
    console.log(`Loaded previous chat: ${previousMessages.length} message(s).`);
  }

  const persist = () =>
    writeSession("last_chat", {
      messages,
      updated: new Date().toISOString(),
    });

  while (true) {
    const line = await rl.question("You> ");
    if (!line) continue;
    if (line.trim() === "/exit") break;
    if (line.trim() === "/help") {
      console.log("Commands: /exit, /help, /save <name>");
      continue;
    }

    if (line.startsWith("/save ")) {
      const name = line.slice(6).trim() || `session-${Date.now()}`;
      writeSession(name, { messages });
      console.log("Saved session", name);
      continue;
    }

    messages.push({ role: "user", text: line });
    try {
      const result = await handle(line, { yes: false, fast: false, plan: false });
      messages.push({ role: "ai", text: String((result as any)?.response || "") });
      persist();
    } catch (error) {
      console.error("AI error:", error);
      persist();
    }
  }

  persist();
  console.log("Chat saved to session: last_chat");
}
