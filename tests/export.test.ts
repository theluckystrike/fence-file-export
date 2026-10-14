import { describe, expect, it, vi } from 'vitest';
import { planExport, writeTargets, SOURCE_LIMIT, indexTarget, pathError } from '../src/export';
import { memoryVault } from './vault';

const fence = (path: string, text = 'A\n') => `\`\`\`text file="${path}"\n${text}\`\`\`\n`;
describe('Limits and writes', () => {
	it('accepts 100 targets and rejects 101 before writes', () => {
		const source = Array.from({ length: 100 }, (_, i) => fence(`${i}.txt`)).join('');
		expect(planExport(source, 'Exports').targets.length).toBe(100);
		expect(planExport(source + fence('extra.txt'), 'Exports')).toMatchObject({ targets: [], error: 'More than 100 targets' });
	});
	it('uses UTF-8 bytes for the 2 MiB source limit', () => {
		expect(planExport('é'.repeat(SOURCE_LIMIT / 2 + 1), 'Exports').error).toBe('Source exceeds 2 MiB');
		expect(planExport('a'.repeat(SOURCE_LIMIT), 'Exports').error).toBe('');
	});
	it('keeps a file that appears during parent creation', async () => {
		const vault = memoryVault();
		const create = vault.create;
		vault.create = vi.fn(create);
		vault.createFolder = async (path) => { vault.state.set(path, 'folder'); vault.state.set('Exports/a.txt', 'file'); };
		const result = await writeTargets([{ path: 'Exports/a.txt', text: 'new' }], vault);
		expect(result.failed).toEqual([{ path: 'Exports/a.txt', reason: 'Target exists' }]);
		expect(vault.create).not.toHaveBeenCalled();
	});
	it('accepts a folder that another operation creates', async () => {
		const vault = memoryVault();
		vault.createFolder = async (path) => { vault.state.set(path, 'folder'); throw new Error('Concurrent folder'); };
		expect(await writeTargets([{ path: 'Exports/a.txt', text: 'A' }], vault)).toEqual({ completed: ['Exports/a.txt'], failed: [] });
	});
	it('reports a parent that becomes a file', async () => {
		const vault = memoryVault();
		vault.createFolder = async (path) => { vault.state.set(path, 'file'); throw new Error('Concurrent file'); };
		expect((await writeTargets([{ path: 'Exports/a.txt', text: 'A' }], vault)).failed).toEqual([{ path: 'Exports/a.txt', reason: 'Concurrent file' }]);
		expect(vault.files.size).toBe(0);
	});
	it('continues after a failed write and preserves complete text', async () => {
		const vault = memoryVault({}, ['Exports/b.txt']);
		const targets = ['a', 'b', 'c'].map((n) => ({ path: `Exports/${n}.txt`, text: `${n}\r\n` }));
		const result = await writeTargets(targets, vault);
		expect(result.completed).toEqual(['Exports/a.txt', 'Exports/c.txt']);
		expect(vault.files.get('Exports/a.txt')).toBe('a\r\n');
		expect(vault.files.get('Exports/c.txt')).toBe('c\r\n');
	});
	it('revalidates direct write targets', async () => {
		const vault = memoryVault();
		const result = await writeTargets([{ path: '../escape.txt', text: 'A' }], vault);
		expect(result.failed.length).toBe(1); expect(vault.calls).toEqual([]);
	});
	it('checks the combined path against a custom configuration folder', () => {
		expect(planExport(fence('config/a.txt'), 'Exports', 'Exports/config').rejected[0]?.reason).toBe('Vault configuration folder');
	});
	it('uses relative Markdown links from the index folder', () => {
		expect(indexTarget('Exports', 'Notes/Recipe.md', [{ path: 'Exports/config/a.yml', text: 'A' }])).toEqual({ path: 'Exports/export-index.md', text: '# Export index\n\nSource: [Notes/Recipe.md](<../Notes/Recipe.md>)\n\n- [Exports/config/a.yml](<config/a.yml>)\n' });
	});
	it('encodes fragment and query characters in index links', () => {
		expect(indexTarget('Exports', 'A #1?.md', []).text).toContain('../A%20%231%3F.md');
	});
	it('rejects dangerous names before normalization', () => {
		for (const path of ['', 'a\u0000.txt', 'a/.x', 'a/./b', 'a/', 'a/LPT1.txt', 'a:stream', 'a.']) expect(pathError(path, '.obsidian')).not.toBe('');
	});
});
