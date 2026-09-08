import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export async function loadModule(path) {
	const { outputFiles } = await build({
		entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
		bundle: true,
		format: "cjs",
		platform: "node",
		write: false,
		plugins: [{
			name: "obsidian-test-boundary",
			setup(builder) {
				builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
				builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents: `
					export class TAbstractFile {}
					export class TFile extends TAbstractFile {}
					export class TFolder extends TAbstractFile {}
					export class Modal { constructor(app) { this.app = app; } }
					export class Notice { constructor(message) { globalThis.__notices?.push(message); } }
					export class Setting {}
					export class Plugin {
						constructor(app) { this.app = app; this.registeredCommands = []; this.cleanups = []; }
						addCommand(command) { this.registeredCommands.push(command); }
						register(callback) { this.cleanups.push(callback); }
						registerEvent(event) { this.cleanups.push(() => event.off()); }
					}
				` }));
			},
		}],
	});
	const mod = { exports: {} };
	new Function("module", "exports", "require", outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
	return mod.exports;
}

export function fakeApp(paths = []) {
	const files = new Map();
	const calls = [];
	const listeners = new Map();
	const ready = [];
	const on = (name, callback) => {
		if (!listeners.has(name)) listeners.set(name, new Set());
		listeners.get(name).add(callback);
		return { off: () => listeners.get(name).delete(callback) };
	};
	const emit = (name, ...args) => { for (const cb of listeners.get(name) ?? []) cb(...args); };
	const add = (path, folder = false) => {
		const file = { path, name: path.split("/").pop(), ...(folder ? { children: [] } : { extension: path.split(".").pop() }) };
		files.set(path, file);
		return file;
	};
	add("", true);
	for (const path of paths) {
		const parts = path.replace(/\/$/, "").split("/");
		for (let i = 1; i < parts.length; i++) {
			const parent = parts.slice(0, i).join("/");
			if (!files.has(parent)) add(parent, true);
		}
		add(parts.join("/"), path.endsWith("/"));
	}
	const app = {
		workspace: { onLayoutReady: callback => ready.push(callback) },
		metadataCache: { on: (name, callback) => on(`metadata:${name}`, callback) },
		vault: {
			configDir: ".obsidian",
			getAllLoadedFiles: () => [...files.values()],
			getAbstractFileByPath: path => files.get(path) ?? null,
			on,
			adapter: {
				exists: async path => path === ".obsidian/app.json" || files.has(path),
				read: async () => JSON.stringify({ alwaysUpdateLinks: app.updateLinks }),
				list: async parent => {
					const items = [...files.values()].filter(f => f.path && f.path.slice(0, Math.max(0, f.path.lastIndexOf("/"))) === parent);
					return { files: items.filter(f => !("children" in f)).map(f => f.path), folders: items.filter(f => "children" in f).map(f => f.path) };
				},
			},
		},
		updateLinks: true,
		fileManager: {
			renameFile: async (file, newPath) => {
				assertAbsent(newPath);
				const oldPath = file.path;
				calls.push([oldPath, newPath]);
				for (const [path, entry] of [...files]) {
					if (path === oldPath || path.startsWith(`${oldPath}/`)) {
						files.delete(path);
						entry.path = newPath + path.slice(oldPath.length);
						entry.name = entry.path.split("/").pop();
						files.set(entry.path, entry);
					}
				}
				emit("rename", file, oldPath);
			},
		},
	};
	function assertAbsent(path) { if (files.has(path)) throw new Error(`Refusing to overwrite ${path}`); }
	return { app, files, calls, add, emit, ready };
}
