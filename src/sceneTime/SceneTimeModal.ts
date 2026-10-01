import { Notice, Setting, TFile, setIcon } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import { parseDuration, parseWhenField } from '../utils/date';
import { cueDescription, cueState, elapsedLabel, type TimeDecision } from './model';
import type { SceneTimeService } from './SceneTimeService';
import { t } from '../i18n';

export class SceneTimeModal extends ErtModal {
    constructor(private readonly service: SceneTimeService, private readonly file: TFile,
        private readonly source: () => string, private readonly selectedKey?: string) { super(service.plugin.app); }

    onOpen(): void {
        this.applyShell({ width: 'min(860px, 96vw)', containerClasses: ['ert-manuscript-surface', 'ert-scene-time-modal'] });
        this.render();
    }

    private render(focusKey = this.selectedKey): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ert-stack');
        this.titleEl.empty();
        this.mountHeader({ title: t('sceneTime.modal.title'), subtitle: t('sceneTime.modal.subtitle'), badge: { text: t('sceneTime.modal.badge', { scene: this.file.basename }) } });
        const snapshot = this.service.snapshot(this.file, this.source());
        if (!snapshot) { contentEl.createEl('p', { text: t('sceneTime.errors.notScene') }); return; }
        const metadata = this.service.metadata(this.file)!;
        const planned = typeof metadata.Duration === 'string' ? parseDuration(metadata.Duration) : null;
        const body = contentEl.createDiv({ cls: 'ert-card-stack' });
        const summary = body.createDiv({ cls: 'ert-glass-card ert-sub-card ert-stack' });
        const estimate = snapshot.estimated !== snapshot.elapsed ? ` · ${t('sceneTime.modal.summaryEstimated', { estimated: elapsedLabel(snapshot.estimated) })}` : '';
        summary.createEl('strong', { text: `${t('sceneTime.modal.summaryConfirmed', { elapsed: elapsedLabel(snapshot.elapsed) })}${estimate} · ${t('sceneTime.modal.summaryCues', { count: snapshot.cues.length })}` });
        summary.createDiv({ cls: 'ert-time-help', text: t('sceneTime.modal.help') });
        if (planned !== null && snapshot.confirmed) {
            const remaining = planned / 60000 - snapshot.elapsed;
            summary.createDiv({ cls: remaining < 0 ? 'ert-time-over' : '', text: remaining < 0
                ? t('sceneTime.modal.overDuration', { over: elapsedLabel(-remaining), duration: elapsedLabel(planned / 60000) })
                : t('sceneTime.modal.remainingDuration', { duration: elapsedLabel(planned / 60000), remaining: elapsedLabel(remaining) }) });
        }
        if (snapshot.conflict) summary.createDiv({ cls: 'ert-time-over', text: t('sceneTime.modal.conflict') });
        const legend = summary.createDiv({ cls: 'ert-time-legend' });
        for (const [state, label] of [['detected', t('sceneTime.legend.detected')], ['confirmed', t('sceneTime.legend.confirmed')], ['manual', `[10h] ${t('sceneTime.legend.manual')}`],
            ['uncertain', `? ${t('sceneTime.legend.uncertain')}`], ['backward', t('sceneTime.legend.backward')], ['excluded', t('sceneTime.legend.excluded')]]) {
            const item = legend.createSpan({ cls: `ert-time-legend-item ert-time-${state}` });
            if (state === 'backward') setIcon(item.createSpan({ cls: 'ert-time-backward-icon' }), 'undo-2');
            item.createSpan({ text: label });
        }
        if (snapshot.duration) {
            const key = summary.createDiv({ cls: 'ert-time-legend' });
            for (const [swatches, label] of [[['line'], t('sceneTime.legend.declaredDuration')], [['over', 'provisional'], t('sceneTime.legend.durationOver')],
                [['arrow', 'arrow-unquantified'], t('sceneTime.legend.durationShort')]] as const) {
                const item = key.createSpan({ cls: 'ert-time-legend-item' });
                for (const swatch of swatches) {
                    const mark = item.createSpan({ cls: `ert-time-duration-key ert-time-duration-key-${swatch}` });
                    if (swatch.startsWith('arrow')) setIcon(mark, 'arrow-down');
                }
                item.createSpan({ text: label });
            }
        }
        const eligible = snapshot.cues.filter(cue => !cue.decision && !cue.duplicate && cue.suggestedMinutes !== null
            && (cue.kind === 'advance' || cue.kind === 'checkpoint'));
        new Setting(summary).setName(t('sceneTime.modal.confirmAllName'))
            .setDesc(t('sceneTime.modal.confirmAllDesc', { count: eligible.length }))
            .addButton(button => button.setButtonText(t('sceneTime.modal.confirmAllButton')).setDisabled(!eligible.length || !!this.service.error).onClick(async () => {
                button.setDisabled(true);
                try { await this.service.confirmAll(this.file, eligible.map(cue => cue.key)); this.render(); }
                catch (error) { new Notice(String(error)); button.setDisabled(false); }
            }));
        const help = body.createEl('details', { cls: 'ert-time-help' });
        help.createEl('summary', { text: t('sceneTime.modal.howCountedSummary') });
        help.createEl('p', { text: t('sceneTime.modal.howCountedBody') });
        if (this.service.error) contentEl.createEl('p', { cls: 'ert-time-over', text: this.service.error });
        if (!snapshot.cues.length) contentEl.createEl('p', { text: t('sceneTime.modal.noCues') });
        for (const entry of this.service.detachedManualTimes(this.file, this.source())) {
            new Setting(body).setName(t('sceneTime.modal.unmatchedName', { quote: entry.quote, duration: elapsedLabel(entry.minutes) }))
                .setDesc(t('sceneTime.modal.unmatchedDesc'))
                .addButton(button => button.setButtonText(t('sceneTime.modal.remove')).onClick(async () => {
                    try { await this.service.removeManualTime(this.file, entry.key); this.render(); }
                    catch (error) { new Notice(String(error)); }
                }));
        }
        for (const cue of snapshot.cues) {
            const card = body.createDiv({ cls: `ert-glass-card ert-sub-card ert-stack ert-time-cue ert-time-${cueState(cue)}` });
            const heading = card.createDiv({ cls: 'ert-time-cue-heading' });
            heading.createEl('strong', { text: `“${cue.quote.trim()}”` });
            heading.createSpan({ cls: 'ert-time-cue-meta', text: t('sceneTime.modal.cueMeta', { line: cue.line + 1, description: cueDescription(cue).replace(/ · /g, ' • ') }) });
            if (cue.key === focusKey) card.addClass('ert-time-selected');
            const context = card.createEl('details');
            context.open = cue.key === focusKey;
            context.createEl('summary', { text: t('sceneTime.modal.showParagraph') });
            const paragraph = context.createEl('p');
            paragraph.createSpan({ text: cue.context.slice(0, cue.contextOffset) });
            paragraph.createSpan({ cls: 'ert-time-context-match', text: cue.context.slice(cue.contextOffset, cue.contextOffset + cue.quote.length) });
            paragraph.createSpan({ text: cue.context.slice(cue.contextOffset + cue.quote.length) });
            if (cue.kind === 'manual') {
                let duration = `${cue.decision?.minutes ?? 0} minutes`;
                new Setting(card).setName(t('sceneTime.modal.manualName'))
                    .addText(input => input.setValue(duration).onChange(value => { duration = value; }))
                    .addButton(button => button.setButtonText(t('common.save')).onClick(async () => {
                        const ms = parseDuration(duration);
                        if (ms === null || !Number.isFinite(ms) || ms <= 0) { new Notice(t('sceneTime.modal.positiveDuration')); return; }
                        try { await this.service.decide(this.file, cue.key, { action: 'add', minutes: ms / 60000 }); this.render(cue.key); }
                        catch (error) { new Notice(String(error)); }
                    }))
                    .addButton(button => button.setButtonText(t('sceneTime.modal.removeAssignment')).onClick(async () => {
                        try { await this.service.removeManualTime(this.file, cue.key); this.render(); }
                        catch (error) { new Notice(String(error)); }
                    }));
                continue;
            }
            if (cue.decision?.action === 'exclude') {
                new Setting(card).addButton(button => button.setButtonText(t('sceneTime.modal.restoreCue')).setDisabled(!!this.service.error).onClick(async () => {
                    button.setDisabled(true);
                    try { await this.service.decide(this.file, cue.key, null); this.render(cue.key); }
                    catch (error) { new Notice(String(error)); button.setDisabled(false); }
                }));
                continue;
            }
            if (cue.duplicate) {
                card.createEl('p', { text: t('sceneTime.modal.duplicate') });
                continue;
            }
            let action: TimeDecision['action'] = cue.decision?.action || (cue.kind === 'backward' ? 'exclude' : cue.kind === 'checkpoint' || cue.kind === 'clock' ? 'checkpoint' : 'add');
            const minutes = cue.decision?.minutes ?? cue.suggestedMinutes;
            let duration = minutes === null ? '' : minutes < 1 ? `${Number((minutes * 60).toFixed(6))} seconds`
                : minutes % 60 === 0 ? `${minutes / 60} hours` : `${Number(minutes.toFixed(6))} minutes`;
            const controls = new Setting(card).setName(t('sceneTime.modal.contribution'));
            controls.addDropdown(dropdown => dropdown.addOption('add', t('sceneTime.modal.actionAdd')).addOption('checkpoint', t('sceneTime.modal.actionCheckpoint')).addOption('exclude', t('sceneTime.modal.exclude'))
                .setValue(action).onChange(value => { action = value as TimeDecision['action']; }));
            controls.addText(input => input.setPlaceholder(t('sceneTime.modal.contributionPlaceholder')).setValue(duration).onChange(value => { duration = value; }));
            const actions = controls;
            controls.settingEl.addClass('ert-time-contribution');
            actions.addButton(button => button.setButtonText(t('sceneTime.modal.confirm')).setCta().setDisabled(!!this.service.error).onClick(async () => {
                const ms = action === 'exclude' ? 0 : parseDuration(duration);
                if (ms === null || !Number.isFinite(ms) || ms < 0) { new Notice(t('sceneTime.modal.invalidDuration')); return; }
                button.setDisabled(true);
                try {
                    await this.service.decide(this.file, cue.key, { action, minutes: ms / 60000 });
                    this.render();
                } catch (error) { new Notice(String(error)); button.setDisabled(false); }
            }));
            actions.addButton(button => button.setButtonText(t('sceneTime.modal.exclude')).setDisabled(!!this.service.error).onClick(async () => {
                button.setDisabled(true);
                try { await this.service.decide(this.file, cue.key, { action: 'exclude', minutes: 0 }); this.render(cue.key); }
                catch (error) { new Notice(String(error)); button.setDisabled(false); }
            }));
            if (cue.decision) actions.addButton(button => button.setButtonText(t('sceneTime.modal.clearConfirmation')).onClick(async () => {
                try { await this.service.decide(this.file, cue.key, null); this.render(); }
                catch (error) { new Notice(String(error)); }
            }));
            if (cue.decision && typeof metadata.When === 'string') {
                const start = parseWhenField(metadata.When);
                if (start && /\d:\d|\d\s*[ap]m\b/i.test(metadata.When)) {
                    card.createDiv({ text: t('sceneTime.modal.clockAfter', { clock: new Date(start.getTime() + cue.elapsed * 60000).toLocaleString() }) });
                }
            }

        }
        contentEl.querySelector('.ert-time-selected')?.scrollIntoView({ block: 'nearest' });
    }
}
