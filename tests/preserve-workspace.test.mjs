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
