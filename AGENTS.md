# AGENTS.md

## Scope

These instructions apply to the whole repository.

## Project layout

- `src/`: CLI runtime and core agent logic
- `src/commands/`: slash command implementations
- `src/core/`: orchestration, tools, planning, execution
- `src/ui/`: terminal rendering and interactive UI
- `src/tests/`: unit tests
- `VSCODE/`: VS Code extension implementation
- `docs/`: architecture and troubleshooting notes

## Engineering rules

- Keep edits minimal and focused on user-facing behavior.
- Preserve backward compatibility for existing slash commands.
- Prefer `rg` for search and fast file discovery.
- Avoid destructive operations unless explicitly requested.
- When adding commands, include help text updates in `src/commands/core.ts`.

## CLI UX expectations

- Maintain clear terminal output with concise panels and status lines.
- Keep interactive flows non-blocking where possible.
- New command UX should be discoverable through `/help` and `/commands`.

## Testing and verification

- Run `npm test` after behavior changes.
- Run `npm run build` after TypeScript edits.
- If tests fail due unrelated existing issues, report exact failures.

## Release notes policy

- Document user-visible changes in `README.md`.
- Mention any new slash commands and config flags.