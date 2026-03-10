# VSCODE AGENTS.md

## Scope

These instructions apply to the VS Code extension under `VSCODE/`.

## Priorities

- Keep the webview responsive and avoid blocking UI loops.
- Preserve command parity with CLI where practical.
- Prefer minimal UI changes that improve clarity and discoverability.

## UI Guidelines

- Keep toolbar actions concise and keyboard-friendly.
- Maintain readable contrast across VS Code themes.
- Favor small, meaningful animations over constant motion.

## Webview Safety

- Keep message handling strict (`type`-based switch).
- Validate payload fields before use.
- Avoid injecting unsanitized HTML from user content.

## Validation

- Run `npm run compile` in `VSCODE/` after TypeScript edits.
- Ensure webview actions still support file attach, image attach, stop, and mode toggles.

## Docs

- Reflect user-visible changes in `VSCODE/README.md`.
- Keep feature naming aligned with CLI (`/assist`, skills, AGENTS.md guidance).