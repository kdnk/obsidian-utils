import { App, Modal, Notice, Setting } from "obsidian";
import { RenamePreview, SafeNameService } from "./safe-name-service";

const PAGE_SIZE = 100;

export class SafeNameModal extends Modal {
	private preview: RenamePreview;
	private page = 0;
	private busy = false;
	private closed = false;

	constructor(app: App, private service: SafeNameService) {
		super(app);
		this.preview = service.preview();
	}

	onOpen(): void { this.render(); }
	onClose(): void { this.closed = true; this.contentEl.empty(); }

	private render(): void {
		const content = this.contentEl;
		content.empty();
		content.addClass("utils-safe-names");
		content.createEl("h2", { text: "Check filename compatibility" });
		content.createEl("p", { text: "Fix reserved characters, emoji, extra dots, and overly long names. Numbered suffixes prevent duplicates. Japanese characters and file extensions are preserved. New and renamed files are fixed automatically." });
		content.createEl("p", { text: "To update links, enable Settings → Files and links → Automatically update internal links. Configuration and hidden folders are excluded." });
		const { changes, skipped } = this.preview;
		content.createEl("p", { text: changes.length ? `Planned renames: ${changes.length}. Renaming a folder also moves the files inside it.` : "No filenames need fixing." });
		if (changes.length) {
			const table = content.createEl("table");
			const header = table.createEl("thead").createEl("tr");
			header.createEl("th", { text: "Before" });
			header.createEl("th", { text: "After" });
			const body = table.createEl("tbody");
			for (const change of changes.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)) {
				const row = body.createEl("tr");
				row.createEl("td", { text: change.path });
				row.createEl("td", { text: change.newPath });
			}
			if (changes.length > PAGE_SIZE) {
				new Setting(content).setName(`Page ${this.page + 1} of ${Math.ceil(changes.length / PAGE_SIZE)}`)
					.addButton(button => button.setButtonText("Previous").setDisabled(this.page === 0).onClick(() => { this.page--; this.render(); }))
					.addButton(button => button.setButtonText("Next").setDisabled((this.page + 1) * PAGE_SIZE >= changes.length).onClick(() => { this.page++; this.render(); }));
			}
		}
		if (skipped.length) {
			const details = content.createEl("details");
			details.createEl("summary", { text: `Names requiring manual attention: ${skipped.length}` });
			const list = details.createEl("ul");
			for (const item of skipped) list.createEl("li", { text: `${item.path}: ${item.reason}` });
		}
		new Setting(content)
			.addButton(button => button.setButtonText("Rescan").onClick(() => { this.preview = this.service.preview(); this.page = 0; this.render(); }))
			.addButton(button => button.setButtonText(`Fix all ${changes.length}`).setCta().setDisabled(!changes.length).onClick(() => { void this.apply(); }))
			.addButton(button => button.setButtonText("Close").onClick(() => this.close()));
	}

	private async apply(): Promise<void> {
		if (this.busy || this.closed) return;
		this.busy = true;
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "Fixing filenames" });
		const status = this.contentEl.createEl("p", { text: `Renamed: 0 / ${this.preview.changes.length}` });
		status.setAttribute("aria-live", "polite");
		new Setting(this.contentEl).addButton(button => button.setButtonText("Stop and close").onClick(() => this.close()));
		const result = await this.service.apply(this.preview, done => {
			if (!this.closed) status.setText(`Renamed: ${done} / ${this.preview.changes.length}`);
		}, () => this.closed);
		this.busy = false;
		const summary = `Renamed: ${result.completed.length}.${result.cancelled ? " Remaining operations were stopped." : ""}`;
		new Notice(result.error ? `${summary}\n${result.error}` : summary, result.error ? 10000 : 5000);
		if (this.closed) return;
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: result.error ? "Filename repair stopped" : "Filename repair results" });
		this.contentEl.createEl("p", { text: summary });
		if (result.error) this.contentEl.createEl("p", { text: result.error });
		if (result.completed.length) {
			const details = this.contentEl.createEl("details");
			details.createEl("summary", { text: "Completed renames" });
			const list = details.createEl("ul");
			for (const item of result.completed) list.createEl("li", { text: `${item.from} → ${item.to}` });
		}
		new Setting(this.contentEl)
			.addButton(button => button.setButtonText("Rescan").onClick(() => { this.preview = this.service.preview(); this.page = 0; this.render(); }))
			.addButton(button => button.setButtonText("Close").onClick(() => this.close()));
	}
}
