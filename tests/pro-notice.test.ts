import { afterEach, describe, expect, it, vi } from 'vitest';
import { App, Notice, ToggleComponent } from 'obsidian-test-mocks/obsidian';
import type { SponsorsManager } from '../src/license/index';
import FenceFileExportPlugin from '../src/main';
import { ExportModal } from '../src/modal';
import { bindPro, resetPro } from '../src/pro';
import manifest from '../manifest.json';

const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

function fakePro(pro: boolean): SponsorsManager {
	return {
		isPro: () => pro,
		onChange: () => () => undefined,
		hasToken: () => false,
		isChecking: () => false,
		getState: () => ({ status: 'unchecked', lastAttemptAt: 0 }),
		config: { sponsorLogin: 'theluckystrike', source: 'fence-file-export' },
	} as unknown as SponsorsManager;
}

function setup(pro: boolean) {
	const app = App.createConfigured__({ files: { 'Source.md': '# Source' } });
	const p = new FenceFileExportPlugin(app as never, manifest as never);
	p.saveSettings = vi.fn(async () => undefined);
	bindPro(fakePro(pro));
	const shown: { text: string; buttons: number }[] = [];
	vi.spyOn(Notice.prototype as unknown as { constructor__(): void }, 'constructor__').mockImplementation(function (this: Notice) {
		shown.push({ text: this.messageEl.textContent ?? '', buttons: this.messageEl.querySelectorAll('.pf-pro-notice-sponsor').length });
	});
	let toggle!: ToggleComponent;
	vi.spyOn(ToggleComponent.prototype, 'constructor3__').mockImplementation(function (this: ToggleComponent) { toggle = this; });
	const modal = new ExportModal(p, 'Source.md', '```text file="a.txt"\nA\n```', () => undefined);
	modal.onOpen();
	const input = modal.contentEl.querySelector<HTMLInputElement>('input[placeholder="Profile name"]')!;
	input.value = 'Release'; input.dispatchEvent(new Event('input'));
	return { p, modal, toggle, shown, save: modal.contentEl.querySelector<HTMLButtonElement>('.ffe-save-profile')! };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Pro controls in the export window', () => {
	afterEach(() => { resetPro(); vi.restoreAllMocks(); });

	it('a free user who selects Save profile or Export index gets the Pro notice with a Sponsor button, and no Pro action runs', async () => {
		const { p, modal, toggle, shown, save } = setup(false);
		expect(save.disabled).toBe(false);
		expect(toggle.disabled).toBe(false);
		save.click(); await flush();
		toggle.onClick(); modal.preview();
		expect(p.settings.profiles).toEqual([]);
		expect(p.saveSettings).not.toHaveBeenCalled();
		expect(toggle.getValue()).toBe(false);
		expect(modal.contentEl.querySelectorAll('.ffe-target-path')).toHaveLength(1);
		expect(shown).toEqual([
			{ text: `Folder profiles need Pro. ${PITCH}Sponsor on GitHub`, buttons: 1 },
			{ text: `The export index needs Pro. ${PITCH}Sponsor on GitHub`, buttons: 1 },
		]);
		modal.onClose();
	});

	it('a free user who selects Export index after a preview keeps the preview and the Create button', () => {
		const { modal, toggle, shown } = setup(false);
		const create = modal.contentEl.querySelector<HTMLButtonElement>('.ffe-create')!;
		const preview = modal.contentEl.querySelector('.ffe-preview')!;
		const before = { create: create.disabled, text: preview.textContent, targets: preview.querySelectorAll('.ffe-target-path').length };
		expect(before).toMatchObject({ create: false, targets: 1 });
		toggle.onClick();
		expect(toggle.getValue()).toBe(false);
		expect(shown).toHaveLength(1);
		expect({ create: create.disabled, text: preview.textContent, targets: preview.querySelectorAll('.ffe-target-path').length }).toEqual(before);
		modal.onClose();
	});

	it('a Pro user who selects Save profile and Export index saves the profile and plans the index', async () => {
		const { p, modal, toggle, shown, save } = setup(true);
		save.click(); await flush();
		toggle.onClick(); modal.preview();
		expect(p.settings.profiles).toEqual([{ name: 'Release', folder: p.settings.folder }]);
		expect(toggle.getValue()).toBe(true);
		expect(modal.contentEl.querySelectorAll('.ffe-target-path')).toHaveLength(2);
		expect(shown.some((n) => n.buttons > 0)).toBe(false);
		modal.onClose();
	});
});
