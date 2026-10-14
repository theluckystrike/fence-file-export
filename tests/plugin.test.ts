import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian-test-mocks/obsidian';
import FenceFileExportPlugin from '../src/main';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/settings';
import { SPONSORS, bindPro, isPro, onProChange, resetPro } from '../src/pro';
import { memoryVault } from './vault';
import manifest from '../manifest.json';

afterEach(() => resetPro());
function plugin() {
	const app = App.createConfigured__({ files: { 'Notes/Source.md': '# Source' } });
	const p = new FenceFileExportPlugin(app as never, manifest as never);
	p.saveSettings = vi.fn(async () => undefined);
	return p;
}
function enablePro() { bindPro({ isPro: () => true, onChange: () => () => undefined } as never); }
describe('Settings and Pro', () => {
	it('loads default settings from an in-memory vault', async () => {
		const p = plugin(); await p.loadSettings(); expect(p.settings).toEqual(DEFAULT_SETTINGS); expect(isPro()).toBe(false);
	});
	it('repairs bad saved values', () => {
		expect(normalizeSettings({ folder: 5 as never, profiles: 'bad' as never })).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings({ folder: '../bad', profiles: [{ name: '', folder: 'OK' }, { name: 'Good', folder: 'Code' }] })).toEqual({ folder: 'Exports', profiles: [{ name: 'Good', folder: 'Code' }] });
	});
	it('uses the reference sponsorship terms', () => {
		expect(SPONSORS).toEqual({ clientId: 'Ov23lic5UPGPZqhBlBGg', sponsorLogin: 'theluckystrike', minMonthlyUsd: 5, oneTimeUsd: 15, oneTimeMonths: 0, scope: 'read:user' });
	});
	it('sends Pro changes to listeners and clears them on reset', () => {
		let callback = () => undefined;
		const unbind = vi.fn();
		bindPro({ isPro: () => true, onChange: (cb: () => void) => { callback = cb; return unbind; } } as never);
		const listener = vi.fn(); const off = onProChange(listener);
		callback(); expect(listener).toHaveBeenCalledOnce(); off(); callback(); expect(listener).toHaveBeenCalledOnce();
		resetPro(); expect(unbind).toHaveBeenCalledOnce(); expect(isPro()).toBe(false);
	});
	it('does not save profiles without Pro', async () => {
		const p = plugin(); expect(await p.saveProfile('Code', 'Exports')).toBe(false); expect(p.settings.profiles).toEqual([]); expect(p.saveSettings).not.toHaveBeenCalled();
	});
	it('saves and updates named profiles with Pro', async () => {
		enablePro(); const p = plugin(); expect(await p.saveProfile('Code', 'Exports')).toBe(true);
		expect(await p.saveProfile('Code', 'Release')).toBe(true); expect(p.settings.profiles).toEqual([{ name: 'Code', folder: 'Release' }]);
	});
	it('limits and validates saved profiles', async () => {
		enablePro(); const p = plugin();
		expect(await p.saveProfile('', 'Exports')).toBe(false); expect(await p.saveProfile('Bad', '../outside')).toBe(false);
		p.settings.profiles = Array.from({ length: 20 }, (_, i) => ({ name: String(i), folder: 'Exports' }));
		expect(await p.saveProfile('Extra', 'Exports')).toBe(false);
	});
	it('free core creates files with the network transport disabled', async () => {
		const p = plugin(); const vault = memoryVault(); p.vaultPort = () => vault;
		const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Offline'));
		const plan = p.makePlan('```text file="a.txt"\nHello\n```', 'Exports');
		expect(await p.createExport(plan, 'Notes/Source.md', false)).toEqual({ completed: ['Exports/a.txt'], failed: [] });
		expect(vault.files.get('Exports/a.txt')).toBe('Hello\n'); expect(network).not.toHaveBeenCalled(); network.mockRestore();
	});
	it('creates an index with Pro and rejects it without Pro', async () => {
		const p = plugin(); const vault = memoryVault(); p.vaultPort = () => vault;
		const plan = p.makePlan('```text file="a.txt"\nHello\n```', 'Exports');
		const denied = await p.createExport(plan, 'Notes/Source.md', true);
		expect(denied.completed).toEqual(['Exports/a.txt']); expect(denied.failed[0]?.reason).toBe('Export index needs Pro');
		expect(vault.files.has('Exports/export-index.md')).toBe(false);
		enablePro(); const other = p.makePlan('```text file="b.txt"\nB\n```', 'Second');
		const created = await p.createExport(other, 'Notes/Source.md', true);
		expect(created.completed).toEqual(['Second/b.txt', 'Second/export-index.md']); expect(created.failed).toEqual([]);
		expect(vault.files.get('Second/export-index.md')).toContain('[Second/b.txt](<b.txt>)');
	});
	it('omits the index after a partial output failure', async () => {
		enablePro(); const p = plugin(); const vault = memoryVault({}, ['Exports/b.txt']); p.vaultPort = () => vault;
		const plan = p.makePlan('```text file="a.txt"\nA\n```\n```text file="b.txt"\nB\n```', 'Exports');
		const result = await p.createExport(plan, 'Notes/Source.md', true);
		expect(result.completed).toEqual(['Exports/a.txt']); expect(result.failed.map((f) => f.path)).toEqual(['Exports/b.txt', 'Exports/export-index.md']);
		expect(vault.files.has('Exports/export-index.md')).toBe(false);
	});
	it('keeps an index that appears after preview', async () => {
		enablePro(); const p = plugin(); const vault = memoryVault({ 'Exports': 'folder', 'Exports/export-index.md': 'file' }); p.vaultPort = () => vault;
		const plan = p.makePlan('```text file="a.txt"\nA\n```', 'Exports');
		const result = await p.createExport(plan, 'Notes/Source.md', true);
		expect(result.failed).toEqual([{ path: 'Exports/export-index.md', reason: 'Target exists' }]);
	});
});
