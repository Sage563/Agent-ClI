import { startChat } from "../chat";
import { registry } from "./registry";

registry.register("/chat", "Start interactive chat mode")((_) => {
  startChat();
  return true;
});

export function registerChat() {
  return true;
}
