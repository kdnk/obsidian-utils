import { App, Editor, Plugin, PluginManifest, Platform } from "obsidian";

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

		this.app.workspace.onLayoutReady(() => {
			const closeOthersTabGroupDefinition =
				// @ts-expect-error
				this.app?.commands?.commands?.[
					"workspace:close-others-tab-group"
				];
			if (!closeOthersTabGroupDefinition) return;
			if (Platform.isMobile) return;
			if (Platform.isMobileApp) return;

			closeOthersTabGroupDefinition.checkCallback(false);
		});
	}
}
