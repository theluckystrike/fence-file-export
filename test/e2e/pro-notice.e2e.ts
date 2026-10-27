import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type FenceFileExportPlugin from '../../src/main';

const PROFILES_LEAD = 'Folder profiles need Pro.';
const INDEX_LEAD = 'The export index needs Pro.';
const PITCH = 'Sponsor on GitHub, then sign in from the plugin settings.';

interface Shown { text: string; buttons: number }
const notices = (): Promise<Shown[]> => browser.executeObsidian(() => [...document.querySelectorAll('.notice')].map((n) => ({ text: n.textContent ?? '', buttons: n.querySelectorAll('.pf-pro-notice-sponsor').length })));

async function open(folder: string): Promise<void> {
	await browser.executeObsidian(({ app }, folder) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, FenceFileExportPlugin> } }).plugins.plugins['fence-file-export']!;
		for (const modal of [...(p as unknown as { modals: Set<{ close(): void }> }).modals]) modal.close();
		p.settings.folder = folder;
		document.querySelectorAll('.notice').forEach((n) => n.remove());
	}, folder);
	await browser.waitUntil(async () => (await browser.$$('.fence-file-export-modal').length) === 0);
	const sourcePath = `${folder}-source.md`;
	await obsidianPage.write(sourcePath, '```text file="a.txt"\nA\n```\n');
	await obsidianPage.openFile(sourcePath);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, path) => app.workspace.getActiveFile()?.path === path, sourcePath));
	await browser.executeObsidianCommand('fence-file-export:preview-export');
	await browser.$('.fence-file-export-modal .ffe-summary').waitForExist();
}

async function profiles(): Promise<{ name: string; folder: string }[]> {
	return browser.executeObsidian(({ app }) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, FenceFileExportPlugin> } }).plugins.plugins['fence-file-export']!;
		return p.settings.profiles.map((x) => ({ ...x }));
	});
}

describe('Pro notice for free users', () => {
	afterEach(async () => {
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, FenceFileExportPlugin> } }).plugins.plugins['fence-file-export']!;
			p.pro?.signOut();
			for (const modal of [...(p as unknown as { modals: Set<{ close(): void }> }).modals]) modal.close();
			p.settings.profiles = [];
			await p.saveSettings();
			document.querySelectorAll('.notice').forEach((n) => n.remove());
		});
	});

	it('a free user who selects Save profile or Export index gets a Pro notice with a Sponsor button and no Pro action', async () => {
		await browser.executeObsidian(({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, FenceFileExportPlugin> } }).plugins.plugins['fence-file-export']!;
			p.pro?.signOut();
		});
		await open('E2EFreeNotice');
		const save = browser.$('.fence-file-export-modal .ffe-save-profile');
		expect(await save.isEnabled()).toBe(true);
		await browser.$('.fence-file-export-modal input[placeholder="Profile name"]').setValue('Release');
		await save.click();
		await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(PROFILES_LEAD)), { timeout: 5000, timeoutMsg: 'No Pro notice after Save profile.' });
		const saved = (await notices()).find((n) => n.text.includes(PROFILES_LEAD))!;
		expect(saved.text).toContain(`${PROFILES_LEAD} ${PITCH}`);
		expect(saved.buttons).toBe(1);
		expect(await profiles()).toEqual([]);

		await browser.$('.fence-file-export-modal .checkbox-container').click();
		await browser.waitUntil(async () => (await notices()).some((n) => n.text.includes(INDEX_LEAD)), { timeout: 5000, timeoutMsg: 'No Pro notice after Export index.' });
		const index = (await notices()).find((n) => n.text.includes(INDEX_LEAD))!;
		expect(index.text).toContain(`${INDEX_LEAD} ${PITCH}`);
		expect(index.buttons).toBe(1);
		expect(await browser.execute(() => document.querySelector('.fence-file-export-modal .checkbox-container')?.classList.contains('is-enabled'))).toBe(false);
		await browser.$('.fence-file-export-modal .ffe-preview-button').click();
		expect(await browser.$$('.ffe-target-path').map((el) => el.getText())).toEqual(['E2EFreeNotice/a.txt']);
	});

	it('a Pro user who selects Save profile and Export index saves the profile and plans the index', async () => {
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, FenceFileExportPlugin> } }).plugins.plugins['fence-file-export']!;
			const pro = p.pro! as unknown as { opts: { http: () => Promise<unknown> }; refreshNow(): Promise<unknown> };
			pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
			app.secretStorage.setSecret('fence-file-export-github-token', 'gho_' + '0'.repeat(36));
			await pro.refreshNow();
		});
		await open('E2EProNotice');
		await browser.$('.fence-file-export-modal input[placeholder="Profile name"]').setValue('Release');
		await browser.$('.fence-file-export-modal .ffe-save-profile').click();
		await browser.waitUntil(async () => (await profiles()).some((x) => x.name === 'Release' && x.folder === 'E2EProNotice'), { timeout: 5000, timeoutMsg: 'The Pro user did not save the profile.' });
		await browser.$('.fence-file-export-modal .checkbox-container').click();
		expect(await browser.execute(() => document.querySelector('.fence-file-export-modal .checkbox-container')?.classList.contains('is-enabled'))).toBe(true);
		await browser.$('.fence-file-export-modal .ffe-preview-button').click();
		expect(await browser.$$('.ffe-target-path').map((el) => el.getText())).toEqual(['E2EProNotice/a.txt', 'E2EProNotice/export-index.md']);
		expect((await notices()).some((n) => n.buttons > 0)).toBe(false);
	});
});
