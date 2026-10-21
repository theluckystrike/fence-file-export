import { PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { sponsorsSettingItems } from './license/github-obsidian';
import { PRO_UI } from './pro';
import { pathError } from './export';
import type FenceFileExportPlugin from './main';
import { helloSettingItems } from './hello/settings';

export interface FenceFileExportSettings { folder: string; profiles: { name: string; folder: string }[] }
export const DEFAULT_SETTINGS: FenceFileExportSettings = { folder: 'Exports', profiles: [] };
export function normalizeSettings(saved: Partial<FenceFileExportSettings> | null | undefined, configDir = ''): FenceFileExportSettings {
	return {
		folder: typeof saved?.folder === 'string' && !pathError(saved.folder, configDir) ? saved.folder : 'Exports',
		profiles: Array.isArray(saved?.profiles) ? saved.profiles.filter((p) => p && typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 80 && typeof p.folder === 'string' && !pathError(p.folder, configDir)).slice(0, 20).map((p) => ({ name: p.name, folder: p.folder })) : [],
	};
}
export class FenceFileExportSettingTab extends PluginSettingTab {
	constructor(app: ConstructorParameters<typeof PluginSettingTab>[0], public plugin: FenceFileExportPlugin) { super(app, plugin); }
	getSettingDefinitions(): SettingDefinitionItem[] {
		// The product rows, then the "More from NoteMods" card (packages/hello).
		return [...this.productSettingDefinitions(), ...helloSettingItems()];
	}

	productSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ name: 'Output folder', desc: 'Default vault folder. You can change it in the export window.', control: { type: 'text', key: 'folder', defaultValue: 'Exports' } },
			...(this.plugin.pro ? sponsorsSettingItems(this.plugin.pro, PRO_UI) : []),
		];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		await super.setControlValue(key, value);
		this.plugin.settings = normalizeSettings(this.plugin.settings, this.app.vault.configDir);
		await this.plugin.saveSettings();
	}
}
