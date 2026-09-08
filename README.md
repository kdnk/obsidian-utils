# Obsidian Utils

Small editing utilities and automatic filename compatibility repair for Obsidian.
The plugin supports desktop and mobile.

## Safe filenames

While the plugin is enabled, newly created or renamed notes, attachments, and
folders are automatically given names suitable for syncing across macOS, Android,
and Windows. No character-by-character configuration is required.

Enable **Settings → Files and links → Automatically update internal links** first.
If this setting is off or cannot be verified, the plugin stops without renaming.
It uses Obsidian's `FileManager.renameFile` to update existing links and image
references, and does not change that setting itself.
Only references that Obsidian already resolves are updated. For example, a
Markdown link containing `%3F` instead of a literal `?` may already be unresolved
before a rename; this plugin does not repair those broken references.

For existing files, run **Utils: Check and fix filename compatibility** from
the command palette. Review the before/after paths, then click **Fix all N**.
The preview is paginated; the button applies every listed change, including other
pages. Closing a preview makes no changes. Closing a running batch stops it after
the current operation; already completed renames remain applied.

### Common rules

| Input | Result |
| --- | --- |
| Filesystem-reserved symbols (`<`, `>`, `:`, `"`, `/`, `\`, pipe, `?`, `*`), ASCII control characters, DEL | Replace each with `_` |
| Obsidian link delimiters (`#`, `^`, `[`, `]`) | Replace with `_` |
| Emoji, including joined emoji, flags and modifiers | Replace with `_` |
| Dots in the filename stem or in folder names | Replace with `_`; keep the final file extension |
| Leading/trailing whitespace or dots | Remove |
| Windows device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, including superscript 1/2/3) | Prefix with `_` |
| Long names | Shorten the stem to fit 255 UTF-8 bytes, including extension and collision suffix |
| Existing equivalent name | Add ` (2)`, ` (3)`, etc. before the final extension |
| Japanese, letters, digits, internal spaces, hyphens and underscores | Keep, subject to the byte limit |

Examples:

```text
What Is an AI Anyway?  Mustafa Suleyman  TED.md
→ What Is an AI Anyway_  Mustafa Suleyman  TED.md

attachments/1*image.png
→ attachments/1_image.png

写真📷.2026.09.png
→ 写真__2026_09.png
```

Collision checks include both files and folders, case differences, Unicode
normalization variants and uppercase expansions such as `ß`/`SS`. Existing names
are reserved before assigning replacements. Only the final extension is kept
unchanged when already safe: `archive.tar.gz` becomes `archive_tar.gz`.
If an extension leaves insufficient room for a safe name, the item is reported
for manual attention rather than changing its file type.

### Automatic repair and limits

- Monitoring starts after the workspace has loaded, so opening a vault does not
  sweep existing files or change restored note tabs. Use the command for old files.
- Repair waits for one second without file/metadata activity, to allow importers
  to finish creating attachments and their references. Incoming Sync creations
  and renames are handled like other vault events.
- Files and folders beginning with `.` are excluded, along with the configured
  Obsidian settings directory and any ancestor that would move it.
- Operations run sequentially, with children renamed before their folders.
  Targets are checked again on disk before each rename. If a file has moved, a
  collision appears, or an operation fails, the batch stops and reports completed
  changes. Rescan to get an updated plan.
- If a file moves successfully but updating links fails, the result explicitly
  reports that the name changed and that its references need checking.
- This is filename repair, not a Sync replacement. It cannot change a remote file
  that has not downloaded to the current device; run the bulk command on the Mac
  where the file exists. It does not solve Sync size limits, permissions, or
  references outside Obsidian. A plugin that writes a reference to an old path
  after the quiet period can still require its own import coordination.

The rules follow [Obsidian Sync's filename guidance](https://obsidian.md/help/sync/messages),
[Android's filename implementation](https://android.googlesource.com/platform/packages/providers/MediaProvider/+/refs/heads/main/src/com/android/providers/media/util/FileUtils.java),
and [Apple's APFS filename behavior](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/FAQ/FAQ.html).
Extra dots and emoji are handled conservatively because Obsidian documents
problems with them on some Android devices.

## Editor commands

- Indent More / Indent Less
- swap line up / swap line down

## Development

Use Node.js 22 or newer for development and the Node test runner.

```sh
npm install
npm test
npm run build
```

`npm run dev` rebuilds when source files change. Tests cover the reported note and
image names, Unicode/length/collision rules, nested folders, background events,
startup preservation, stale previews, cancellation and partial failures.
Obsidian APIs are replaced at the test boundary; Sync on a physical Android
phone is not exercised by these tests.
An isolated Obsidian desktop vault was also used to verify the bulk preview,
automatic note/image/folder renames, and updates to resolved wikilinks and Markdown
links without changing the user's vault.

## Install a local build

Copy `main.js`, `manifest.json`, and `styles.css` into your vault's
`.obsidian/plugins/utils/` directory, then enable or reload **Utils** in Obsidian.
The generated `main.js` is excluded from version control.
