import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers.mjs";

const { safeName, buildRenamePlan } = await loadModule("../safe-filenames.ts");
const entry = (path, folder = false) => ({ path, folder });

test("both reported Sync failures get safe names while keeping their extensions", () => {
	assert.equal(safeName("What Is an AI Anyway?  Mustafa Suleyman  TED.md", false), "What Is an AI Anyway_  Mustafa Suleyman  TED.md");
	assert.equal(safeName("1*5I2A-oD2_mRTKc12bKJE0g.png", false), "1_5I2A-oD2_mRTKc12bKJE0g.png");
});

test("portable names, Japanese and spaces survive; filesystem and link delimiters do not", () => {
	assert.equal(safeName("日本語の ノート-2026_09.md", false), "日本語の ノート-2026_09.md");
	assert.equal(safeName('a<>:"/\\|?*#^[]\u0000\u001f\u007f.md', false), "a" + "_".repeat(16) + ".md");
	assert.equal(safeName("CON.md", false), "_CON.md");
	assert.equal(safeName("lpt².txt", false), "_lpt².txt");
	assert.equal(safeName(" Note. ", true), "Note");
});

test("the common rule removes extra dots and complete emoji sequences without a user choice", () => {
	assert.equal(safeName("写真📷.2026.09.png", false), "写真__2026_09.png");
	assert.equal(safeName("家族👨‍👩‍👧‍👦.md", false), "家族_.md");
	assert.equal(safeName("1️⃣日.md", false), "_日.md");
	assert.equal(safeName("記録.2026", true), "記録_2026");
	assert.equal(safeName("...", true), "untitled");
});

test("long Japanese names fit in 255 UTF-8 bytes and suffixes also fit", () => {
	const name = "あ".repeat(100) + ".md";
	assert.equal(safeName(name, false), "あ".repeat(84) + ".md");
	const plan = buildRenamePlan([entry(name), entry("あ".repeat(84) + ".md")]);
	assert.equal(plan.changes[0].newName, "あ".repeat(82) + " (2).md");
	assert.ok(Buffer.byteLength(plan.changes[0].newName) <= 255);
});

test("planning is deterministic and reserves existing files and folders before assigning names", () => {
	const entries = [entry("A?.md"), entry("a*.md"), entry("a_.md"), entry("A_ (2).md", true)];
	const plan = buildRenamePlan(entries);
	assert.deepEqual(plan.changes.map(c => [c.path, c.newName]), [["A?.md", "A_ (3).md"], ["A_ (2).md", "A_ (2)_md"], ["a*.md", "a_ (4).md"]]);
	assert.deepEqual(buildRenamePlan([...entries].reverse()), plan);
});

test("case and Unicode-equivalent names cannot overwrite one another", () => {
	const plan = buildRenamePlan([entry("Note.md"), entry("note.md"), entry("café.md"), entry("cafe\u0301.md")]);
	assert.equal(plan.changes.length, 2);
	assert.ok(plan.changes.every(c => c.newName.endsWith(" (2).md")));
});

test("nested folder renames expose final paths and execute children first", () => {
	const plan = buildRenamePlan([entry("bad?", true), entry("bad?/child*", true), entry("bad?/child*/photo?.png")]);
	assert.deepEqual(plan.changes.map(c => [c.path, c.newPath]), [
		["bad?/child*/photo?.png", "bad_/child_/photo_.png"],
		["bad?/child*", "bad_/child_"],
		["bad?", "bad_"],
	]);
});

test("hidden files, configuration, and its ancestors are protected", () => {
	const plan = buildRenamePlan([entry(".obsidian/a?.json"), entry(".git", true), entry(".hidden.md"), entry("config?", true), entry("config?/settings", true), entry("config?/settings/data?.json"), entry("other?.md")], "config?/settings");
	assert.deepEqual(plan.changes.map(c => c.path), ["other?.md"]);
	assert.ok(plan.skipped.some(c => c.path === "config?"));
});

test("automatic planning changes only the new entry and reserves pre-existing equivalents", () => {
	const plan = buildRenamePlan([entry("bad?.md"), entry("note.md"), entry("Note.md")], ".obsidian", new Set(["Note.md"]));
	assert.deepEqual(plan.changes.map(c => [c.path, c.newName]), [["Note.md", "Note (2).md"]]);
});

test("an unshortenable extension is reported instead of corrupting its type", () => {
	const path = "note." + "a".repeat(255);
	const plan = buildRenamePlan([entry(path)]);
	assert.equal(plan.changes.length, 0);
	assert.equal(plan.skipped[0].path, path);
});

test("trimming or shortening a stem must not produce a reserved device name", () => {
	assert.equal(safeName("CON .md", false), "_CON.md");
	assert.equal(safeName("CONsuffix." + "a".repeat(251), false).split(".")[0], "_CO");
});

test("Unicode uppercase expansions also reserve existing names", () => {
	const plan = buildRenamePlan([entry("straße.md"), entry("STRASSE.md")]);
	assert.equal(plan.changes.length, 1);
	assert.equal(plan.changes[0].newName, "straße (2).md");
});

test("a second scan leaves every converted name alone", () => {
	const stems = ["note", "CON ", "NUL", "名前", "日本語".repeat(100), "写真📷", "abc.def", "[note]?", "..", "a".repeat(300)];
	for (const stem of stems) for (const extension of [".md", ".png", ".a".repeat(100)]) {
		const converted = safeName(stem + extension, false);
		assert.ok(Buffer.byteLength(converted) <= 255);
		assert.equal(safeName(converted, false), converted, stem + extension);
	}
});

test("flag tag sequences and standalone emoji modifiers leave no invisible fragments", () => {
	assert.equal(safeName("flag\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}.md", false), "flag_.md");
	assert.equal(safeName("skin\u{1f3fb}.md", false), "skin_.md");
});
