import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Modal, ToggleComponent } from 'obsidian-test-mocks/obsidian';
import { requestUrl } from 'obsidian';
import FenceFileExportPlugin from '../src/main';
import { planExport } from '../src/export';
import { ExportModal } from '../src/modal';
import { bindPro, resetPro } from '../src/pro';
import { memoryVault } from './vault';
import manifest from '../manifest.json';

vi.mock('obsidian', async (importOriginal) => ({
	...await importOriginal<typeof import('obsidian')>(),
	requestUrl: vi.fn(),
}));

afterEach(() => { resetPro(); vi.restoreAllMocks(); vi.mocked(requestUrl).mockReset(); });

function plugin() {
	const app = App.createConfigured__({ files: { 'Source.md': '# Source' } });
	return { app, plugin: new FenceFileExportPlugin(app as never, manifest as never) };
}

describe('Review regression cases', () => {
	it('accepts attribute text inside a quoted filename', () => {
		const plan = planExport('```text file="my file=sample.txt"\nA\n```', 'Exports');
		expect(plan.rejected).toEqual([]);
		expect(plan.targets).toEqual([{ path: 'Exports/my file=sample.txt', text: 'A\n' }]);
	});
	it('keeps CRLF for the separator after an empty first body', () => {
		const source = '```text file="a.txt"\r\n```\r\n```text file="a.txt"\r\nA\r\n```';
		expect(planExport(source, 'Exports').targets).toEqual([{ path: 'Exports/a.txt', text: '\r\nA\r\n' }]);
	});
	it('does not open a modal when a read ends after unload', async () => {
		const { app, plugin: p } = plugin();
		let finish!: (text: string) => void;
		vi.spyOn(app.vault, 'read').mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
		const open = vi.spyOn(Modal.prototype, 'open').mockImplementation(() => undefined);
		const pending = p.openExport(app.vault.getFileByPath('Source.md')! as never);
		p.onunload(); finish('```text file="a.txt"\nA\n```');
		await pending;
		expect(open).not.toHaveBeenCalled();
	});
	it('does not start an interval when layout becomes ready after unload', async () => {
		const { app, plugin: p } = plugin();
		let ready!: () => void;
		vi.spyOn(app.workspace, 'onLayoutReady').mockImplementation((callback) => { ready = callback; });
		const interval = vi.spyOn(window, 'setInterval').mockReturnValue(1);
		await p.onload(); p.onunload(); ready();
		expect(interval).not.toHaveBeenCalled();
	});
	it('shows the cleared index option after a Pro refresh', () => {
		const { plugin: p } = plugin();
		let pro = true;
		let changed!: () => void;
		bindPro({ isPro: () => pro, onChange: (callback: () => void) => { changed = callback; return () => undefined; } } as never);
		let toggle!: ToggleComponent;
		vi.spyOn(ToggleComponent.prototype, 'constructor3__').mockImplementation(function () { toggle = this; });
		const modal = new ExportModal(p, 'Source.md', '```text file="a.txt"\nA\n```', () => undefined);
		modal.onOpen(); toggle.onClick(); modal.preview(); changed();
		expect(toggle.getValue()).toBe(false);
		pro = false; changed();
		// Free users can select the Pro controls: a click shows the Pro notice (tests/pro-notice.test.ts).
		expect(modal.contentEl.querySelector('select')?.disabled).toBe(false);
		expect(modal.contentEl.querySelector<HTMLButtonElement>('.ffe-save-profile')?.disabled).toBe(false);
		expect(toggle.disabled).toBe(false);
		pro = true; changed(); expect(toggle.disabled).toBe(false);
		modal.onClose();
	});
	it.each([99, 100])('counts the index in the target limit with %i output files', async (count) => {
		const { plugin: p } = plugin();
		bindPro({ isPro: () => true, onChange: () => () => undefined } as never);
		let toggle!: ToggleComponent;
		vi.spyOn(ToggleComponent.prototype, 'constructor3__').mockImplementation(function () { toggle = this; });
		const source = Array.from({ length: count }, (_, i) => `\`\`\`text file="${i}.txt"\nA\n\`\`\`\n`).join('');
		const vault = memoryVault(); p.vaultPort = () => vault; p.saveSettings = vi.fn(async () => undefined);
		const modal = new ExportModal(p, 'Source.md', source, () => undefined);
		modal.onOpen(); toggle.onClick(); modal.preview();
		expect(modal.contentEl.querySelector<HTMLButtonElement>('.ffe-create')?.disabled).toBe(count === 100);
		await modal.create();
		expect(vault.files.size).toBe(count === 99 ? 100 : 0);
		modal.onClose();
	});
	it.each([
		'file="a.txt" file="b.txt"',
		'file="a.txt"file="b.txt"',
		'file=\'prefix file="a.txt" suffix\'',
		'file = "a.txt"',
	])('rejects malformed or duplicate attributes %s', (info) => {
		const plan = planExport('```text ' + info + '\nA\n```', 'Exports');
		expect(plan.targets).toEqual([]);
		expect(plan.rejected).toHaveLength(1);
	});
	it('keeps free export local after plugin load with no token', async () => {
		const { app, plugin: p } = plugin();
		vi.spyOn(app.workspace, 'onLayoutReady').mockImplementation((callback) => { callback(); });
		vi.spyOn(window, 'setInterval').mockReturnValue(1);
		const request = vi.mocked(requestUrl).mockRejectedValue(new Error('Offline'));
		await p.onload();
		const vault = memoryVault(); p.vaultPort = () => vault;
		const plan = p.makePlan('```text file="a.txt"\nA\n```', 'Exports');
		expect(await p.createExport(plan, 'Source.md', false)).toEqual({ completed: ['Exports/a.txt'], failed: [] });
		expect(request).not.toHaveBeenCalled();
		p.onunload();
	});
	it('shows HTML as complete text and writes the source snapshot', async () => {
		const { app, plugin: p } = plugin();
		const body = '<script>window.bad = true</script>\n' + 'A'.repeat(10000) + '\n';
		const source = '```html file="a.html"\n' + body + '```';
		const vault = memoryVault(); p.vaultPort = () => vault; p.saveSettings = vi.fn(async () => undefined);
		const modal = new ExportModal(p, 'Source.md', source, () => undefined);
		modal.onOpen();
		expect(modal.contentEl.querySelector('script')).toBeNull();
		expect(modal.contentEl.querySelector('pre')?.textContent).toBe(body);
		await app.vault.modify(app.vault.getFileByPath('Source.md')!, 'Later note text');
		await modal.create();
		expect(vault.files.get('Exports/a.html')).toBe(body);
		modal.onClose();
	});
});
