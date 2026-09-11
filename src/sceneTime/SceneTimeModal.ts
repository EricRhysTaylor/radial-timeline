import { Notice, Setting, TFile } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import { parseDuration, parseWhenField } from '../utils/date';
import { cueDescription, cueState, elapsedLabel, type TimeDecision } from './model';
import type { SceneTimeService } from './SceneTimeService';

export class SceneTimeModal extends ErtModal {
    constructor(private readonly service: SceneTimeService, private readonly file: TFile,
        private readonly source: () => string, private readonly selectedKey?: string) { super(service.plugin.app); }

    onOpen(): void {
        this.applyShell({ width: 'min(760px, 92vw)' });
        this.render();
    }

    private render(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ert-stack');
        this.setTitle(`Scene time · ${this.file.basename}`);
        const snapshot = this.service.snapshot(this.file, this.source());
        if (!snapshot) { contentEl.createEl('p', { text: 'This note is no longer a scene.' }); return; }
        const metadata = this.service.metadata(this.file)!;
        const planned = typeof metadata.Duration === 'string' ? parseDuration(metadata.Duration) : null;
        const summary = contentEl.createDiv({ cls: 'ert-panel ert-stack' });
        summary.createEl('strong', { text: `${elapsedLabel(snapshot.elapsed)} confirmed elapsed · ${snapshot.pending} cues need review` });
        if (planned !== null) {
            const remaining = planned / 60000 - snapshot.elapsed;
            summary.createDiv({ cls: remaining < 0 ? 'ert-time-over' : '', text: remaining < 0
                ? `${elapsedLabel(-remaining)} beyond the scene’s declared duration of ${elapsedLabel(planned / 60000)}.`
                : `Duration ${elapsedLabel(planned / 60000)} · ${elapsedLabel(remaining)} not quantified by confirmed cues.` });
        }
        if (snapshot.conflict) summary.createDiv({ cls: 'ert-time-over', text: 'A checkpoint goes backward. Resolve it before treating this as a reconciled total.' });
        summary.createDiv({ text: 'Accent: detected · Green: confirmed · Amber: uncertain or clock anchor · Purple: backward · Gray: excluded' });
        contentEl.createEl('p', { text: 'Confirm only elapsed time in this scene’s present action. Dialogue, plans, memories and parallel action can mention time without advancing it. Checkpoints replace the cumulative total; advances add to it. Unquantified time is not necessarily missing.' });
        if (this.service.error) contentEl.createEl('p', { cls: 'ert-time-over', text: this.service.error });
        if (!snapshot.cues.length) contentEl.createEl('p', { text: 'No supported time phrases detected. Prose can still consume time without quantifying it.' });
        for (const cue of snapshot.cues) {
            const card = contentEl.createDiv({ cls: `ert-panel ert-stack ert-time-cue ert-time-${cueState(cue)}` });
            card.createEl('strong', { text: `Line ${cue.line + 1} · “${cue.quote}”` });
            card.createDiv({ text: cueDescription(cue) });
            const context = card.createEl('details');
            context.createEl('summary', { text: 'Show paragraph' });
            context.createEl('p', { text: cue.context });
            if (cue.duplicate) {
                card.createEl('p', { text: 'This identical paragraph occurs more than once. Make its wording distinct before attaching a saved decision.' });
                continue;
            }
            let action: TimeDecision['action'] = cue.decision?.action || (cue.kind === 'backward' ? 'exclude' : cue.kind === 'checkpoint' || cue.kind === 'clock' ? 'checkpoint' : 'add');
            let duration = cue.decision ? `${cue.decision.minutes} minutes` : cue.suggestedMinutes !== null ? `${cue.suggestedMinutes} minutes` : '';
            const controls = new Setting(card).setName('Contribution').setDesc('Use a duration such as “2 hours” or “30 min”. For a clock anchor, enter total elapsed since scene start.');
            controls.addDropdown(dropdown => dropdown.addOption('add', 'Advance by').addOption('checkpoint', 'Elapsed since start').addOption('exclude', 'Exclude')
                .setValue(action).onChange(value => { action = value as TimeDecision['action']; }));
            controls.addText(input => input.setPlaceholder('e.g. 2 hours').setValue(duration).onChange(value => { duration = value; }));
            const actions = new Setting(card);
            actions.addButton(button => button.setButtonText('Save decision').setDisabled(!!this.service.error).onClick(async () => {
                const ms = action === 'exclude' ? 0 : parseDuration(duration);
                if (ms === null || !Number.isFinite(ms) || ms < 0) { new Notice('Enter a duration such as “2 hours” or “30 min”.'); return; }
                button.setDisabled(true);
                try {
                    await this.service.decide(this.file, cue.key, { action, minutes: ms / 60000 });
                    this.render();
                } catch (error) { new Notice(String(error)); button.setDisabled(false); }
            }));
            if (cue.decision) actions.addButton(button => button.setButtonText('Return to review').onClick(async () => {
                try { await this.service.decide(this.file, cue.key, null); this.render(); }
                catch (error) { new Notice(String(error)); }
            }));
            if (cue.decision && cue.decision.action !== 'exclude' && typeof metadata.When === 'string') {
                const start = parseWhenField(metadata.When);
                if (start && /\d:\d|\d\s*[ap]m\b/i.test(metadata.When)) {
                    card.createDiv({ text: `Clock after confirmed contributions: ${new Date(start.getTime() + cue.elapsed * 60000).toLocaleString()}` });
                }
            }
            if (cue.key === this.selectedKey) card.addClass('ert-time-selected');
        }
        contentEl.querySelector('.ert-time-selected')?.scrollIntoView({ block: 'nearest' });
    }
}
