import { browser, expect } from '@wdio/globals';
import { obsidianPage } from 'wdio-obsidian-service';
import type FenceFileExportPlugin from '../../src/main';

const fence = (path: string, body: string) => `\`\`\`text file="${path}"\n${body}\`\`\`\n`;
async function open(source: string, folder: string): Promise<void> {
	await browser.executeObsidian(({ app }, folder) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, FenceFileExportPlugin> } }).plugins.plugins['fence-file-export']!;
		const live = (p as unknown as { modals: Set<{ close(): void }> }).modals;
		for (const modal of [...live]) modal.close();
		p.settings.folder = folder;
	}, folder);
	await browser.waitUntil(async () => (await browser.$$('.fence-file-export-modal').length) === 0);
	const sourcePath = `${folder}-source.md`;
	await obsidianPage.write(sourcePath, source); await obsidianPage.openFile(sourcePath);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, path) => app.workspace.getActiveFile()?.path === path, sourcePath));
	await browser.executeObsidianCommand('fence-file-export:preview-export');
	await browser.$('.fence-file-export-modal .ffe-summary').waitForExist();
	await browser.waitUntil(async () => (await browser.$('.ffe-source').getText()).endsWith(sourcePath));
}
async function create(): Promise<void> {
	await browser.$('.fence-file-export-modal .ffe-create').waitForEnabled();
	await browser.$('.fence-file-export-modal .ffe-create').click();
	await browser.waitUntil(async () => (await browser.$$('.ffe-completed').length) + (await browser.$$('.ffe-failed').length) > 0);
}
async function read(path: string): Promise<string | null> {
	return browser.executeObsidian(async ({ app, obsidian }, path) => {
		const file = app.vault.getAbstractFileByPath(path);
		return file instanceof obsidian.TFile ? await app.vault.read(file) : null;
	}, path);
}
async function turnProOn(): Promise<void> {
	await browser.executeObsidian(async ({ app }) => {
		const p = (app as unknown as { plugins: { plugins: Record<string, FenceFileExportPlugin> } }).plugins.plugins['fence-file-export']!;
		const pro = p.pro! as unknown as { opts: { http: () => Promise<unknown> }; refreshNow(): Promise<unknown> };
		pro.opts.http = async () => ({ status: 200, json: { data: { viewer: { login: 'demo-reader' }, user: { sponsorshipForViewerAsSponsor: { isActive: true, isOneTimePayment: false, tier: { name: '$5 a month', monthlyPriceInCents: 500 } } } } } });
		app.secretStorage.setSecret('fence-file-export-github-token', 'gho_' + '0'.repeat(36)); await pro.refreshNow();
	});
}
describe('Local file export', () => {
	afterEach(async () => {
		await browser.executeObsidian(({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, FenceFileExportPlugin> } }).plugins.plugins['fence-file-export']!;
			p.pro?.signOut();
			const live = (p as unknown as { modals: Set<{ close(): void }> }).modals;
		for (const modal of [...live]) modal.close();
		});
	});
	it('previews joined text and creates new files and parent folders', async () => {
		await open(fence('main.py', 'A\n') + fence('main.py', 'B\n') + '~~~yaml file="config/app.yml"\nport: 8080\n~~~~\n', 'E2ECore');
		expect(await browser.$$('.ffe-target-path').map((el) => el.getText())).toEqual(['E2ECore/main.py', 'E2ECore/config/app.yml']);
		expect(await browser.$('.ffe-output').getText()).toContain('A\n\nB'); await create();
		expect(await read('E2ECore/main.py')).toBe('A\n\nB\n'); expect(await read('E2ECore/config/app.yml')).toBe('port: 8080\n');
	});
	it('shows rejected blocks before writing valid text', async () => {
		await open(fence('../private.txt', 'bad\n') + '> ```text file="nested.txt"\n> bad\n> ```\n' + fence('valid.txt', '<script>text only</script>\n'), 'E2EReject');
		expect(await browser.$$('.ffe-rejection')).toHaveLength(2);
		expect(await browser.execute(() => document.querySelector('.ffe-output script') === null)).toBe(true);
		await create(); expect(await read('E2EReject/valid.txt')).toBe('<script>text only</script>\n');
		expect(await read('private.txt')).toBe(null); expect(await read('E2EReject/nested.txt')).toBe(null);
	});
	it('keeps a target that appears after preview', async () => {
		await open(fence('late.txt', 'replace\n'), 'E2ERace');
		await browser.executeObsidian(async ({ app }) => { await app.vault.createFolder('E2ERace'); await app.vault.create('E2ERace/late.txt', 'keep me'); });
		await create(); expect(await browser.$('.ffe-failed').getText()).toContain('E2ERace/late.txt'); expect(await read('E2ERace/late.txt')).toBe('keep me');
	});
	it('reports an existing target and a parent file', async () => {
		await browser.executeObsidian(async ({ app }) => { await app.vault.createFolder('E2EConflict'); await app.vault.create('E2EConflict/a.txt', 'keep'); await app.vault.create('E2EConflict/config', 'parent file'); });
		await open(fence('a.txt', 'replace\n') + fence('config/a.txt', 'replace\n'), 'E2EConflict');
		expect(await browser.$$('.ffe-rejection')).toHaveLength(2); expect(await browser.$('.fence-file-export-modal .ffe-create').isEnabled()).toBe(false);
		expect(await read('E2EConflict/a.txt')).toBe('keep'); expect(await read('E2EConflict/config')).toBe('parent file');
	});
	it('reports partial completion with the network transport disabled', async () => {
		await open(fence('a.txt', 'A\n') + fence('b.txt', 'B\n'), 'E2EPartial');
		await browser.executeObsidian(({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, FenceFileExportPlugin> } }).plugins.plugins['fence-file-export']!;
			const originalPort = p.vaultPort.bind(p);
			p.vaultPort = () => { const port = originalPort(); return { ...port, create: (path, text) => path.endsWith('/b.txt') ? Promise.reject(new Error('Injected local write failure')) : port.create(path, text) }; };
			const pro = p.pro! as unknown as { opts: { http: () => Promise<unknown> } };
			pro.opts.http = () => Promise.reject(new Error('Network disabled'));
			(window as unknown as { restoreFencePort: () => void }).restoreFencePort = () => { p.vaultPort = originalPort; };
		});
		try {
			await create(); expect(await browser.$('.ffe-completed').getText()).toContain('E2EPartial/a.txt'); expect(await browser.$('.ffe-failed').getText()).toContain('E2EPartial/b.txt');
			expect(await read('E2EPartial/a.txt')).toBe('A\n'); expect(await read('E2EPartial/b.txt')).toBe(null);
		} finally { await browser.execute(() => (window as unknown as { restoreFencePort: () => void }).restoreFencePort()); }
	});
	it('keeps Pro controls disabled when signed out', async () => {
		await open(fence('a.txt', 'A\n'), 'E2EFree');
		expect(await browser.$('.fence-file-export-modal .ffe-save-profile').isEnabled()).toBe(false); expect(await browser.$('.fence-file-export-modal select').isEnabled()).toBe(false);
		await create(); expect(await read('E2EFree/export-index.md')).toBe(null);
	});
	it('saves a folder profile and creates the previewed index with Pro', async () => {
		await turnProOn(); await open(fence('a.txt', 'A\n'), 'E2EPro');
		await browser.$('input[placeholder="Profile name"]').setValue('Release'); await browser.$('.fence-file-export-modal .ffe-save-profile').click();
		await browser.waitUntil(async () => browser.executeObsidian(({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, FenceFileExportPlugin> } }).plugins.plugins['fence-file-export']!;
			return p.settings.profiles.some((profile) => profile.name === 'Release' && profile.folder === 'E2EPro');
		}));
		await browser.$('.fence-file-export-modal .checkbox-container').click(); await browser.$('.fence-file-export-modal .ffe-preview-button').click();
		expect(await browser.$$('.ffe-target-path').map((el) => el.getText())).toEqual(['E2EPro/a.txt', 'E2EPro/export-index.md']);
		await create(); expect(await read('E2EPro/export-index.md')).toContain('[E2EPro/a.txt](<a.txt>)');
	});
	it('exports a filename with attribute text and an empty CRLF block', async () => {
		await open('```text file="my file=sample.txt"\r\n```\r\n```text file="my file=sample.txt"\r\nA\r\n```', 'E2EReview');
		expect(await browser.$('.ffe-target-path').getText()).toBe('E2EReview/my file=sample.txt');
		await create(); expect(await read('E2EReview/my file=sample.txt')).toBe('\r\nA\r\n');
	});
	it('clears the visible index switch when Pro refresh clears the option', async () => {
		await turnProOn(); await open(fence('a.txt', 'A\n'), 'E2EReviewPro');
		await browser.$('.fence-file-export-modal .checkbox-container').click();
		await browser.$('.fence-file-export-modal .ffe-preview-button').click();
		expect(await browser.$$('.ffe-target-path')).toHaveLength(2);
		await browser.executeObsidian(async ({ app }) => {
			const p = (app as unknown as { plugins: { plugins: Record<string, FenceFileExportPlugin> } }).plugins.plugins['fence-file-export']!;
			await p.pro!.refreshNow();
		});
		expect(await browser.execute(() => document.querySelector('.fence-file-export-modal .checkbox-container')?.classList.contains('is-enabled'))).toBe(false);
		await browser.$('.fence-file-export-modal .ffe-preview-button').click();
		expect(await browser.$$('.ffe-target-path')).toHaveLength(1);
	});
});
