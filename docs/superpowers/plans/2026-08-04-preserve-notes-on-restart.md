# Preserve Notes on Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the plugin from closing restored notes when Obsidian starts.

**Architecture:** Remove the layout-ready callback that invokes Obsidian's internal tab-closing command and remove its unused platform dependency. Bundle the real plugin entry point against a controlled Obsidian API substitute, then load it and observe its callback and command registrations so the startup side effect cannot be reintroduced accidentally.

**Tech Stack:** TypeScript 4.7, Obsidian plugin API, Node.js assertion API, npm scripts, esbuild

## Global Constraints

- Let Obsidian restore saved notes and tabs without plugin intervention.
- Keep the existing indent and line-swap commands unchanged.
- Do not add settings or a replacement tab-cleanup command.
- Use GitButler (`but`) for version-control writes.

---

### Task 1: Remove startup tab cleanup with a regression test

**Files:**
- Create: `tests/preserve-workspace.test.mjs`
- Modify: `package.json`
- Modify: `main.ts`

**Interfaces:**
- Consumes: the plugin entry point in `main.ts` and the existing `npm run build` command
- Produces: an `npm test` command that loads the plugin and verifies startup cleanup is absent while the command registrations remain present

- [ ] **Step 1: Write the failing plugin-loading test**

Create `tests/preserve-workspace.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const obsidianApiStub = {
	name: "obsidian-api-stub",
	setup(builder) {
		builder.onResolve({ filter: /^obsidian$/ }, () => ({
			path: "obsidian",
			namespace: "obsidian-api-stub",
		}));
		builder.onLoad(
			{ filter: /.*/, namespace: "obsidian-api-stub" },
			() => ({
				loader: "js",
				contents: `
					export class Plugin {
						constructor(app) {
							this.app = app;
							this.registeredCommands = [];
						}
						addCommand(command) {
							this.registeredCommands.push(command);
						}
					}
					export const Platform = {
						isMobile: false,
						isMobileApp: false,
					};
				`,
			}),
		);
	},
};

const { outputFiles } = await build({
	entryPoints: [fileURLToPath(new URL("../main.ts", import.meta.url))],
	bundle: true,
	format: "cjs",
	platform: "node",
	plugins: [obsidianApiStub],
	write: false,
});

const pluginModule = { exports: {} };
const loadPlugin = new Function(
	"module",
	"exports",
	"require",
	outputFiles[0].text,
);
loadPlugin(
	pluginModule,
	pluginModule.exports,
	createRequire(import.meta.url),
);

const layoutReadyCallbacks = [];
const app = {
	workspace: {
		onLayoutReady(callback) {
			layoutReadyCallbacks.push(callback);
		},
	},
};

const UtilsPlugin = pluginModule.exports.default;
const plugin = new UtilsPlugin(app, {});
await plugin.onload();

assert.equal(
	layoutReadyCallbacks.length,
	0,
	"plugin startup must not register a layout-ready callback that changes tabs",
);

assert.deepEqual(
	plugin.registeredCommands.map(({ id }) => id),
	["indent-more", "indent-less", "swap-line-up", "swap-line-down"],
	"existing editor commands must remain registered",
);
```

Add the test script to `package.json`:

```json
"scripts": {
	"dev": "node esbuild.config.mjs",
	"build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
	"test": "node tests/preserve-workspace.test.mjs",
	"version": "node version-bump.mjs && git add manifest.json versions.json"
}
```

- [ ] **Step 2: Run the regression test and verify that it fails**

Run: `npm test`

Expected: FAIL because plugin loading registers one layout-ready callback instead of zero.

- [ ] **Step 3: Remove the startup side effect**

Change the import at the top of `main.ts` to:

```typescript
import { App, Editor, Plugin, PluginManifest } from "obsidian";
```

Delete the complete callback beginning with:

```typescript
this.app.workspace.onLayoutReady(() => {
```

and ending with its matching:

```typescript
});
```

Do not change the four existing `addCommand` calls.

- [ ] **Step 4: Run the focused regression test**

Run: `npm test`

Expected: PASS with exit code 0 and no assertion output.

- [ ] **Step 5: Run the production build**

Run: `npm run build`

Expected: PASS with exit code 0 after TypeScript type checking and the production esbuild run.

- [ ] **Step 6: Inspect the final diff**

Run: `but diff`

Expected: the diff contains the plugin-loading regression test, the `test` script, removal of the `Platform` import, and removal of the `onLayoutReady` callback only.

- [ ] **Step 7: Commit the implementation**

Run:

```text
but commit -b fix/preserve-notes-on-restart -m "fix: preserve notes across Obsidian restarts

Why:
- The plugin closes restored tabs whenever its layout-ready callback runs.
- Obsidian should retain control of workspace restoration.

What:
- Remove the startup callback that invokes the internal tab-closing command.
- Remove the unused Platform import.
- Add a plugin-loading regression test for startup behavior and editor command preservation."
```
