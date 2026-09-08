export interface NameEntry { path: string; folder: boolean }
export interface NameChange extends NameEntry { newName: string; newPath: string }
export interface RenamePlan { changes: NameChange[]; skipped: { path: string; reason: string }[] }

const MAX_NAME_BYTES = 255;
const encoder = new TextEncoder();
// Consume keycaps and joined emoji together, so no invisible joiners are left behind.
const emoji = /(?:[#*0-9]\uFE0F?\u20E3|[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}](?:[\uFE0E\uFE0F]|\p{Emoji_Modifier}|[\u{E0020}-\u{E007E}]+\u{E007F})?(?:\u200D\p{Extended_Pictographic}(?:[\uFE0E\uFE0F]|\p{Emoji_Modifier})?)*)/gu;
const forbidden = /[<>:"/\\|?*#^\[\]\u0000-\u001f\u007f]/g;
const reserved = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i;

export function parentPath(path: string): string {
	return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

function leafName(path: string): string { return path.slice(path.lastIndexOf("/") + 1); }
function joinPath(parent: string, name: string): string { return parent ? `${parent}/${name}` : name; }
// Uppercase first also folds expansions such as ß/SS and the two lowercase sigmas.
export function nameKey(name: string): string { return name.normalize("NFC").toUpperCase().toLowerCase().normalize("NFC"); }
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function depth(path: string): number { return path.split("/").length; }

function splitName(name: string, folder: boolean): [string, string] {
	const dot = folder ? -1 : name.lastIndexOf(".");
	return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

function fitName(stem: string, extension: string, suffix = ""): string {
	const budget = MAX_NAME_BYTES - encoder.encode(extension + suffix).length;
	if (budget < 1) throw new Error("拡張子が長すぎるため、拡張子を保った名前に変更できません。");
	let result = "";
	let size = 0;
	for (const char of stem) {
		const bytes = encoder.encode(char).length;
		if (size + bytes > budget) break;
		result += char;
		size += bytes;
	}
	result = result.replace(/[ .]+$/g, "") || "_";
	if (!suffix && reserved.test(result)) return fitName(`_${result}`, extension);
	return result + suffix + extension;
}

export function safeName(name: string, folder: boolean): string {
	const cleaned = name.replace(emoji, "_").replace(forbidden, "_")
		.replace(/^[\s.]+|[\s.]+$/g, "");
	let [stem, extension] = splitName(cleaned, folder);
	stem = stem.replace(/\./g, "_") || "untitled";
	if (reserved.test(stem)) stem = `_${stem}`;
	return fitName(stem, extension);
}

export function isManagedPath(path: string, configDir: string): boolean {
	return !!path && path !== "/" && !path.split("/").some(part => part.startsWith("."))
		&& path !== configDir && !path.startsWith(`${configDir}/`);
}

export function buildRenamePlan(entries: NameEntry[], configDir = ".obsidian", targets?: Set<string>): RenamePlan {
	const plan: RenamePlan = { changes: [], skipped: [] };
	const groups = new Map<string, NameEntry[]>();
	const finalPaths = new Map<string, string>();
	const selected = (entry: NameEntry) => !targets || targets.has(entry.path)
		|| [...targets].some(path => path.startsWith(`${entry.path}/`));
	for (const entry of entries) {
		if (!entry.path || entry.path === "/") continue;
		const parent = parentPath(entry.path);
		if (!groups.has(parent)) groups.set(parent, []);
		groups.get(parent)!.push(entry);
	}
	// Parents are allocated first for accurate final paths; execution runs in reverse depth order.
	for (const parent of [...groups.keys()].sort((a, b) => depth(a) - depth(b) || compare(a, b))) {
		const children = groups.get(parent)!;
		const original = new Set(children.map(entry => nameKey(leafName(entry.path))));
		const claimed = new Set<string>();
		const candidates: { entry: NameEntry; name: string }[] = [];
		for (const entry of children.sort((a, b) => compare(a.path, b.path))) {
			const oldName = leafName(entry.path);
			if (!isManagedPath(entry.path, configDir) || !selected(entry)) {
				claimed.add(nameKey(oldName));
				continue;
			}
			try {
				const name = safeName(oldName, entry.folder);
				if (configDir.startsWith(`${entry.path}/`)) {
					if (name !== oldName) plan.skipped.push({ path: entry.path, reason: "設定フォルダを含むため変更しません。" });
					claimed.add(nameKey(oldName));
					continue;
				}
				candidates.push({ entry, name });
			} catch (error) {
				claimed.add(nameKey(oldName));
				plan.skipped.push({ path: entry.path, reason: String(error) });
			}
		}
		// Leave already-safe names in place before allocating replacements for unsafe names.
		candidates.sort((a, b) => Number(a.name !== leafName(a.entry.path)) - Number(b.name !== leafName(b.entry.path)) || compare(a.entry.path, b.entry.path));
		for (const { entry, name } of candidates) {
			const oldName = leafName(entry.path);
			const oldKey = nameKey(oldName);
			let candidate = name;
			let number = 2;
			try {
				while (claimed.has(nameKey(candidate)) || (nameKey(candidate) !== oldKey && original.has(nameKey(candidate)))) {
					const [stem, ext] = splitName(name, entry.folder);
					candidate = fitName(stem, ext, ` (${number++})`);
				}
				claimed.add(nameKey(candidate));
				const newPath = joinPath(finalPaths.get(parent) ?? parent, candidate);
				finalPaths.set(entry.path, newPath);
				if (candidate !== oldName) plan.changes.push({ ...entry, newName: candidate, newPath });
			} catch (error) {
				claimed.add(oldKey);
				plan.skipped.push({ path: entry.path, reason: String(error) });
			}
		}
		// Unchanged/excluded folders still inherit the final path of a renamed parent.
		for (const entry of children) {
			if (!finalPaths.has(entry.path)) finalPaths.set(entry.path, joinPath(finalPaths.get(parent) ?? parent, leafName(entry.path)));
		}
	}
	plan.changes.sort((a, b) => depth(b.path) - depth(a.path) || compare(a.path, b.path));
	plan.skipped.sort((a, b) => compare(a.path, b.path));
	return plan;
}
