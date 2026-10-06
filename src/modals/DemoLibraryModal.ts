import { App, Notice, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ErtModal } from '../ui/ErtModal';
import { BONUS_VAULTS, type BonusVaultDef } from '../settings/bonusVaults';
import { DEMO_PROJECTS_FOLDER, demoProjectFolder } from '../demoVaults/demoImportPlan';
import { importDemoVault } from '../demoVaults/importDemoVault';

/** A direct route from an empty vault to a finished, browsable project. */
export class DemoLibraryModal extends ErtModal {
    private busy = false;
    private visible = false;
    private status!: HTMLElement;
    private busyIndicator!: HTMLElement;
    private buttons: HTMLButtonElement[] = [];

    constructor(app: App, private plugin: RadialTimelinePlugin) { super(app); }

    onOpen(): void {
        this.visible = true;
        this.contentEl.empty();
        this.buttons = [];
        this.applyShell({ size: 'lg', width: 'min(960px, 92vw)', containerClasses: ['ert-demo-library'] });
        this.mountHeader({
            title: 'Explore a finished book',
            subtitle: 'Add a free demo to this vault. Browse the scenes, beats, Pulse, Gossamer, and saved Inquiry briefings without an API key.'
        });
        const statusRow = this.contentEl.createEl('p', {
            cls: 'ert-modal-subtitle ert-demo-library__status',
            attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }
        });
        this.busyIndicator = statusRow.createSpan({ cls: 'ert-demo-library__busy', attr: { 'aria-hidden': 'true' } });
        this.busyIndicator.toggleClass('ert-hidden', !this.busy);
        for (let index = 0; index < 3; index++) this.busyIndicator.createSpan({ cls: 'ert-demo-library__busy-dot' });
        this.status = statusRow.createSpan();
        this.status.setText(`Demos are added under ${DEMO_PROJECTS_FOLDER}. Existing files are preserved.`);
        const grid = this.contentEl.createDiv({ cls: 'ert-demo-library__grid' });
        BONUS_VAULTS.filter(demo => demo.books?.length).forEach(demo => this.mountDemo(grid, demo));
        const close = this.mountActions().createEl('button', { cls: 'ert-btn', text: 'Close', attr: { type: 'button' } });
        close.addEventListener('click', () => this.close());
    }

    private mountDemo(grid: HTMLElement, demo: BonusVaultDef): void {
        const installed = !!this.app.vault.getAbstractFileByPath(demoProjectFolder(demo));
        const available = demo.status === 'available' && !!demo.archive;
        const card = grid.createDiv({ cls: 'ert-demo-library__card ert-panel ert-stack' });
        const icon = card.createDiv({ cls: 'ert-demo-library__icon' });
        setIcon(icon, demo.id === 'odyssey' ? 'ship' : demo.id === 'sherlock-holmes' ? 'search' : 'book-open');
        card.createEl('h3', { text: demo.title });
        card.createEl('p', { cls: 'ert-modal-subtitle', text: `${demo.author} · ${demo.countLabel}` });
        card.createEl('p', { text: demo.description });
        const button = card.createEl('button', {
            cls: 'ert-btn ert-btn--standard-pro',
            text: installed ? 'Open demo' : available ? 'Add demo to this vault' : 'Coming soon',
            attr: { type: 'button' }
        });
        button.disabled = !installed && !available;
        button.setAttr('aria-label', `${button.textContent}: ${demo.title}`);
        this.buttons.push(button);
        button.addEventListener('click', () => { void this.addDemo(demo); });
        if (available && demo.archive) {
            const download = card.createEl('a', {
                text: `Download ZIP (${(demo.archive.bytes / 1048576).toFixed(1)} MB)`,
                href: demo.archive.downloadUrl,
                attr: { target: '_blank', rel: 'noopener noreferrer' }
            });
            download.setAttr('aria-label', `Download ${demo.title} as a separate vault`);
        }
    }

    private async addDemo(demo: BonusVaultDef): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        this.busyIndicator.removeClass('ert-hidden');
        this.status.setText(`Preparing ${demo.title}…`);
        this.buttons.forEach(button => { button.disabled = true; });
        try {
            await importDemoVault(this.plugin, demo, text => { if (this.visible) this.status.setText(text); });
            this.close();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'The demo could not be added.';
            if (this.visible) this.status.setText(message);
            else new Notice(message);
        } finally {
            this.busy = false;
            if (this.visible) {
                // Rebuild to show Open demo when a completed import only needs setup retried.
                const message = this.status.textContent ?? '';
                this.onOpen();
                this.status.setText(message);
            }
        }
    }

    onClose(): void {
        this.visible = false;
        this.contentEl.empty();
    }
}
