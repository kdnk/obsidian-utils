import assert from "node:assert/strict";
import { loadModule, fakeApp } from "./helpers.mjs";

const { default: UtilsPlugin } = await loadModule("../main.ts");
const { app } = fakeApp();
const plugin = new UtilsPlugin(app, {});
await plugin.onload();
assert.ok(plugin.registeredCommands.some(command => command.id === "make-file-names-sync-safe"),
	"users must be able to scan and rename existing notes and attachments from the command palette");
