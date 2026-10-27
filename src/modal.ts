import { Modal, Notice, Setting, type ButtonComponent, type ToggleComponent } from 'obsidian';
import { PRO_INDEX, PRO_PROFILES, isPro, onProChange, proNotice } from './pro';
import { conflict, indexTarget, TARGET_LIMIT, type Plan } from './export';
import type FenceFileExportPlugin from './main';

export class ExportModal extends Modal {
	private plan: Plan | null = null;
	private folder: string;
	private index = false;
	private createButton: ButtonComponent | null = null;
	private previewEl!: HTMLElement;
	private stop: (() => void) | null = null;
	private busy = false;
	constructor(private plugin: FenceFileExportPlugin, private sourcePath: string, private source: string, private closed: () => void) {
		super(plugin.app); this.folder = plugin.settings.folder;
	}
	onOpen(): void {
		this.setTitle('Export named code blocks'); this.modalEl.addClass('fence-file-export-modal');
		const el = this.contentEl;
		let indexControl: ToggleComponent;
		el.createEl('p', { text: `Source: ${this.sourcePath}`, cls: 'ffe-source' });
		new Setting(el).setName('Output folder').setDesc('A visible folder inside this vault. Only new files are created.').addText((t) => t.setValue(this.folder).onChange((value) => { this.folder = value; this.invalidate(); }));
		new Setting(el).setName('Folder profiles (pro)').addDropdown((d) => {
			d.addOption('', 'Choose a saved profile');
			for (const p of this.plugin.settings.profiles) d.addOption(p.name, p.name);
			const current = this.plugin.settings.profiles.find((p) => p.folder === this.folder)?.name ?? '';
			// Free users can select a saved profile: it shows what Pro adds and how to get it. The folder does not change.
			d.setValue(current).onChange((name) => {
				if (!isPro()) { d.setValue(current); if (name) proNotice(PRO_PROFILES); return; }
				if (this.busy) return;
				const profile = this.plugin.settings.profiles.find((p) => p.name === name);
				if (profile) { this.folder = profile.folder; this.contentEl.empty(); this.stop?.(); this.onOpen(); }
			});
		});
		let profileName = '';
		new Setting(el).setName('Save folder profile (pro)').addText((t) => t.setPlaceholder('Profile name').onChange((value) => { profileName = value; })).addButton((b) => { b.buttonEl.addClass('ffe-save-profile'); b.setButtonText('Save profile').onClick(async () => {
			// Free users can select the button: it shows what Pro adds and how to get it.
			if (!isPro()) { proNotice(PRO_PROFILES); return; }
			if (this.busy) return;
			try { if (await this.plugin.saveProfile(profileName, this.folder)) new Notice('Folder profile saved. Reopen this window to select it.'); }
			catch (error) { new Notice(`Cannot save the profile: ${String(error)}`); }
		}); });
		new Setting(el).setName('Export index (pro)').setDesc('Create export-index.md with links to the source and completed output files.').addToggle((t) => {
			indexControl = t;
			t.setValue(this.index).onChange((value) => {
				// Free users can turn the switch on: it shows what Pro adds and goes back to off.
				if (value && !isPro()) { proNotice(PRO_INDEX); t.setValue(false); return; }
				// t.setValue(false) above calls onChange(false) again. The index is already off, so the preview and Create stay.
				if (!value && !this.index) return;
				this.index = value && isPro(); this.invalidate();
			});
		});
		new Setting(el).addButton((b) => { b.buttonEl.addClass('ffe-preview-button'); b.setButtonText('Preview').setCta().onClick(() => { if (!this.busy) this.preview(); }); }).addButton((b) => {
			this.createButton = b; b.buttonEl.addClass('ffe-create'); b.setButtonText('Create new files').setDisabled(true).onClick(async () => { await this.create(); });
		});
		this.previewEl = el.createDiv({ cls: 'ffe-preview' });
		this.stop = onProChange(() => {
			this.index = false; indexControl.setValue(false); this.invalidate();
		});
		this.preview();
	}
	private invalidate(): void {
		this.plan = null; this.createButton?.setDisabled(true);
		if (this.previewEl && !this.busy) { this.previewEl.empty(); this.previewEl.createEl('p', { text: 'Select preview to check the new options.' }); }
	}
	preview(): void {
		this.previewEl.empty();
		const plan = this.plugin.makePlan(this.source, this.folder);
		if (this.index && isPro() && plan.targets.length) {
			const target = indexTarget(plan.folder, this.sourcePath, plan.targets);
			const reason = plan.targets.length >= TARGET_LIMIT ? 'Index exceeds the 100 target limit' : plan.targets.some((t) => t.path.toLowerCase() === target.path.toLowerCase() || t.path.toLowerCase().startsWith(target.path.toLowerCase() + '/')) ? 'Index conflicts with an output target' : conflict(target.path, this.plugin.vaultPort());
			if (reason) plan.error = reason;
		}
		this.plan = plan;
		this.previewEl.createEl('p', { text: `${plan.targets.length} output targets · ${plan.rejected.length} rejected blocks · ${plan.skipped} unnamed blocks skipped`, cls: 'ffe-summary' });
		if (plan.error) this.previewEl.createEl('p', { text: plan.error, cls: 'ffe-error' });
		for (const target of plan.targets) this.showTarget(target.path, target.text);
		if (this.index && isPro() && plan.targets.length && !plan.error) { const target = indexTarget(plan.folder, this.sourcePath, plan.targets); this.showTarget(target.path, target.text); }
		if (plan.rejected.length) {
			new Setting(this.previewEl).setName('Rejected blocks').setHeading();
			for (const rejected of plan.rejected) this.previewEl.createEl('p', { text: `${rejected.line ? `Line ${rejected.line}: ` : ''}${rejected.path || '(no valid file attribute)'} — ${rejected.reason}`, cls: 'ffe-rejection' });
		}
		if (!plan.targets.length && !plan.error) this.previewEl.createEl('p', { text: 'No new output files. Check the attributes and rejected blocks.' });
		this.createButton?.setDisabled(!!plan.error || !plan.targets.length);
	}
	private showTarget(path: string, text: string): void {
		const card = this.previewEl.createDiv({ cls: 'ffe-target' });
		card.createEl('strong', { text: path, cls: 'ffe-target-path' });
		card.createEl('pre', { text, cls: 'ffe-output' });
	}
	async create(): Promise<void> {
		const plan = this.plan;
		if (!plan || plan.error || !plan.targets.length || this.busy) return;
		this.busy = true; this.plan = null; this.createButton?.setDisabled(true);
		try {
			const result = await this.plugin.createExport(plan, this.sourcePath, this.index);
			this.previewEl.empty();
			new Setting(this.previewEl).setName('Export result').setHeading();
			this.previewEl.createEl('p', { text: 'This batch is not atomic. Completed files remain if another write fails.' });
			for (const path of result.completed) this.previewEl.createEl('p', { text: `Created: ${path}`, cls: 'ffe-completed' });
			for (const failed of result.failed) this.previewEl.createEl('p', { text: `Failed: ${failed.path} — ${failed.reason}`, cls: 'ffe-failed' });
			if (plan.rejected.length) this.previewEl.createEl('p', { text: `${plan.rejected.length} rejected blocks were not written.` });
			this.plugin.settings.folder = plan.folder; await this.plugin.saveSettings();
		} catch (error) { this.previewEl.createEl('p', { text: `Export stopped: ${String(error)}`, cls: 'ffe-failed' }); }
		finally { this.busy = false; }
	}
	onClose(): void { this.stop?.(); this.stop = null; this.contentEl.empty(); this.closed(); }
}
