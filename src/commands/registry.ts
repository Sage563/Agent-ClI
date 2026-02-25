export type CommandFunc = (inputText: string, args: string[]) => boolean | Promise<boolean>;

class CommandRegistry {
  private commands = new Map<string, { func: CommandFunc; description: string }>();
  private aliases = new Map<string, string>();

  private tokenize(inputText: string) {
    const text = String(inputText || "").trim();
    if (!text) return [] as string[];
    const out: string[] = [];
    let current = "";
    let quote: '"' | "'" | null = null;
    let escape = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (escape) {
        current += ch;
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (quote) {
        if (ch === quote) {
          quote = null;
          continue;
        }
        current += ch;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch as '"' | "'";
        continue;
      }
      if (/\s/.test(ch)) {
        if (current) {
          out.push(current);
          current = "";
        }
        continue;
      }
      current += ch;
    }
    if (current) out.push(current);
    return out;
  }

  register(name: string, description: string, aliases?: string[]) {
    return (func: CommandFunc) => {
      this.commands.set(name, { func, description });
      for (const alias of aliases || []) {
        this.aliases.set(alias, name);
      }
      return func;
    };
  }

  private getCommand(name: string) {
    if (this.commands.has(name)) return this.commands.get(name);
    const aliasTarget = this.aliases.get(name);
    if (aliasTarget) return this.commands.get(aliasTarget);
    return undefined;
  }

  async execute(inputText: string) {
    const parts = this.tokenize(inputText);
    if (!parts.length) return false;
    const cmdName = parts[0].toLowerCase();
    const cmd = this.getCommand(cmdName);
    if (!cmd) return false;
    return cmd.func(inputText, parts);
  }

  hasCommand(name: string) {
    const cmdName = String(name || "").toLowerCase();
    return Boolean(this.getCommand(cmdName));
  }

  listCommands(): Array<[string, string]> {
    return [...this.commands.entries()].map(([name, data]) => [name, data.description]);
  }

  listAliases(): Array<[string, string]> {
    return [...this.aliases.entries()];
  }

  suggestCommands(input: string, limit = 6): string[] {
    const key = String(input || "").trim().toLowerCase();
    if (!key) return [];
    const known = new Set<string>();
    for (const [name] of this.listCommands()) known.add(name);
    for (const [alias] of this.listAliases()) known.add(alias);

    const score = (candidate: string) => {
      const c = candidate.toLowerCase();
      if (c === key) return 10_000;
      if (c.startsWith(key)) return 5_000 - c.length;
      if (c.includes(key)) return 3_000 - c.length;
      let overlap = 0;
      for (const ch of key) if (c.includes(ch)) overlap += 1;
      return overlap;
    };

    return [...known]
      .map((candidate) => ({ candidate, s: score(candidate) }))
      .filter((row) => row.s > 0)
      .sort((a, b) => b.s - a.s || a.candidate.localeCompare(b.candidate))
      .slice(0, Math.max(1, limit))
      .map((row) => row.candidate);
  }
}

export const registry = new CommandRegistry();
