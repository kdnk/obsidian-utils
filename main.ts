import { App, Editor, Plugin, PluginManifest } from "obsidian";
import { SafeNameService } from "./safe-name-service";
import { SafeNameModal } from "./safe-name-modal";

// Remember to rename these classes and interfaces!

interface UtilsPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: UtilsPluginSettings = {
	mySetting: "default",
};

export default class UtilsPlugin extends Plugin {
	settings: UtilsPluginSettings;

	constructor(app: App, pluginManifest: PluginManifest) {
		super(app, pluginManifest);
	}

	async onload() {
		const safeNames = new SafeNameService(this.app);
		let active = true;
		this.register(() => { active = false; safeNames.dispose(); });
		// Vault loading emits create events for existing files. Only watch later changes.
		this.app.workspace.onLayoutReady(() => {
			if (!active) return;
			this.registerEvent(this.app.vault.on("create", file => safeNames.enqueue(file)));
			this.registerEvent(this.app.vault.on("rename", file => safeNames.enqueue(file)));
			this.registerEvent(this.app.vault.on("modify", () => safeNames.postpone()));
			this.registerEvent(this.app.metadataCache.on("resolved", () => safeNames.postpone()));
		});

		this.addCommand({
			id: "indent-more",
			name: "Indent More",
			editorCallback: (editor: Editor) => {
				editor.exec("indentMore");
			},
		});

		this.addCommand({
			id: "indent-less",
			name: "Indent Less",
			editorCallback: (editor: Editor) => {
				editor.exec("indentLess");
			},
		});

		this.addCommand({
			id: "swap-line-up",
			name: "swap line up",
			editorCallback: (editor) => editor.exec("swapLineUp"),
		});

		this.addCommand({
			id: "swap-line-down",
			name: "swap line down",
			editorCallback: (editor) => editor.exec("swapLineDown"),
		});
		this.addCommand({
			id: "make-file-names-sync-safe",
			name: "Check and fix filename compatibility",
			callback: async () => {
				await safeNames.whenIdle();
				if (active) new SafeNameModal(this.app, safeNames).open();
			},
		});

	}
}
