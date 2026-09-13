import { Notice, Setting, TFile, setIcon } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import { parseDuration, parseWhenField } from '../utils/date';
import { cueDescription, cueState, elapsedLabel, type TimeDecision } from './model';
import type { SceneTimeService } from './SceneTimeService';

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
        this.mountHeader({ title: 'Scene time', subtitle: 'The vertical cue bar marks time phrases beside your prose. Give an uncertain phrase such as “a few minutes” a fixed duration, then confirm it to include that time in the title-bar elapsed total. Your choices are saved for this scene, helping you compare the time accounted for in the prose with its declared duration. To time action without a time phrase, click the gray dots beside that line and enter its duration. Blue bracketed markers show these manual assignments. This check is optional.', badge: { text: `OPTIONAL TIME CHECK • ${this.file.basename}` } });
        const snapshot = this.service.snapshot(this.file, this.source());
        if (!snapshot) { contentEl.createEl('p', { text: 'This note is no longer a scene.' }); return; }
        const metadata = this.service.metadata(this.file)!;
        const planned = typeof metadata.Duration === 'string' ? parseDuration(metadata.Duration) : null;
        const body = contentEl.createDiv({ cls: 'ert-card-stack' });
        const summary = body.createDiv({ cls: 'ert-glass-card ert-sub-card ert-stack' });
        summary.createEl('strong', { text: `${elapsedLabel(snapshot.elapsed)} confirmed elapsed · ${snapshot.cues.length} detected cues` });
        summary.createDiv({ cls: 'ert-time-help', text: 'Optional: use these cues to check elapsed story time. You can ignore this panel. Confirmations affect only this scene’s cue bar and elapsed total, not Timeline Audit, Timeline Scaffold, or your writing-session timer.' });
        if (planned !== null && snapshot.confirmed) {
            const remaining = planned / 60000 - snapshot.elapsed;
            summary.createDiv({ cls: remaining < 0 ? 'ert-time-over' : '', text: remaining < 0
                ? `${elapsedLabel(-remaining)} beyond the scene’s declared duration of ${elapsedLabel(planned / 60000)}.`
                : `Duration ${elapsedLabel(planned / 60000)} · ${elapsedLabel(remaining)} not quantified by confirmed cues.` });
        }
        if (snapshot.conflict) summary.createDiv({ cls: 'ert-time-over', text: 'A checkpoint goes backward. Resolve it before treating this as a reconciled total.' });
        const legend = summary.createDiv({ cls: 'ert-time-legend' });
        for (const [state, label] of [['detected', 'Detected'], ['confirmed', 'Confirmed'], ['manual', '[10h] Manual'], ['uncertain', '? Uncertain / clock'], ['backward', 'Backward'], ['excluded', 'Excluded']]) {
            const item = legend.createSpan({ cls: `ert-time-legend-item ert-time-${state}` });
            if (state === 'backward') setIcon(item.createSpan({ cls: 'ert-time-backward-icon' }), 'undo-2');
            item.createSpan({ text: label });
        }
        const eligible = snapshot.cues.filter(cue => !cue.decision && !cue.duplicate && cue.suggestedMinutes !== null
            && (cue.kind === 'advance' || cue.kind === 'checkpoint'));
        new Setting(summary).setName('Use the detected durations')
            .setDesc(`${eligible.length} quantified forward cues. Vague phrases, clock anchors and backward references stay optional. You can change any decision below.`)
            .addButton(button => button.setButtonText('Confirm all').setDisabled(!eligible.length || !!this.service.error).onClick(async () => {
                button.setDisabled(true);
                try { await this.service.confirmAll(this.file, eligible.map(cue => cue.key)); this.render(); }
                catch (error) { new Notice(String(error)); button.setDisabled(false); }
            }));
        const help = body.createEl('details', { cls: 'ert-time-help' });
        help.createEl('summary', { text: 'How elapsed time is counted' });
        help.createEl('p', { text: 'Confirm only elapsed time in this scene’s present action. Dialogue, plans, memories and parallel action can mention time without advancing it. Checkpoints replace the cumulative total; advances add to it. Unquantified time is not necessarily missing.' });
        if (this.service.error) contentEl.createEl('p', { cls: 'ert-time-over', text: this.service.error });
        if (!snapshot.cues.length) contentEl.createEl('p', { text: 'No supported time phrases detected. Prose can still consume time without quantifying it.' });
        for (const entry of this.service.detachedManualTimes(this.file, this.source())) {
            new Setting(body).setName(`Unmatched assignment: “${entry.quote}” [${elapsedLabel(entry.minutes)}]`)
                .setDesc('Saved but not counted: the text changed, is duplicated, or overlaps a detected cue. Remove this assignment and select the current text to assign it again.')
                .addButton(button => button.setButtonText('Remove').onClick(async () => {
                    try { await this.service.removeManualTime(this.file, entry.key); this.render(); }
                    catch (error) { new Notice(String(error)); }
                }));
        }
        for (const cue of snapshot.cues) {
            const card = body.createDiv({ cls: `ert-glass-card ert-sub-card ert-stack ert-time-cue ert-time-${cueState(cue)}` });
            const heading = card.createDiv({ cls: 'ert-time-cue-heading' });
            heading.createEl('strong', { text: `“${cue.quote.trim()}”` });
            heading.createSpan({ cls: 'ert-time-cue-meta', text: `Line ${cue.line + 1} • ${cueDescription(cue).replace(/ · /g, ' • ')}` });
            if (cue.key === focusKey) card.addClass('ert-time-selected');
            const context = card.createEl('details');
            context.open = cue.key === focusKey;
            context.createEl('summary', { text: 'Show paragraph' });
            const paragraph = context.createEl('p');
            paragraph.createSpan({ text: cue.context.slice(0, cue.contextOffset) });
            paragraph.createSpan({ cls: 'ert-time-context-match', text: cue.context.slice(cue.contextOffset, cue.contextOffset + cue.quote.length) });
            paragraph.createSpan({ text: cue.context.slice(cue.contextOffset + cue.quote.length) });
            if (cue.kind === 'manual') {
                let duration = `${cue.decision?.minutes ?? 0} minutes`;
                new Setting(card).setName('Manually assigned duration')
                    .addText(input => input.setValue(duration).onChange(value => { duration = value; }))
                    .addButton(button => button.setButtonText('Save').onClick(async () => {
                        const ms = parseDuration(duration);
                        if (ms === null || !Number.isFinite(ms) || ms <= 0) { new Notice('Enter a positive duration.'); return; }
                        try { await this.service.decide(this.file, cue.key, { action: 'add', minutes: ms / 60000 }); this.render(cue.key); }
                        catch (error) { new Notice(String(error)); }
                    }))
                    .addButton(button => button.setButtonText('Remove assignment').onClick(async () => {
                        try { await this.service.removeManualTime(this.file, cue.key); this.render(); }
                        catch (error) { new Notice(String(error)); }
                    }));
                continue;
            }
            if (cue.decision?.action === 'exclude') {
                new Setting(card).addButton(button => button.setButtonText('Restore cue').setDisabled(!!this.service.error).onClick(async () => {
                    button.setDisabled(true);
                    try { await this.service.decide(this.file, cue.key, null); this.render(cue.key); }
                    catch (error) { new Notice(String(error)); button.setDisabled(false); }
                }));
                continue;
            }
            if (cue.duplicate) {
                card.createEl('p', { text: 'This identical paragraph occurs more than once. Make its wording distinct before attaching a saved decision.' });
                continue;
            }
            let action: TimeDecision['action'] = cue.decision?.action || (cue.kind === 'backward' ? 'exclude' : cue.kind === 'checkpoint' || cue.kind === 'clock' ? 'checkpoint' : 'add');
            const minutes = cue.decision?.minutes ?? cue.suggestedMinutes;
            let duration = minutes === null ? '' : minutes < 1 ? `${Number((minutes * 60).toFixed(6))} seconds`
                : minutes % 60 === 0 ? `${minutes / 60} hours` : `${Number(minutes.toFixed(6))} minutes`;
            const controls = new Setting(card).setName('Contribution');
            controls.addDropdown(dropdown => dropdown.addOption('add', 'Advance by').addOption('checkpoint', 'Elapsed since start').addOption('exclude', 'Exclude')
                .setValue(action).onChange(value => { action = value as TimeDecision['action']; }));
            controls.addText(input => input.setPlaceholder('e.g. 2 hours').setValue(duration).onChange(value => { duration = value; }));
            const actions = controls;
            controls.settingEl.addClass('ert-time-contribution');
            actions.addButton(button => button.setButtonText('Confirm').setCta().setDisabled(!!this.service.error).onClick(async () => {
                const ms = action === 'exclude' ? 0 : parseDuration(duration);
                if (ms === null || !Number.isFinite(ms) || ms < 0) { new Notice('Enter a duration such as “2 hours” or “30 min”.'); return; }
                button.setDisabled(true);
                try {
                    await this.service.decide(this.file, cue.key, { action, minutes: ms / 60000 });
                    this.render();
                } catch (error) { new Notice(String(error)); button.setDisabled(false); }
            }));
            actions.addButton(button => button.setButtonText('Exclude').setDisabled(!!this.service.error).onClick(async () => {
                button.setDisabled(true);
                try { await this.service.decide(this.file, cue.key, { action: 'exclude', minutes: 0 }); this.render(cue.key); }
                catch (error) { new Notice(String(error)); button.setDisabled(false); }
            }));
            if (cue.decision) actions.addButton(button => button.setButtonText('Clear confirmation').onClick(async () => {
                try { await this.service.decide(this.file, cue.key, null); this.render(); }
                catch (error) { new Notice(String(error)); }
            }));
            if (cue.decision && typeof metadata.When === 'string') {
                const start = parseWhenField(metadata.When);
                if (start && /\d:\d|\d\s*[ap]m\b/i.test(metadata.When)) {
                    card.createDiv({ text: `Clock after confirmed contributions: ${new Date(start.getTime() + cue.elapsed * 60000).toLocaleString()}` });
                }
            }

        }
        contentEl.querySelector('.ert-time-selected')?.scrollIntoView({ block: 'nearest' });
    }
}
