import { App, Notice, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ErtModal } from '../ui/ErtModal';
import { BONUS_VAULTS, type BonusVaultDef } from '../settings/bonusVaults';
import { DEMO_PROJECTS_FOLDER, demoProjectFolder } from '../demoVaults/demoImportPlan';
import { importDemoVault } from '../demoVaults/importDemoVault';
import { t } from '../i18n';

/** A direct route from an empty vault to a finished, browsable project. */
export class DemoLibraryModal extends ErtModal {
    private busy = false;
    private visible = false;
    private status!: HTMLElement;
    private busyIndicator!: HTMLElement;
    private buttons: HTMLButtonElement[] = [];

    constructor(app: App, private plugin: RadialTimelinePlugin, private readonly selectedDemo?: BonusVaultDef) { super(app); }

    onOpen(): void {
        this.visible = true;
        this.contentEl.empty();
        this.buttons = [];
        this.applyShell({
            size: this.selectedDemo ? 'md' : 'lg',
            width: this.selectedDemo ? 'min(640px, 92vw)' : 'min(960px, 92vw)',
            containerClasses: ['ert-demo-library']
        });
        this.mountHeader({
            title: this.selectedDemo?.title ?? t('ui.demoLibraryModal.title'),
            subtitle: t('ui.demoLibraryModal.subtitle')
        });
        const statusRow = this.contentEl.createEl('p', {
            cls: 'ert-modal-subtitle ert-demo-library__status',
            attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }
        });
        this.busyIndicator = statusRow.createSpan({ cls: 'ert-demo-library__busy', attr: { 'aria-hidden': 'true' } });
        this.busyIndicator.toggleClass('ert-hidden', !this.busy);
        for (let index = 0; index < 3; index++) this.busyIndicator.createSpan({ cls: 'ert-demo-library__busy-dot' });
        this.status = statusRow.createSpan();
        this.status.setText(t('ui.demoLibraryModal.addedUnder', { folder: DEMO_PROJECTS_FOLDER }));
        const grid = this.contentEl.createDiv({ cls: 'ert-demo-library__grid' });
        const demos = this.selectedDemo ? [this.selectedDemo] : BONUS_VAULTS.filter(demo => demo.books?.length);
        demos.forEach(demo => this.mountDemo(grid, demo));
        const close = this.mountActions().createEl('button', { cls: 'ert-btn', text: t('ui.demoLibraryModal.close'), attr: { type: 'button' } });
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
            text: installed ? t('ui.demoLibraryModal.openDemo') : available ? t('ui.demoLibraryModal.addDemo') : t('ui.demoLibraryModal.comingSoon'),
            attr: { type: 'button' }
        });
        button.disabled = !installed && !available;
        button.setAttr('aria-label', `${button.textContent}: ${demo.title}`);
        this.buttons.push(button);
        button.addEventListener('click', () => { void this.addDemo(demo); });
        if (available && demo.archive) {
            const download = card.createEl('a', {
                text: t('ui.demoLibraryModal.downloadZip', { size: (demo.archive.bytes / 1048576).toFixed(1) }),
                href: demo.archive.downloadUrl,
                attr: { target: '_blank', rel: 'noopener noreferrer' }
            });
            download.setAttr('aria-label', t('ui.demoLibraryModal.downloadAria', { title: demo.title }));
        }
    }

    private async addDemo(demo: BonusVaultDef): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        this.busyIndicator.removeClass('ert-hidden');
        this.status.setText(t('ui.demoLibraryModal.preparing', { title: demo.title }));
        this.buttons.forEach(button => { button.disabled = true; });
        try {
            await importDemoVault(this.plugin, demo, text => { if (this.visible) this.status.setText(text); });
            this.close();
        } catch (error) {
            const message = error instanceof Error ? error.message : t('ui.demoLibraryModal.addFailed');
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
