import assert from "node:assert/strict";
import test from "node:test";
import { loadModule, fakeApp } from "./helpers.mjs";

const { default: UtilsPlugin } = await loadModule("../main.ts");

test("startup preserves open notes and editor commands without bulk renaming existing files", async () => {
	const { app, ready, calls } = fakeApp(["existing?.md"]);
	const leaves = ["one.md", "two.md"].map(path => ({
		path, view: { getViewType: () => "markdown" },
		detach() { leaves.splice(leaves.indexOf(this), 1); },
	}));
	const original = [...leaves];
	app.workspace.iterateAllLeaves = callback => [...leaves].forEach(callback);
	app.workspace.getLeavesOfType = () => [...leaves];
	app.workspace.getLeaf = () => { throw new Error("startup must not open new tabs"); };
	app.workspace.detachLeavesOfType = () => { leaves.length = 0; };
	const plugin = new UtilsPlugin(app, {});
	await plugin.onload();
	for (const callback of ready) callback();
	assert.deepEqual(leaves, original, "restored note tabs must remain open");
	assert.equal(calls.length, 0, "loading the vault must not trigger renames");
	for (const id of ["indent-more", "indent-less", "swap-line-up", "swap-line-down"]) {
		assert.ok(plugin.registeredCommands.some(command => command.id === id));
	}
	plugin.cleanups.forEach(callback => callback());
});

test("creation and rename events are registered after layout, and detached on unload", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { app, ready, emit, add, files } = fakeApp();
	const plugin = new UtilsPlugin(app, {});
	await plugin.onload();
	emit("create", add("during-load?.md"));
	ready.forEach(callback => callback());
	emit("create", add("new*.png"));
	t.mock.timers.tick(1000);
	for (let i = 0; i < 50; i++) await Promise.resolve();
	assert.ok(files.has("new_.png"));
	assert.ok(files.has("during-load?.md"));
	await app.fileManager.renameFile(files.get("new_.png"), "renamed?.png");
	t.mock.timers.tick(1000);
	for (let i = 0; i < 50; i++) await Promise.resolve();
	assert.ok(files.has("renamed_.png"));
	plugin.cleanups.forEach(callback => callback());
	emit("create", add("after-unload?.md"));
	t.mock.timers.tick(1000);
	for (let i = 0; i < 50; i++) await Promise.resolve();
	assert.ok(files.has("after-unload?.md"));
});
