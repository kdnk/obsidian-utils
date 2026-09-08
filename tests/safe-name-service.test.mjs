import assert from "node:assert/strict";
import test from "node:test";
import { loadModule, fakeApp } from "./helpers.mjs";

const { SafeNameService } = await loadModule("../safe-name-service.ts");

test("renames notes, attachments and nested folders using Obsidian's link-aware API", async () => {
	const { app, calls, files } = fakeApp(["pages/What Is an AI Anyway?.md", "attachments/1*image.png", "bad?/child*/note?.md"]);
	const service = new SafeNameService(app);
	const preview = service.preview();
	assert.equal(calls.length, 0, "preview must not mutate the vault");
	const result = await service.apply(preview);
	assert.equal(result.completed.length, 5);
	assert.equal(result.error, undefined);
	assert.ok(files.has("pages/What Is an AI Anyway_.md"));
	assert.ok(files.has("attachments/1_image.png"));
	assert.ok(files.has("bad_/child_/note_.md"));
	assert.deepEqual(calls[0], ["bad?/child*/note?.md", "bad?/child*/note_.md"]);
});

test("a stale preview cannot rename a replacement file at the same path", async () => {
	const { app, add, calls } = fakeApp(["note?.md"]);
	const service = new SafeNameService(app);
	const preview = service.preview();
	add("note?.md");
	const result = await service.apply(preview);
	assert.ok(result.error);
	assert.equal(calls.length, 0);
});

test("preflight rejects newly occupied targets before any files are renamed", async () => {
	const { app, add, calls } = fakeApp(["a?.md", "b?.md"]);
	const service = new SafeNameService(app);
	const preview = service.preview();
	add("B_.md");
	const result = await service.apply(preview);
	assert.ok(result.error);
	assert.equal(calls.length, 0);
});

test("on-disk entries missing from the metadata cache are never overwritten", async () => {
	const { app, calls } = fakeApp(["note?.md"]);
	app.vault.adapter.list = async () => ({ files: ["note?.md", "NOTE_.md"], folders: [] });
	const service = new SafeNameService(app);
	const result = await service.apply(service.preview());
	assert.ok(result.error);
	assert.equal(calls.length, 0);
});

test("disabled link updating prevents both manual and automatic destructive renames", async () => {
	const { app, calls } = fakeApp(["note?.md"]);
	app.updateLinks = false;
	const service = new SafeNameService(app);
	const result = await service.apply(service.preview());
	assert.match(result.error, /内部リンク/);
	assert.equal(calls.length, 0);
});

test("missing or unknown link-update settings must fail closed", async () => {
	for (const stored of [null, {}, { alwaysUpdateLinks: "true" }]) {
		const { app, calls } = fakeApp(["note?.md"]);
		app.vault.adapter.exists = async path => path === ".obsidian/app.json" ? stored !== null : path === "note?.md";
		app.vault.adapter.read = async () => JSON.stringify(stored);
		const service = new SafeNameService(app);
		const result = await service.apply(service.preview());
		assert.ok(result.error, JSON.stringify(stored));
		assert.equal(calls.length, 0);
	}
});

test("partial failures stop the batch and report what really completed", async () => {
	const { app, calls } = fakeApp(["a?.md", "b?.md", "c?.md"]);
	const rename = app.fileManager.renameFile;
	app.fileManager.renameFile = async (file, target) => {
		if (file.path === "b?.md") throw new Error("disk full");
		await rename(file, target);
	};
	const service = new SafeNameService(app);
	const result = await service.apply(service.preview());
	assert.equal(result.completed.length, 1);
	assert.match(result.error, /b\?\.md.*disk full/);
	assert.deepEqual(calls, [["a?.md", "a_.md"]]);
});

test("unloading cancels scheduled automatic work", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { app, files, calls } = fakeApp(["note?.md"]);
	const service = new SafeNameService(app);
	service.enqueue(files.get("note?.md"));
	service.dispose();
	t.mock.timers.tick(5000);
	await service.whenIdle();
	assert.equal(calls.length, 0);
});

test("automatic repair waits for creation to settle, uses the latest path, and does not loop", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { app, files, emit, calls } = fakeApp(["old?.md", "image*.png"]);
	const service = new SafeNameService(app);
	app.vault.on("rename", file => service.enqueue(file));
	service.enqueue(files.get("image*.png"));
	t.mock.timers.tick(500);
	assert.equal(calls.length, 0);
	await app.fileManager.renameFile(files.get("image*.png"), "updated*.png");
	t.mock.timers.tick(1000);
	await service.whenIdle();
	assert.ok(files.has("updated_.png"));
	assert.ok(files.has("old?.md"), "a new file event must not sweep unrelated existing files");
	t.mock.timers.tick(5000);
	await service.whenIdle();
	assert.equal(calls.length, 2, "the plugin's own rename event must not cause another rename");
	service.dispose();
});

test("creating a file inside an unsafe folder repairs the path as well", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { app, files } = fakeApp(["folder?/image*.png"]);
	const service = new SafeNameService(app);
	service.enqueue(files.get("folder?/image*.png"));
	t.mock.timers.tick(1000);
	await service.whenIdle();
	assert.ok(files.has("folder_/image_.png"));
	service.dispose();
});

test("queued automatic work waits again if the importer changes notes during a manual batch", async t => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const { app, add, files } = fakeApp(["manual?.md"]);
	let release;
	let started;
	const gate = new Promise(resolve => { release = resolve; });
	const entered = new Promise(resolve => { started = resolve; });
	const rename = app.fileManager.renameFile;
	app.fileManager.renameFile = async (file, target) => {
		if (file.path === "manual?.md") { started(); await gate; }
		await rename(file, target);
	};
	const service = new SafeNameService(app);
	const manual = service.apply(service.preview());
	await entered;
	service.enqueue(add("image*.png"));
	t.mock.timers.tick(1000);
	service.postpone(); // A new modify/resolved event from an unfinished importer.
	release();
	await manual;
	await service.whenIdle();
	assert.ok(files.has("image*.png"), "a queued job cannot bypass the new quiet period");
	t.mock.timers.tick(1000);
	await service.whenIdle();
	assert.ok(files.has("image_.png"));
	service.dispose();
});

test("a successful move followed by a link-update error is reported as moved with an error", async () => {
	const { app, files } = fakeApp(["a?.md", "b?.md"]);
	const rename = app.fileManager.renameFile;
	app.fileManager.renameFile = async (file, target) => { await rename(file, target); throw new Error("link update failed"); };
	const service = new SafeNameService(app);
	const result = await service.apply(service.preview());
	assert.deepEqual(result.completed, [{ from: "a?.md", to: "a_.md" }]);
	assert.match(result.error, /リンク/);
	assert.ok(files.has("b?.md"));
});
