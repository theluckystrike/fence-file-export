import { Notice, Plugin, TFile, TFolder } from 'obsidian';
import type { SponsorsManager } from './license/index';
import { createGitHubSponsors } from './license/github-obsidian';
import { SPONSORS, bindPro, isPro, resetPro } from './pro';
import { DEFAULT_SETTINGS, FenceFileExportSettingTab, normalizeSettings, type FenceFileExportSettings } from './settings';
import { ExportModal } from './modal';
import { planExport, preflight, writeTargets, indexTarget, conflict, pathError, type Plan, type WriteResult, type VaultPort } from './export';

export default class FenceFileExportPlugin extends Plugin {
	settings: FenceFileExportSettings = { ...DEFAULT_SETTINGS, profiles: [] };
	pro: SponsorsManager | null = null;
	private settingTab: FenceFileExportSettingTab | null = null;
	private modals = new Set<ExportModal>();
	private unloaded = false;
	async onload(): Promise<void> {
		this.unloaded = false;
		await this.loadSettings();
		if (this.unloaded) return;
		const pro = createGitHubSponsors(this.app, this.manifest.id, SPONSORS, this);
		pro.init(); this.pro = pro; bindPro(pro);
		this.settingTab = new FenceFileExportSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
		this.register(pro.onChange(() => this.settingTab?.update()));
		this.addCommand({
			id: 'preview-export', name: 'Preview named code blocks',
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== 'md') return false;
				if (!checking) void this.openExport(file);
				return true;
			},
		});
		this.app.workspace.onLayoutReady(() => {
			if (this.unloaded) return;
			void pro.refresh();
			this.registerInterval(window.setInterval(() => void pro.refresh(), 6 * 60 * 60 * 1000));
		});
	}
	onunload(): void { this.unloaded = true; for (const modal of this.modals) modal.close(); resetPro(); }
	async loadSettings(): Promise<void> { this.settings = normalizeSettings(await this.loadData() as Partial<FenceFileExportSettings> | null, this.app.vault.configDir); }
	async saveSettings(): Promise<void> { await this.saveData(this.settings); }
	vaultPort(): VaultPort {
		const vault = this.app.vault;
		return { configDir: vault.configDir, kind: (path) => {
			const entry = vault.getAbstractFileByPath(path);
			return entry instanceof TFolder ? 'folder' : entry ? 'file' : null;
		}, create: (path, text) => vault.create(path, text), createFolder: (path) => vault.createFolder(path) };
	}
	async openExport(file: TFile): Promise<void> {
		if (this.unloaded) return;
		try {
			const source = await this.app.vault.read(file);
			if (this.unloaded) return;
			const modal = new ExportModal(this, file.path, source, () => this.modals.delete(modal));
			this.modals.add(modal); modal.open();
		} catch (error) { new Notice(`Cannot read the note: ${error instanceof Error ? error.message : String(error)}`); }
	}
	makePlan(source: string, folder: string): Plan { return preflight(planExport(source, folder, this.app.vault.configDir), this.vaultPort()); }
	async saveProfile(name: string, folder: string): Promise<boolean> {
		if (!isPro()) { new Notice('Folder profiles need pro. Sign in from the plugin settings.'); return false; }
		if (!name.trim() || name.length > 80 || pathError(folder, this.app.vault.configDir)) { new Notice('Use a profile name of 1 to 80 characters and a valid folder.'); return false; }
		const found = this.settings.profiles.find((p) => p.name === name.trim());
		if (!found && this.settings.profiles.length >= 20) { new Notice('The limit is 20 profiles.'); return false; }
		if (found) found.folder = folder; else this.settings.profiles.push({ name: name.trim(), folder });
		await this.saveSettings(); return true;
	}
	async createExport(plan: Plan, sourcePath: string, index: boolean): Promise<WriteResult> {
		if (plan.error) return { completed: [], failed: [{ path: plan.folder, reason: plan.error }] };
		const port = this.vaultPort();
		const result = await writeTargets(plan.targets, port);
		if (index) {
			const target = indexTarget(plan.folder, sourcePath, plan.targets);
			const reason = !isPro() ? 'Export index needs Pro' : result.failed.length ? 'Index omitted because an output failed' : !plan.targets.length ? 'No outputs to index' : conflict(target.path, port);
			if (reason) result.failed.push({ path: target.path, reason });
			else {
				const written = await writeTargets([target], port);
				result.completed.push(...written.completed); result.failed.push(...written.failed);
			}
		}
		return result;
	}
}
