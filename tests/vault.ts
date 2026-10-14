import type { VaultPort } from '../src/export';
export function memoryVault(entries: Record<string, 'file' | 'folder'> = {}, fail: string[] = []) {
	const state = new Map(Object.entries(entries));
	const files = new Map<string, string>();
	const calls: string[] = [];
	const vault: VaultPort = {
		configDir: '.obsidian', kind: (path) => state.get(path) ?? null,
		createFolder: async (path) => { calls.push(`folder ${path}`); if (state.has(path)) throw new Error('Exists'); state.set(path, 'folder'); },
		create: async (path, text) => { calls.push(`file ${path}`); if (state.has(path)) throw new Error('Exists'); if (fail.includes(path)) throw new Error('Injected local write failure'); state.set(path, 'file'); files.set(path, text); },
	};
	return { ...vault, state, files, calls };
}
