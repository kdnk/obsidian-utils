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
		content.createEl("h2", { text: "ファイル名の互換性をチェック" });
		content.createEl("p", { text: "禁止記号・絵文字・余分なドット・長すぎる名前を修正し、重複には連番を付けます。日本語と拡張子は保持します。新規作成・名前変更されたファイルには自動で適用されます。" });
		content.createEl("p", { text: "リンクの更新には、設定 → ファイルとリンク →「内部リンクを常に更新」が必要です。設定・隠しフォルダは対象外です。" });
		const { changes, skipped } = this.preview;
		content.createEl("p", { text: changes.length ? `変更予定: ${changes.length}件（フォルダの変更には中のファイルの移動も含まれます）` : "修正が必要なファイル名はありません。" });
		if (changes.length) {
			const table = content.createEl("table");
			const header = table.createEl("thead").createEl("tr");
			header.createEl("th", { text: "変更前" });
			header.createEl("th", { text: "変更後" });
			const body = table.createEl("tbody");
			for (const change of changes.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE)) {
				const row = body.createEl("tr");
				row.createEl("td", { text: change.path });
				row.createEl("td", { text: change.newPath });
			}
			if (changes.length > PAGE_SIZE) {
				new Setting(content).setName(`${this.page + 1} / ${Math.ceil(changes.length / PAGE_SIZE)} ページ`)
					.addButton(button => button.setButtonText("前へ").setDisabled(this.page === 0).onClick(() => { this.page--; this.render(); }))
					.addButton(button => button.setButtonText("次へ").setDisabled((this.page + 1) * PAGE_SIZE >= changes.length).onClick(() => { this.page++; this.render(); }));
			}
		}
		if (skipped.length) {
			const details = content.createEl("details");
			details.createEl("summary", { text: `自動修正できない名前: ${skipped.length}件` });
			const list = details.createEl("ul");
			for (const item of skipped) list.createEl("li", { text: `${item.path}: ${item.reason}` });
		}
		new Setting(content)
			.addButton(button => button.setButtonText("再スキャン").onClick(() => { this.preview = this.service.preview(); this.page = 0; this.render(); }))
			.addButton(button => button.setButtonText(`全${changes.length}件を修正`).setCta().setDisabled(!changes.length).onClick(() => { void this.apply(); }))
			.addButton(button => button.setButtonText("閉じる").onClick(() => this.close()));
	}

	private async apply(): Promise<void> {
		if (this.busy || this.closed) return;
		this.busy = true;
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: "ファイル名を修正中" });
		const status = this.contentEl.createEl("p", { text: `0 / ${this.preview.changes.length}件` });
		status.setAttribute("aria-live", "polite");
		new Setting(this.contentEl).addButton(button => button.setButtonText("停止して閉じる").onClick(() => this.close()));
		const result = await this.service.apply(this.preview, done => {
			if (!this.closed) status.setText(`${done} / ${this.preview.changes.length}件`);
		}, () => this.closed);
		this.busy = false;
		const summary = `${result.completed.length}件を変更しました。${result.cancelled ? "残りの処理は停止しました。" : ""}`;
		new Notice(result.error ? `${summary}\n${result.error}` : summary, result.error ? 10000 : 5000);
		if (this.closed) return;
		this.contentEl.empty();
		this.contentEl.createEl("h2", { text: result.error ? "修正を停止しました" : "修正結果" });
		this.contentEl.createEl("p", { text: summary });
		if (result.error) this.contentEl.createEl("p", { text: result.error });
		if (result.completed.length) {
			const details = this.contentEl.createEl("details");
			details.createEl("summary", { text: "実行した名前変更" });
			const list = details.createEl("ul");
			for (const item of result.completed) list.createEl("li", { text: `${item.from} → ${item.to}` });
		}
		new Setting(this.contentEl)
			.addButton(button => button.setButtonText("再スキャン").onClick(() => { this.preview = this.service.preview(); this.page = 0; this.render(); }))
			.addButton(button => button.setButtonText("閉じる").onClick(() => this.close()));
	}
}
