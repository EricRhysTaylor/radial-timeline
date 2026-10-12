import { ButtonComponent, Modal, Setting, TextAreaComponent, TextComponent } from 'obsidian';
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
    title: string;
    activeMs: number;
    typedWords: number;
}

function minutesFromElapsed(elapsedMs: number): number {
    return Math.max(1, Math.round(Math.max(0, elapsedMs) / 60000));
}

function formatActiveDuration(ms: number): string {
    const minutes = Math.round(Math.max(0, ms) / 60000);
    if (minutes < 1) return t('ui.writingSessionCompletionModal.durationUnderMinute');
    if (minutes < 60) return t('ui.writingSessionCompletionModal.durationMinutes', { minutes });
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0
        ? t('ui.writingSessionCompletionModal.durationHoursMinutes', { hours, minutes: rest })
        : t('ui.writingSessionCompletionModal.durationHours', { hours });
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
        let minutes = minutesFromElapsed(this.elapsedMs);
        let sessionDate = sessionDateFromStartedAt(this.active.startedAt);
        const typedWords = Math.max(0, Math.round(this.wordStats.typedWords ?? this.active.typedWords ?? 0));
        const hasTypedWords = typedWords > 0;
        const netWordDelta = Number.isFinite(this.wordStats.netWordDelta)
            ? Math.round(this.wordStats.netWordDelta ?? 0)
            : undefined;
        let wordsAdded: number | undefined = hasTypedWords ? typedWords : undefined;
        let scenesCompleted: number | undefined;
        let note = '';
        // Default-OFF: user opts in to scenes they actually worked on. The
        // suggestion list (currently-active file, open files, working scenes,
        // recently-modified files) is informational — pre-selecting all of
        // them is a trap because the active file is often unrelated to the
        // session work, and "selecting" implies opt-in, not opt-out.
        const selectedScenePaths = new Set<string>();

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
            '',
            value => { scenesCompleted = parseOptionalInteger(value); },
            'ert-writing-session-compact-setting'
        );

        if (this.sceneActivity.length > 0) {
            const activitySection = form.createDiv({ cls: 'ert-writing-session-scenes ert-writing-session-activity' });
            activitySection.createDiv({ cls: 'ert-writing-session-scenes__title', text: t('ui.writingSessionCompletionModal.todayByScene') });
            activitySection.createDiv({
                cls: 'ert-writing-session-activity__hint',
                text: t('ui.writingSessionCompletionModal.activityHint'),
            });
            const activityList = activitySection.createDiv({ cls: 'ert-writing-session-activity__list' });
            this.sceneActivity.forEach(entry => {
                const row = activityList.createDiv({ cls: 'ert-writing-session-activity__row' });
                row.createSpan({ cls: 'ert-writing-session-activity__scene', text: entry.title });
                row.createSpan({ cls: 'ert-writing-session-activity__metric', text: formatActiveDuration(entry.activeMs) });
                row.createSpan({ cls: 'ert-writing-session-activity__metric', text: t('ui.writingSessionCompletionModal.activityWords', { count: entry.typedWords }) });
            });
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
                        toggle.setValue(false);
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

        let postToFeed = this.feedShare.eligible && this.feedShare.defaultOn;
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
        const save = async () => {
            const elapsedMinutes = Math.max(1, minutes);
            const result: WritingSessionCompletionResult = {
                elapsedMinutes,
                sessionDate,
                elapsedMs: elapsedMinutes * 60000,
                wordsAdded,
                typedWords: hasTypedWords ? typedWords : undefined,
                netWordDelta,
                scenesCompleted,
                scenePaths: [...selectedScenePaths],
                note,
                postToFeed: this.feedShare.eligible ? postToFeed : undefined,
            };
            await this.onSubmit(result);
            this.close();
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
