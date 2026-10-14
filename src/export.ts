import { normalizePath } from 'obsidian';

export interface Target { path: string; text: string }
export interface Rejection { line: number; path: string; reason: string }
export interface Plan { folder: string; targets: Target[]; rejected: Rejection[]; skipped: number; error: string }
export interface WriteResult { completed: string[]; failed: { path: string; reason: string }[] }
export interface VaultPort {
	configDir: string;
	kind(path: string): 'file' | 'folder' | null;
	createFolder(path: string): Promise<unknown>;
	create(path: string, text: string): Promise<unknown>;
}
export const SOURCE_LIMIT = 2 * 1024 * 1024;
export const TARGET_LIMIT = 100;

/** Check the input before normalization can remove evidence of an unsafe path. */
export function pathError(path: string, configDir: string): string {
	if (!path || path !== path.trim() || path.startsWith('/') || /[\\:<>"|?*]/.test(path) || [...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return 'Invalid relative path';
	const parts = path.split('/');
	if (parts.some((part) => !part || part.startsWith('.') || part.endsWith('.') || part !== part.trim() || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return 'Hidden, reserved or traversal path';
	const config = configDir.toLowerCase();
	const lower = path.toLowerCase();
	if (lower === config || lower.startsWith(config + '/')) return 'Vault configuration folder';
	return '';
}

export function parents(path: string): string[] {
	const parts = path.split('/');
	return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

export function conflict(path: string, vault: Pick<VaultPort, 'kind'>): string {
	if (vault.kind(path)) return 'Target exists';
	for (const parent of parents(path)) if (vault.kind(parent) === 'file') return `Parent is a file: ${parent}`;
	return '';
}

/** Read only column-one fences. Keep body slices, including their original line endings. */
export function planExport(source: string, folder: string, configDir = ''): Plan {
	const plan: Plan = { folder, targets: [], rejected: [], skipped: 0, error: '' };
	const folderProblem = pathError(folder, configDir) || pathError(normalizePath(folder), configDir);
	if (folderProblem) { plan.error = `Output folder: ${folderProblem}`; return plan; }
	plan.folder = normalizePath(folder);
	if (new TextEncoder().encode(source).byteLength > SOURCE_LIMIT) { plan.error = 'Source exceeds 2 MiB'; return plan; }
	const lines = source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter((line) => line.length > 0) ?? [];
	const endings = new Map<string, string>();
	let open: { marker: string; length: number; line: number; path: string; named: boolean; problem: string; body: string[]; prefix: string } | null = null;
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i]!;
		const line = raw.replace(/[\r\n]+$/, '');
		if (open) {
			const closingLine = open.prefix ? line.replace(/^\s*(?:>\s*)*/, '') : line;
			const close = closingLine.match(/^(`{3,}|~{3,})[ \t]*$/);
			if (close && close[1]![0] === open.marker && close[1]!.length >= open.length) {
				if (!open.named) plan.skipped++;
				else if (open.problem) plan.rejected.push({ line: open.line, path: open.path, reason: open.problem });
				else {
					const path = normalizePath(`${plan.folder}/${open.path}`);
					const existing = plan.targets.find((target) => target.path === path);
					if (existing) existing.text += (existing.text.match(/\r\n|\r|\n/)?.[0] ?? endings.get(path) ?? '\n') + open.body.join('');
					else {
						endings.set(path, lines[open.line - 1]!.match(/\r\n|\r|\n/)?.[0] ?? '\n');
						plan.targets.push({ path, text: open.body.join('') });
						if (plan.targets.length > TARGET_LIMIT) { plan.error = 'More than 100 targets'; plan.targets = []; return plan; }
					}
				}
				open = null;
			} else open.body.push(raw);
			continue;
		}
		const fence = line.match(/^(\s*(?:>\s*|[-+*]\s+|\d+[.)]\s+)*)(`{3,}|~{3,})(.*)$/);
		if (!fence) continue;
		const [, prefix, marker, info] = fence as [string, string, string, string];
		const attrs = [...info.matchAll(/(?:^|\s)(file\s*=(?:"[^"]*"(?=\s|$)|'[^']*'(?=\s|$)|[^\s]*))/g)];
		const named = attrs.length > 0;
		const quoted = attrs[0]?.[1]?.match(/^file="([^"]*)"$/);
		const path = quoted?.[1] ?? '';
		let problem = prefix ? 'Unsupported nested or indented fence' : '';
		if (!problem && named && (attrs.length !== 1 || !quoted)) problem = 'Use one quoted file="relative/path.ext" attribute';
		if (!problem && marker[0] === '`' && info.includes('`')) problem = 'Backtick in fence info';
		if (!problem && named) problem = pathError(path, configDir) || pathError(normalizePath(path), configDir) || pathError(`${plan.folder}/${normalizePath(path)}`, configDir);
		open = { marker: marker[0]!, length: marker.length, line: i + 1, path, named, problem, body: [], prefix };
	}
	if (open?.named) plan.rejected.push({ line: open.line, path: open.path, reason: 'Incomplete fence' });
	if (plan.targets.length > TARGET_LIMIT) { plan.error = 'More than 100 targets'; plan.targets = []; }
	const collisions = new Set(plan.targets.filter((target) => plan.targets.some((other) => other.path.toLowerCase() !== target.path.toLowerCase() && other.path.toLowerCase().startsWith(target.path.toLowerCase() + '/')) || plan.targets.some((other) => other !== target && other.path.toLowerCase() === target.path.toLowerCase())).map((target) => target.path));
	for (const target of plan.targets) if (parents(target.path).some((parent) => [...collisions].some((x) => x.toLowerCase() === parent.toLowerCase()))) collisions.add(target.path);
	plan.targets = plan.targets.filter((target) => {
		if (!collisions.has(target.path)) return true;
		plan.rejected.push({ line: 0, path: target.path, reason: 'Targets conflict with each other' }); return false;
	});
	return plan;
}

export function preflight(plan: Plan, vault: Pick<VaultPort, 'kind'>): Plan {
	const rejected = [...plan.rejected];
	const targets = plan.targets.filter((target) => {
		const reason = conflict(target.path, vault);
		if (!reason) return true;
		rejected.push({ line: 0, path: target.path, reason }); return false;
	});
	return { ...plan, targets, rejected };
}

export function indexTarget(folder: string, sourcePath: string, targets: Target[]): Target {
	const relative = (path: string): string => {
		const from = folder.split('/'); const to = path.split('/');
		while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
		return '../'.repeat(from.length) + to.join('/');
	};
	const link = (path: string) => `[${path.replace(/[\\[\]]/g, '\\$&')}](<${encodeURI(relative(path)).replace(/#/g, '%23').replace(/\?/g, '%3F')}>)`;
	return { path: `${folder}/export-index.md`, text: `# Export index\n\nSource: ${link(sourcePath)}\n\n${targets.map((target) => `- ${link(target.path)}`).join('\n')}\n` };
}

/** Writes are sequential. A failed target leaves earlier completed targets in place. */
export async function writeTargets(targets: Target[], vault: VaultPort): Promise<WriteResult> {
	const result: WriteResult = { completed: [], failed: [] };
	for (const target of targets) {
		try {
			const invalid = pathError(target.path, vault.configDir) || pathError(normalizePath(target.path), vault.configDir);
			if (invalid) throw new Error(invalid);
			const problem = conflict(target.path, vault);
			if (problem) throw new Error(problem);
			for (const parent of parents(target.path)) {
				if (vault.kind(parent) === 'file') throw new Error(`Parent is a file: ${parent}`);
				if (!vault.kind(parent)) {
					try { await vault.createFolder(parent); }
					catch (error) { if (vault.kind(parent) !== 'folder') throw error; }
				}
			}
			if (vault.kind(target.path)) throw new Error('Target exists');
			await vault.create(normalizePath(target.path), target.text);
			result.completed.push(target.path);
		} catch (error) { result.failed.push({ path: target.path, reason: error instanceof Error ? error.message : String(error) }); }
	}
	return result;
}
