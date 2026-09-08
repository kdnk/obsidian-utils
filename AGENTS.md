# Repository instructions

## Version control

- Use GitButler (`but`) for version-control operations in this repository.
- Read-only Git commands may be used for inspection.

## Command names

- Write command palette display names in English.
- Use English for preview text, buttons, progress, result summaries, notices, and error messages.

## Obsidian file operations

- Register automatic file-creation handlers after `workspace.onLayoutReady`; vault loading emits `create` events for existing files. Preserve restored note tabs.
- Rename user files through `app.fileManager.renameFile` so Obsidian can update references. Require an explicitly enabled `alwaysUpdateLinks` setting for unattended renames; a missing setting is not enabled.
- A rename can move the file before link updates fail. Report the resulting file path and incomplete link updates when handling errors.

## Releases

- Keep `package.json`, `manifest.json`, and `versions.json` in sync when changing the version.
- Use version tags without a `v` prefix. Attach the built `main.js`, `manifest.json`, and `styles.css` to the GitHub release; the compiled JavaScript is intentionally not committed.
