import { App, Notice, TAbstractFile } from "obsidian";
import { buildRenamePlan, isManagedPath, NameChange, nameKey, parentPath, RenamePlan } from "./safe-filenames";

interface BoundChange extends NameChange { file: TAbstractFile }
export interface RenamePreview extends RenamePlan { changes: BoundChange[] }
export interface RenameResult {
	completed: { from: string; to: string }[];
	error?: string;
	cancelled?: boolean;
}

export class SafeNameService {
	private queue: Promise<unknown> = Promise.resolve();
	private pending = new Set<TAbstractFile>();
	private renaming = new Set<TAbstractFile>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private activity = 0;
	private disposed = false;

	constructor(private app: App) {}

	preview(targets?: Set<TAbstractFile>): RenamePreview {
		const files = this.app.vault.getAllLoadedFiles();
		const byPath = new Map(files.map(file => [file.path, file]));
		const paths = targets && new Set([...targets].filter(file => byPath.get(file.path) === file).map(file => file.path));
		const plan = buildRenamePlan(files.map(file => ({ path: file.path, folder: "children" in file })), this.app.vault.configDir, paths);
		return { ...plan, changes: plan.changes.map(change => ({ ...change, file: byPath.get(change.path)! })) };
	}

	apply(preview: RenamePreview, onProgress?: (done: number) => void, cancelled = () => false): Promise<RenameResult> {
		const job = this.queue.then(() => this.perform(preview, onProgress, cancelled));
		// Both background and manual batches share one queue, including after a failed batch.
		this.queue = job.catch(() => undefined);
		return job;
	}

	async whenIdle(): Promise<void> { await this.queue; }

	enqueue(file: TAbstractFile): void {
		if (this.disposed || this.renaming.has(file) || !isManagedPath(file.path, this.app.vault.configDir)) return;
		this.pending.add(file);
		this.postpone();
	}

	postpone(): void {
		if (this.disposed || !this.pending.size) return;
		if (this.timer !== null) clearTimeout(this.timer);
		const activity = ++this.activity;
		// Importers commonly create an attachment before inserting its link into a note.
		// Metadata/vault changes restart this quiet period to let those references settle.
		this.timer = setTimeout(() => {
			this.timer = null;
			const job = this.queue.then(async () => {
				if (this.disposed || activity !== this.activity) return;
				// Keep queued targets pending until their job starts so importer activity can
				// restart the quiet period even while a manual batch occupies the queue.
				const targets = new Set(this.pending);
				this.pending.clear();
				const preview = this.preview(targets);
				const result = await this.perform(preview);
				if (result.error) new Notice(`Automatic filename repair stopped: ${result.error}`, 10000);
				else if (preview.skipped.length) new Notice(`A filename requires manual attention: ${preview.skipped[0].path}\n${preview.skipped[0].reason}`, 10000);
				else if (result.completed.length) new Notice(`Automatic filename repair completed. Renamed: ${result.completed.length}.`);
			});
			this.queue = job.catch(error => { new Notice(`Automatic filename repair failed: ${String(error)}`, 10000); });
		}, 1000);
	}

	dispose(): void {
		this.disposed = true;
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		this.pending.clear();
	}

	private validateSource(change: BoundChange): void {
		if (change.file.path !== change.path || this.app.vault.getAbstractFileByPath(change.path) !== change.file) {
			throw new Error("A file was moved or deleted after the preview was created. Rescan and try again.");
		}
	}

	private targetPath(change: NameChange): string {
		const parent = parentPath(change.path);
		return parent ? `${parent}/${change.newName}` : change.newName;
	}

	private async validateTarget(change: BoundChange): Promise<void> {
		const target = this.targetPath(change);
		// Include entries not yet indexed by Obsidian (and case/Unicode-equivalent disk names).
		const listed = await this.app.vault.adapter.list(parentPath(change.path));
		const collision = [...listed.files, ...listed.folders].some(path => path !== change.path && nameKey(path) === nameKey(target));
		if (collision || await this.app.vault.adapter.exists(target)) {
			throw new Error(`The destination already exists: ${target}. Rescan and try again.`);
		}
	}

	private async ensureLinkUpdates(): Promise<void> {
		// Read through the public adapter instead of changing settings or relying on private APIs.
		const path = `${this.app.vault.configDir}/app.json`;
		const settings: unknown = await this.app.vault.adapter.exists(path)
			? JSON.parse(await this.app.vault.adapter.read(path)) : null;
		// Missing settings use Obsidian's default (false). Only explicit opt-in is safe.
		if (!settings || typeof settings !== "object" || Array.isArray(settings)
			|| (settings as { alwaysUpdateLinks?: unknown }).alwaysUpdateLinks !== true) {
			throw new Error("Enable Settings → Files and links → Automatically update internal links.");
		}
	}

	private async perform(preview: RenamePreview, onProgress?: (done: number) => void, cancelled = () => false): Promise<RenameResult> {
		const result: RenameResult = { completed: [] };
		let currentPath = "";
		try {
			if (this.disposed || cancelled()) return { ...result, cancelled: true };
			if (!preview.changes.length) return result;
			await this.ensureLinkUpdates();
			// Reject stale previews before changing anything; recheck each item at execution time too.
			for (const change of preview.changes) {
				currentPath = change.path;
				this.validateSource(change);
				await this.validateTarget(change);
			}
			for (const change of preview.changes) {
				currentPath = change.path;
				if (this.disposed || cancelled()) return { ...result, cancelled: true };
				this.validateSource(change);
				await this.validateTarget(change);
				await this.ensureLinkUpdates();
				this.validateSource(change);
				if (this.disposed || cancelled()) return { ...result, cancelled: true };
				const target = this.targetPath(change);
				this.renaming.add(change.file);
				try {
					// This API also updates note/image references according to Obsidian's preferences.
					await this.app.fileManager.renameFile(change.file, target);
				} catch (error) {
					if (change.file.path === target && this.app.vault.getAbstractFileByPath(target) === change.file) {
						result.completed.push({ from: change.path, to: target });
						throw new Error(`The file or folder was renamed, but link updates may be incomplete. Check notes that reference it. ${String(error)}`);
					}
					throw error;
				} finally {
					this.renaming.delete(change.file);
				}
				result.completed.push({ from: change.path, to: target });
				onProgress?.(result.completed.length);
			}
		} catch (error) {
			result.error = `${currentPath ? `${currentPath}: ` : ""}${error instanceof Error ? error.message : String(error)}`;
		}
		return result;
	}
}
