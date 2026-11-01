import { App } from 'obsidian';
import { t } from '../i18n';
import { ErtModal } from '../ui/ErtModal';
import { setAccessibleLabel } from '../utils/domTooltip';
import type { PanelFocus } from './panelFocus';

/** Select a focal point using the uncropped image. */
export class PanelFocusModal extends ErtModal {
    private point: PanelFocus;
    constructor(app: App, private readonly url: string, initial: PanelFocus, private readonly save: (point: PanelFocus) => void) {
        super(app); this.point = { ...initial };
    }
    onOpen(): void {
        this.applyShell({ size: 'md' });
        this.mountHeader({ title: t('ui.timetable.panelFocusTitle'), subtitle: t('ui.timetable.panelFocusHelp') });
        const frame = this.contentEl.createDiv({ cls: 'ert-panel-focus-frame' });
        const preview = frame.createDiv({ cls: 'ert-panel-focus-image' });
        const image = preview.createEl('img', { attr: { src: this.url, alt: '', draggable: 'false' } });
        const marker = preview.createSpan({ cls: 'ert-panel-focus-marker', attr: { 'aria-hidden': 'true' } });
        const controls = this.contentEl.createDiv({ cls: 'ert-panel-focus-controls' });
        const slider = (label: string): HTMLInputElement => {
            const wrapper = controls.createEl('label', { text: label });
            const input = wrapper.createEl('input', { type: 'range', attr: { min: '0', max: '100', step: '1' } });
            setAccessibleLabel(input, label);
            return input;
        };
        const horizontal = slider(t('ui.timetable.panelFocusHorizontal'));
        const vertical = slider(t('ui.timetable.panelFocusVertical'));
        const refresh = () => {
            marker.setCssProps({ '--ert-focus-x': `${this.point.x * 100}%`, '--ert-focus-y': `${this.point.y * 100}%` });
            horizontal.value = String(Math.round(this.point.x * 100)); vertical.value = String(Math.round(this.point.y * 100));
        };
        image.addEventListener('click', event => {
            const rect = image.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            this.point = { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) }; refresh();
        });
        horizontal.addEventListener('input', () => { this.point.x = Number(horizontal.value) / 100; refresh(); });
        vertical.addEventListener('input', () => { this.point.y = Number(vertical.value) / 100; refresh(); });
        refresh();
        const actions = this.mountActions();
        actions.createEl('button', { text: t('ui.timetable.panelFocusReset') }).addEventListener('click', () => { this.point = { x: 0.5, y: 0.5 }; refresh(); });
        actions.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => this.close());
        actions.createEl('button', { text: t('common.save'), cls: 'ert-panel-focus-save mod-cta' }).addEventListener('click', () => { this.save(this.point); this.close(); });
    }
}
