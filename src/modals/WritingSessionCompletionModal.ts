import { setAccessibleLabel } from '../utils/domTooltip';
import { allocationMinutes } from '../services/WritingSessionTimeAllocation';
import { ButtonComponent, Modal, Notice, Setting, TextAreaComponent, TextComponent } from 'obsidian';
import type { App } from 'obsidian';
import type { ActiveWritingSession } from '../types/settings';
import type { WritingSessionCompletionInput, WritingSessionSceneSuggestion } from '../services/WritingSessionService';
import { formatLocalDateKey } from '../utils/date';
import { t } from '../i18n';

export interface WritingSessionCompletionResult extends WritingSessionCompletionInput {
    elapsedMinutes: number;
    /**
     * Author armed the "post to community feed" toggle for this save. Only
     * present when the modal was opened with an eligible feedShare option.
     */
    postToFeed?: boolean;
}

/** Feed-posting context for the save modal. Absent = feature not eligible. */
export interface WritingSessionFeedShareOption {
    /** Author is at the top sharing level with an active connection. */
    eligible: boolean;
    /** Remembered toggle state from the last save. */
    defaultOn: boolean;
}

export interface WritingSessionCompletionWordStats {
    typedWords?: number;
    netWordDelta?: number;
}

/** Resolved per-scene memory-aid row shown in the save popover (title resolved by caller). */
export interface WritingSessionSceneActivityEntry {
    path: string;
    beforeHours: number;
    alreadyApplied: boolean;
    /** A pending ledger entry this scene can no longer take; Save skips it. */
    blocked: boolean;
    currentHours: number;
    title: string;
    activeMs: number;
    typedWords: number;
}

function minutesFromElapsed(elapsedMs: number): number {
    return Math.max(1, Math.round(Math.max(0, elapsedMs) / 60000));
}

function sessionDateFromStartedAt(startedAt: string): string {
    const parsed = new Date(startedAt);
    return Number.isNaN(parsed.getTime()) ? formatLocalDateKey() : formatLocalDateKey(parsed);
}

function isDateKey(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseOptionalInteger(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return undefined;
    const rounded = Math.max(0, Math.round(parsed));
    return rounded > 0 ? rounded : undefined;
}

export class WritingSessionCompletionModal extends Modal {
    constructor(
        app: App,
        private active: ActiveWritingSession,
        private elapsedMs: number,
        private sceneSuggestions: WritingSessionSceneSuggestion[],
        private wordStats: WritingSessionCompletionWordStats,
        private sceneActivity: WritingSessionSceneActivityEntry[],
        private feedShare: WritingSessionFeedShareOption,
        private pendingTime: boolean,
        private recoveredCompletion: WritingSessionCompletionResult | undefined,
        private onSubmit: (result: WritingSessionCompletionResult) => Promise<void>
    ) {
        super(app);
    }

    private formatMode(): string {
        if (this.active.mode === 'drafting') return t('ui.writingSessionCompletionModal.modeFreshDrafting');
        if (this.active.mode === 'revising') return t('ui.writingSessionCompletionModal.modeRevision');
        if (this.active.mode === 'editing') return t('ui.writingSessionCompletionModal.modeLineEdit');
        return t('ui.writingSessionCompletionModal.modePlanning');
    }

    private formatHeaderMeta(): string {
        const mode = this.formatMode();
        const modeLabel = mode ? mode.charAt(0).toUpperCase() + mode.slice(1) : '';
        return [modeLabel, this.active.stage, this.active.bookTitle].filter(Boolean).join(' · ') || t('ui.writingSessionCompletionModal.sessionFallback');
    }

    private formatSceneSuggestionDetail(suggestion: WritingSessionSceneSuggestion): string {
        const reasonLabel = suggestion.reason === 'active'
            ? t('ui.writingSessionCompletionModal.reasonActiveTab')
            : suggestion.reason === 'open'
                ? t('ui.writingSessionCompletionModal.reasonOpenTab')
                : suggestion.reason === 'working'
                    ? t('ui.writingSessionCompletionModal.reasonMarkedWorking')
                    : t('ui.writingSessionCompletionModal.reasonModified');
        return [
            suggestion.stage,
            suggestion.status,
            reasonLabel,
        ].filter(Boolean).join(' · ');
    }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal--writing-session');
        }
        contentEl.addClass('ert-modal-container', 'ert-stack');

        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        const badgeBaseText = this.formatHeaderMeta();
        const badge = header.createSpan({ cls: 'ert-modal-badge', text: badgeBaseText });
        header.createDiv({ cls: 'ert-modal-title', text: t('ui.writingSessionCompletionModal.title') });
        header.createDiv({
            cls: 'ert-modal-subtitle',
            text: t('ui.writingSessionCompletionModal.subtitle'),
        });

        const form = contentEl.createDiv({ cls: 'ert-writing-session-form ert-stack' });
        let minutes = this.recoveredCompletion?.elapsedMinutes ?? minutesFromElapsed(this.elapsedMs);
        let sessionDate = this.recoveredCompletion?.sessionDate ?? sessionDateFromStartedAt(this.active.startedAt);
        const typedWords = Math.max(0, Math.round(this.wordStats.typedWords ?? this.active.typedWords ?? 0));
        const hasTypedWords = typedWords > 0;
        const netWordDelta = Number.isFinite(this.wordStats.netWordDelta)
            ? Math.round(this.wordStats.netWordDelta ?? 0)
            : undefined;
        let wordsAdded: number | undefined = this.recoveredCompletion ? this.recoveredCompletion.wordsAdded : hasTypedWords ? typedWords : undefined;
        let scenesCompleted: number | undefined = this.recoveredCompletion?.scenesCompleted;
        let note = this.recoveredCompletion?.note ?? '';
        // Default-OFF: user opts in to scenes they actually worked on. The
        // suggestion list (currently-active file, open files, working scenes,
        // recently-modified files) is informational — pre-selecting all of
        // them is a trap because the active file is often unrelated to the
        // session work, and "selecting" implies opt-in, not opt-out.
        const selectedScenePaths = new Set<string>(this.recoveredCompletion?.scenePaths ?? []);

        const wireNumber = (
            setting: Setting,
            defaultValue: string,
            onChange: (value: string) => void,
            extraClass?: string
        ): void => {
            if (extraClass) setting.settingEl.addClass(extraClass);
            setting.addText((text: TextComponent) => {
                text.inputEl.type = 'number';
                text.inputEl.min = '0';
                text.inputEl.step = '1';
                text.inputEl.addClass('ert-input--sm');
                text.setValue(defaultValue);
                text.onChange(onChange);
                text.inputEl.addEventListener('keydown', (evt: KeyboardEvent) => {
                    if (evt.key === 'Enter') {
                        evt.preventDefault();
                        void save();
                    }
                });
            });
        };

        // Read-only stats render as pills, not locked inputs — a disabled text
        // box invites editing and then refuses it. A pill reads as a fact.
        const addStatPill = (setting: Setting, value: string, tone?: 'positive' | 'negative' | 'muted'): void => {
            setting.controlEl.createSpan({
                cls: `ert-writing-session-stat-pill${tone ? ` is-${tone}` : ''}`,
                text: value,
            });
        };

        const wordsSection = form.createDiv({ cls: 'ert-writing-session-section ert-writing-session-section--words' });
        const wordSummary = wordsSection.createDiv({ cls: 'ert-writing-session-grid ert-writing-session-grid--words' });
        const typedWordsSetting = new Setting(wordSummary)
            .setName(t('ui.writingSessionCompletionModal.typedName'))
            .setDesc(t('ui.writingSessionCompletionModal.typedDesc'));
        addStatPill(typedWordsSetting, t('ui.writingSessionCompletionModal.wordsValue', { count: hasTypedWords ? typedWords : 0 }));
        typedWordsSetting.settingEl.addClass('ert-writing-session-compact-setting');
        wireNumber(
            new Setting(wordSummary)
                .setName(t('ui.writingSessionCompletionModal.wordsToSaveName'))
                .setDesc(t('ui.writingSessionCompletionModal.wordsToSaveDesc')),
            wordsAdded === undefined ? '' : String(wordsAdded),
            value => { wordsAdded = parseOptionalInteger(value); },
            'ert-writing-session-compact-setting'
        );

        const workSummary = wordsSection.createDiv({ cls: 'ert-writing-session-grid ert-writing-session-grid--work' });
        const netWordSetting = new Setting(workSummary)
            .setName(t('ui.writingSessionCompletionModal.netChangeName'))
            .setDesc(t('ui.writingSessionCompletionModal.netChangeDesc'));
        addStatPill(
            netWordSetting,
            netWordDelta === undefined
                ? t('ui.writingSessionCompletionModal.unavailable')
                : t('ui.writingSessionCompletionModal.wordsValue', { count: `${netWordDelta > 0 ? '+' : ''}${netWordDelta}` }),
            netWordDelta === undefined ? 'muted' : netWordDelta >= 0 ? 'positive' : 'negative'
        );
        netWordSetting.settingEl.addClass('ert-writing-session-compact-setting');
        wireNumber(
            new Setting(workSummary)
                .setName(t('ui.writingSessionCompletionModal.scenesCompletedName'))
                .setDesc(t('ui.writingSessionCompletionModal.scenesCompletedDesc')),
            scenesCompleted === undefined ? '' : String(scenesCompleted),
            value => { scenesCompleted = parseOptionalInteger(value); },
            'ert-writing-session-compact-setting'
        );

        let allocateScenes = this.pendingTime;
        let updateSceneTotals = this.pendingTime;
        const allocations = this.sceneActivity.map(entry => ({ ...entry, minutes: allocationMinutes(entry.activeMs, this.pendingTime), words: entry.typedWords }));
        if (allocations.length > 0) {
            const activitySection = form.createDiv({ cls: 'ert-writing-session-scenes ert-writing-session-activity' });
            const list = activitySection.createDiv({ cls: 'ert-writing-session-activity__list' });
            list.hidden = !this.pendingTime;
            const updateRow = new Setting(activitySection).setName(t('ui.writingSessionCompletionModal.allocateScenes'));
            const allocateBox = updateRow.controlEl.createEl('input', { type: 'checkbox' });
            setAccessibleLabel(allocateBox, t('ui.writingSessionCompletionModal.allocateScenes'));
            allocateBox.checked = this.pendingTime; allocateBox.disabled = this.pendingTime;
            allocateBox.onchange = () => { allocateScenes = allocateBox.checked; list.hidden = !allocateScenes; updateToggle.settingEl.hidden = !allocateScenes; };
            const updateToggle = new Setting(activitySection).setName(t('ui.writingSessionCompletionModal.updateSceneTotals')).setDesc(t('ui.writingSessionCompletionModal.updateSceneTotalsHint'));
            updateToggle.settingEl.hidden = !this.pendingTime;
            const updateBox = updateToggle.controlEl.createEl('input', { type: 'checkbox' });
            setAccessibleLabel(updateBox, t('ui.writingSessionCompletionModal.updateSceneTotals'));
            updateBox.checked = this.pendingTime; updateBox.disabled = this.pendingTime;
            updateBox.onchange = () => { updateSceneTotals = updateBox.checked; };
            activitySection.appendChild(list);
            for (const entry of allocations) {
                const row = new Setting(list).setName(entry.title);
                row.settingEl.addClass('ert-writing-session-allocation-row');
                const summary = row.descEl.createSpan();
                const refresh = () => {
                    const after = Math.round((entry.beforeHours + entry.minutes / 60) * 1_000_000) / 1_000_000;
                    if (entry.blocked) { summary.setText(t('ui.writingSessionCompletionModal.sceneTimeSkipped')); return; }
                    summary.setText(Number.isFinite(after) &&(!entry.alreadyApplied || Number.isFinite(entry.currentHours)) ? (entry.alreadyApplied ? t('ui.writingSessionCompletionModal.sceneTimeApplied', { after: entry.currentHours }) : t('ui.writingSessionCompletionModal.sceneTimePreview', { before: entry.beforeHours, after })) : t('ui.writingSessionCompletionModal.invalidSceneTime'));
                };
                row.controlEl.createSpan({ text: t('ui.writingSessionCompletionModal.sceneMinutes') });
                row.addText(input => {
                    input.inputEl.type = 'number'; input.inputEl.min = '0'; input.inputEl.step = '1';
                    input.setPlaceholder(t('ui.writingSessionCompletionModal.sceneMinutes')); input.setDisabled(this.pendingTime);
                    setAccessibleLabel(input.inputEl, t('ui.writingSessionCompletionModal.sceneMinutes'));
                    input.setValue(String(entry.minutes)).onChange(value => { entry.minutes = Number(value); refresh(); });
                });
                row.controlEl.createSpan({ text: t('ui.writingSessionCompletionModal.sceneWords') });
                row.addText(input => {
                    input.inputEl.type = 'number'; input.inputEl.min = '0'; input.inputEl.step = '1';
                    input.setPlaceholder(t('ui.writingSessionCompletionModal.sceneWords')); input.setDisabled(this.pendingTime);
                    setAccessibleLabel(input.inputEl, t('ui.writingSessionCompletionModal.sceneWords'));
                    input.setValue(String(entry.words)).onChange(value => { entry.words = Number(value); });
                });
                refresh();
            }
        }

        if (this.sceneSuggestions.length > 0) {
            const sceneSection = form.createDiv({ cls: 'ert-writing-session-scenes' });
            sceneSection.createDiv({ cls: 'ert-writing-session-scenes__title', text: t('ui.writingSessionCompletionModal.selectScenes') });
            const sceneList = sceneSection.createDiv({ cls: 'ert-writing-session-scenes__list' });
            this.sceneSuggestions.forEach(suggestion => {
                new Setting(sceneList)
                    .setName(suggestion.title || suggestion.path)
                    .setDesc(this.formatSceneSuggestionDetail(suggestion))
                    .addToggle(toggle => {
                        toggle.setValue(selectedScenePaths.has(suggestion.path));
                        toggle.onChange(value => {
                            if (value) selectedScenePaths.add(suggestion.path);
                            else selectedScenePaths.delete(suggestion.path);
                        });
                    });
            });
        }

        const sessionMeta = form.createDiv({ cls: 'ert-writing-session-grid ert-writing-session-grid--session' });
        const sessionDateSetting = new Setting(sessionMeta)
            .setName(t('ui.writingSessionCompletionModal.sessionDateName'))
            .setDesc(t('ui.writingSessionCompletionModal.sessionDateDesc'))
            .addText((text: TextComponent) => {
                text.inputEl.type = 'date';
                text.inputEl.addClass('ert-input--md', 'ert-writing-session-date-input');
                text.setValue(sessionDate);
                text.onChange(value => {
                    if (isDateKey(value)) sessionDate = value;
                });
            });
        sessionDateSetting.settingEl.addClass('ert-writing-session-compact-setting');

        wireNumber(
            new Setting(sessionMeta)
                .setName(t('ui.writingSessionCompletionModal.minutesName'))
                .setDesc(t('ui.writingSessionCompletionModal.minutesDesc')),
            String(minutes),
            value => {
                const parsed = Number(value);
                if (Number.isFinite(parsed) && parsed > 0) minutes = Math.round(parsed);
            },
            'ert-writing-session-compact-setting'
        );

        let postToFeed = this.feedShare.eligible && (this.recoveredCompletion?.postToFeed ?? this.feedShare.defaultOn);
        const syncFeedAccent = () => {
            // When this save will post, the whole share group and the top pill
            // go community-yellow so it is unmistakable the note is public.
            modalEl?.classList.toggle('is-feed-shared', postToFeed);
            badge.classList.toggle('is-community-sharing', postToFeed);
            badge.setText(postToFeed ? t('ui.writingSessionCompletionModal.badgeCommunitySharing', { meta: badgeBaseText }) : badgeBaseText);
        };

        // Note and the community-feed toggle live in one bordered group so it is
        // clear the toggle governs whether THIS note is shared — not a stray
        // control at the bottom of the modal.
        const shareGroup = form.createDiv({ cls: 'ert-writing-session-share' });

        const noteSetting = new Setting(shareGroup)
            .setName(t('ui.writingSessionCompletionModal.noteName'))
            .setDesc(this.feedShare.eligible
                ? t('ui.writingSessionCompletionModal.noteDescShared')
                : t('ui.writingSessionCompletionModal.noteDescPrivate'))
            .addTextArea((text: TextAreaComponent) => {
                text.inputEl.addClass('ert-input--full');
                text.inputEl.rows = 6;
                text.setValue(note);
                text.onChange(value => { note = value; });
            });
        noteSetting.settingEl.addClass('ert-writing-session-note');

        if (this.feedShare.eligible) {
            const feedSetting = new Setting(shareGroup)
                .setName(t('ui.writingSessionCompletionModal.postToFeedName'))
                .setDesc(t('ui.writingSessionCompletionModal.postToFeedDesc'))
                .addToggle(toggle => {
                    toggle.setValue(postToFeed);
                    toggle.onChange(value => {
                        postToFeed = value;
                        syncFeedAccent();
                    });
                });
            feedSetting.settingEl.addClass('ert-writing-session-feed-share');
            syncFeedAccent();
        }

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        let saving = false;
        const save = async () => {
            if (saving) return;
            if (allocateScenes && (allocations.some(entry => !Number.isFinite(entry.minutes) || entry.minutes < 0 || !Number.isFinite(entry.words) || entry.words < 0 || (updateSceneTotals && entry.minutes > 0 && !Number.isFinite(entry.beforeHours))) || allocations.reduce((total, entry) => total + entry.minutes, 0) > minutes || allocations.reduce((total, entry) => total + entry.words, 0) > (wordsAdded ?? 0))) {
                new Notice(t('ui.writingSessionCompletionModal.invalidAllocation')); return;
            }
            saving = true;
            const elapsedMinutes = Math.max(1, minutes);
            const result: WritingSessionCompletionResult = {
                elapsedMinutes,
                sessionDate,
                elapsedMs: elapsedMinutes * 60000,
                wordsAdded,
                typedWords: hasTypedWords ? typedWords : undefined,
                netWordDelta,
                scenesCompleted,
                scenePaths: [...new Set([...selectedScenePaths, ...(allocateScenes ? allocations.filter(entry => entry.minutes > 0 || entry.words > 0).map(entry => entry.path) : [])])],
                sceneAllocations: allocateScenes ? allocations.filter(entry => entry.minutes > 0 || entry.words > 0).map(entry => ({ path: entry.path, activeMs: Math.round(entry.minutes * 60000), typedWords: Math.round(entry.words) })) : [],
                updateSceneTotals: allocateScenes && updateSceneTotals,
                note,
                postToFeed: this.feedShare.eligible ? postToFeed : undefined,
            };
            try { await this.onSubmit(result); this.close(); } catch { saving = false; }
        };

        new ButtonComponent(actions)
            .setButtonText(t('common.save'))
            .setCta()
            .onClick(() => { void save(); });
        new ButtonComponent(actions)
            .setButtonText(t('common.cancel'))
            .onClick(() => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
