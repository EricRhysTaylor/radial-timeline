import { setIcon, Setting, TextComponent } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { RuntimeRateProfile } from '../../types';
import type { WritingSessionTargetMode } from '../../types/settings';
import { ERT_CLASSES } from '../../ui/classes';
import { t } from '../../i18n';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../wikiLink';
import type { WritingRangeStats } from '../../services/WritingSessionService';
import { renderSessionLogList } from '../../renderer/components/SessionLogList';
import { openOrRevealFileByPath } from '../../utils/fileUtils';
import { fitSelectToSelectedLabel } from '../selectSizing';
import { formatLocalDateKey, parseLocalDateKey } from '../../utils/date';
import { runtimeRatesFromSettings } from '../../utils/runtimeEstimator';

interface GoalsSessionsSectionParams {
    plugin: RadialTimelinePlugin;
    containerEl: HTMLElement;
}

function buildProfileFromLegacy(plugin: RadialTimelinePlugin): RuntimeRateProfile {
    return {
        id: 'default',
        label: 'Default',
        ...runtimeRatesFromSettings(plugin.settings),
        sessionPlanning: {
            draftingWpm: undefined,
            recordingWpm: undefined,
            editingWpm: undefined,
            dailyMinutes: undefined,
            dailyWords: undefined,
        },
    };
}

function ensureDefaultRuntimeProfile(plugin: RadialTimelinePlugin): RuntimeRateProfile {
    if (!plugin.settings.runtimeRateProfiles || plugin.settings.runtimeRateProfiles.length === 0) {
        plugin.settings.runtimeRateProfiles = [buildProfileFromLegacy(plugin)];
    }
    if (!plugin.settings.defaultRuntimeProfileId) {
        plugin.settings.defaultRuntimeProfileId = plugin.settings.runtimeRateProfiles[0].id;
    }

    const profiles = plugin.settings.runtimeRateProfiles;
    const defaultProfile = profiles.find(profile => profile.id === plugin.settings.defaultRuntimeProfileId) ?? profiles[0];
    if (plugin.settings.defaultRuntimeProfileId !== defaultProfile.id) {
        plugin.settings.defaultRuntimeProfileId = defaultProfile.id;
    }
    if (!defaultProfile.sessionPlanning) {
        defaultProfile.sessionPlanning = {};
    }
    return defaultProfile;
}

function flash(input: HTMLInputElement, type: 'success' | 'error'): void {
    const successClass = 'ert-input--success';
    const errorClass = 'ert-input--error';
    input.classList.remove(type === 'success' ? errorClass : successClass);
    input.classList.add(type === 'success' ? successClass : errorClass);
    window.setTimeout(() => input.classList.remove(type === 'success' ? successClass : errorClass), type === 'success' ? 900 : 1200);
}

function wireNumberInput(params: {
    plugin: RadialTimelinePlugin;
    text: TextComponent;
    currentValue?: number;
    min?: number;
    max: number;
    onSave: (value: number | undefined) => void;
}): void {
    const { plugin, text, currentValue, min = 0, max, onSave } = params;
    text.inputEl.type = 'number';
    text.inputEl.min = String(min);
    text.inputEl.max = String(max);
    text.inputEl.addClass('ert-input--xs');
    text.setValue(currentValue ? String(currentValue) : '');

    plugin.registerDomEvent(text.inputEl, 'keydown', (evt: KeyboardEvent) => {
        if (evt.key === 'Enter') {
            evt.preventDefault();
            text.inputEl.blur();
        }
    });

    plugin.registerDomEvent(text.inputEl, 'blur', async () => {
        const raw = text.getValue().trim();
        const num = parseInt(raw);
        if (raw && (!Number.isFinite(num) || num < min || num > max)) {
            flash(text.inputEl, 'error');
            return;
        }
        const value = raw ? num : undefined;
        onSave(value);
        await plugin.saveSettings();
        flash(text.inputEl, 'success');
    });
}

function formatMinutes(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours}:${String(remainder).padStart(2, '0')}`;
}

function formatShortDate(date: string): string {
    const [yearRaw, monthRaw, dayRaw] = date.split('-');
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    if (!Number.isFinite(month) || !Number.isFinite(day)) return date;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[month - 1] ?? yearRaw} ${day}`;
}

function daysInCurrentYearToDate(endDate = formatLocalDateKey()): number {
    const end = parseLocalDateKey(endDate);
    if (!end) throw new Error(`Not a date key: ${endDate}`);
    const start = new Date(end.getFullYear(), 0, 1);
    return Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
}

function isYearToDateRange(stats: WritingRangeStats): boolean {
    const end = parseLocalDateKey(stats.endDate);
    return !!end && stats.startDate === `${end.getFullYear()}-01-01`;
}

function formatRangeDate(stats: WritingRangeStats): string {
    if (stats.days === 1) return formatShortDate(stats.endDate);
    return `${formatShortDate(stats.startDate)}–${formatShortDate(stats.endDate)}`;
}

function formatRangeLabel(stats: WritingRangeStats): string {
    if (stats.days === 1) return 'Today';
    if (isYearToDateRange(stats)) return 'Year';
    return `${stats.days} days`;
}

function goalDayTarget(stats: WritingRangeStats, weeklyGoalDays: number): number | undefined {
    if (stats.targetMode === 'time' && !stats.dailyTargetMinutes) return undefined;
    if (stats.targetMode === 'words' && !stats.dailyTargetWords) return undefined;
    if (stats.targetMode === 'both' && !stats.dailyTargetMinutes && !stats.dailyTargetWords) return undefined;
    if (stats.days <= 1) return 1;
    if (stats.days === 7) return weeklyGoalDays;
    return Math.min(stats.days, Math.ceil((stats.days / 7) * weeklyGoalDays));
}

function goalStatusForTarget(stats: WritingRangeStats, targetDays: number | undefined): 'met' | 'missed' | 'neutral' {
    if (!targetDays) return 'neutral';
    return stats.daysGoalMet >= targetDays ? 'met' : 'missed';
}

function createMetric(container: HTMLElement, icon: string, label: string, value: string, tone: string, unit?: string): void {
    const metric = container.createDiv({ cls: `ert-goals-stat ert-goals-stat--${tone}` });
    const head = metric.createDiv({ cls: 'ert-goals-stat__head' });
    const iconEl = head.createDiv({ cls: 'ert-goals-stat__icon' });
    setIcon(iconEl, icon);
    head.createDiv({ cls: 'ert-goals-stat__value', text: value });
    if (unit) head.createDiv({ cls: 'ert-goals-stat__unit', text: unit });
    metric.createDiv({ cls: 'ert-goals-stat__label', text: label });
}

function createRangeCard(plugin: RadialTimelinePlugin, container: HTMLElement, stats: WritingRangeStats, weeklyGoalDays: number): void {
    const targetDays = goalDayTarget(stats, weeklyGoalDays);
    const goalValue = targetDays ? `${stats.daysGoalMet}/${targetDays}` : '—';
    const status = goalStatusForTarget(stats, targetDays);
    const card = container.createDiv({ cls: `ert-goals-stat-card ert-goals-stat-card--${status}` });
    const header = card.createDiv({ cls: 'ert-goals-stat-card__header' });
    const titleWrap = header.createDiv({ cls: 'ert-goals-stat-card__title-wrap' });
    const titleIcon = titleWrap.createSpan({ cls: 'ert-goals-stat-card__icon' });
    setIcon(titleIcon, stats.days === 1 ? 'calendar-clock' : 'calendar');
    titleWrap.createDiv({ cls: 'ert-goals-stat-card__title', text: formatRangeLabel(stats) });
    const statusWrap = header.createDiv({ cls: 'ert-goals-stat-card__status' });
    const statusIcon = statusWrap.createSpan({ cls: 'ert-goals-stat-card__status-icon' });
    setIcon(statusIcon, status === 'met' ? 'check-circle-2' : status === 'missed' ? 'alert-triangle' : 'circle');
    statusWrap.createSpan({ text: targetDays ? goalValue : 'No goal' });
    card.createDiv({ cls: 'ert-goals-stat-card__date', text: formatRangeDate(stats) });

    const metrics = card.createDiv({ cls: 'ert-goals-stat-grid' });
    createMetric(metrics, 'timer', 'logged', formatMinutes(stats.minutesLogged), 'time');
    createMetric(metrics, 'list-checks', 'sessions', String(stats.sessionsCompleted), 'sessions');
    createMetric(metrics, status === 'met' ? 'check-circle-2' : 'alert-triangle', 'goal', goalValue, status === 'missed' ? 'warning' : 'goal', targetDays ? 'd' : undefined);
    createMetric(metrics, 'pencil', 'written', String(stats.wordsDrafted), 'draft', 'w');
    createMetric(metrics, 'book-open-text', 'draft', String(stats.freshScenesCompleted), 'fresh', 's');
    createMetric(metrics, 'refresh-cw', 'revisions', String(stats.revisionScenesCompleted), 'revision', 's');

    const stages = card.createDiv({ cls: 'ert-goals-stage-line' });
    (['Zero', 'Author', 'House', 'Press'] as const).forEach(stage => {
        const count = stats.scenesCompletedByStage[stage];
        if (!count) return;
        const item = stages.createSpan({ cls: `ert-goals-stage-pill ert-goals-stage-pill--${stage}` });
        const stageColor = plugin.settings.publishStageColors?.[stage];
        if (stageColor) item.style.setProperty('--ert-goals-stage-accent', stageColor);
        item.createSpan({ cls: 'ert-goals-stage-pill__label', text: stage });
        item.createSpan({ cls: 'ert-goals-stage-pill__value', text: String(count) });
    });

    renderSessionLogPreview(plugin, card, stats);
}

/**
 * Per-card expandable session log. Today / 7 days open by default; 30 / 151
 * collapsed. Reads from the PRIVATE projection only — friends/community
 * surfaces use separate components.
 */
function renderSessionLogPreview(plugin: RadialTimelinePlugin, card: HTMLElement, stats: WritingRangeStats): void {
    const details = card.createEl('details', { cls: 'ert-goals-stat-card__log' });
    details.open = stats.days <= 7;
    const summary = details.createEl('summary', { cls: 'ert-goals-stat-card__log-summary' });

    const chev = summary.createSpan({ cls: 'ert-goals-stat-card__log-chevron' });
    setIcon(chev, details.open ? 'chevron-down' : 'chevron-right');
    summary.createSpan({ cls: 'ert-goals-stat-card__log-label', text: 'Session log' });
    const count = summary.createSpan({
        cls: 'ert-goals-stat-card__log-count',
        text: stats.sessionsCompleted === 1 ? '1 session' : `${stats.sessionsCompleted} sessions`,
    });
    count.setAttribute('aria-hidden', 'true');

    const body = details.createDiv({ cls: 'ert-goals-stat-card__log-body' });
    let rendered = false;

    const renderRows = () => {
        if (rendered) return;
        rendered = true;
        const rows = plugin.getWritingSessionService().getPrivateSessionLog({
            days: stats.days,
            endDate: stats.endDate,
        });
        renderSessionLogList(body, rows, {
            mode: 'preview',
            onSceneClick: (path) => {
                void openOrRevealFileByPath(plugin.app, path);
            },
            emptyMessage: stats.days === 1
                ? 'No sessions logged today yet.'
                : `No sessions logged in this ${stats.days}-day window.`,
        });
    };

    if (details.open) renderRows();

    details.ontoggle = () => {
        setIcon(chev, details.open ? 'chevron-down' : 'chevron-right');
        if (details.open) renderRows();
    };
}

function renderStatsBody(plugin: RadialTimelinePlugin, container: HTMLElement, stats: WritingRangeStats[]): void {
    container.empty();
    const cards = container.createDiv({ cls: 'ert-goals-stats-grid' });
    const weeklyGoalDays = plugin.getWritingSessionService().getSettings().defaults.weeklyGoalDays ?? 7;
    stats.forEach(stat => createRangeCard(plugin, cards, stat, weeklyGoalDays));
}

function renderStatsError(container: HTMLElement, message: string): void {
    container.empty();
    container.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: message });
}

function renderWritingStatsPanel(plugin: RadialTimelinePlugin, containerEl: HTMLElement): void {
    const details = containerEl.createEl('details', { cls: 'ert-goals-stats-details' });
    details.open = plugin.getWritingSessionService().getSettings().defaults.writingStatsOpen === true;
    const summary = details.createEl('summary', { cls: 'ert-goals-stats-summary' });
    const headingIcon = summary.createSpan({ cls: 'ert-goals-stats-summary__icon ert-setting-heading-icon' });
    setIcon(headingIcon, 'chart-column');
    const titleWrap = summary.createSpan({ cls: 'ert-goals-stats-summary__copy' });
    titleWrap.createSpan({ cls: 'ert-goals-stats-summary__title', text: 'Writing stats' });
    titleWrap.createSpan({
        cls: 'ert-goals-stats-summary__desc',
        text: 'Timer records and completed scenes.',
    });
    const community = summary.createSpan({ cls: 'ert-goals-stats-summary__community' });
    const communityOnline = community.createSpan({ cls: 'ert-goals-stats-summary__community-pill' });
    setIcon(communityOnline.createSpan(), 'radio');
    communityOnline.createSpan({ text: 'Community 34' });
    const friendsOnline = community.createSpan({ cls: 'ert-goals-stats-summary__community-pill' });
    setIcon(friendsOnline.createSpan(), 'users');
    friendsOnline.createSpan({ text: 'Friends 3' });
    const chevron = summary.createEl('button', {
        cls: 'ert-iconBtn ert-goals-stats-summary__chevron',
        attr: {
            type: 'button',
            'aria-label': 'Expand writing stats',
            'aria-expanded': details.open ? 'true' : 'false',
        },
    });
    setIcon(chevron, details.open ? 'chevron-down' : 'chevron-right');
    chevron.onclick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        details.open = !details.open;
    };
    details.ontoggle = () => {
        chevron.setAttribute('aria-label', details.open ? 'Collapse writing stats' : 'Expand writing stats');
        chevron.setAttribute('aria-expanded', details.open ? 'true' : 'false');
        setIcon(chevron, details.open ? 'chevron-down' : 'chevron-right');
        const settings = plugin.getWritingSessionService().getSettings();
        settings.defaults.writingStatsOpen = details.open;
        void plugin.saveSettings();
    };
    const body = details.createDiv({ cls: 'ert-goals-stats-body' });
    body.createDiv({ cls: ERT_CLASSES.FIELD_NOTE, text: 'Loading writing stats…' });

    const refresh = async () => {
        try {
            const service = plugin.getWritingSessionService();
            const stats = await Promise.all([
                service.getRangeStats(1),
                service.getRangeStats(7),
                service.getRangeStats(30),
                service.getRangeStats(daysInCurrentYearToDate()),
            ]);
            renderStatsBody(plugin, body, stats);
        } catch (error) {
            renderStatsError(body, error instanceof Error ? error.message : 'Could not build writing stats.');
        }
    };

    void refresh();
}

export function renderGoalsSessionsSection({ plugin, containerEl }: GoalsSessionsSectionParams): void {
    containerEl.classList.add(ERT_CLASSES.STACK);

    const heading = new Setting(containerEl)
        .setName(t('settings.goalsSessions.header.name'))
        .setHeading()
        .setDesc(t('settings.goalsSessions.header.desc'));
    addHeadingIcon(heading, 'timer');
    addWikiLink(heading, 'Settings-Core#sessions');
    applyErtHeaderLayout(heading);

    const body = containerEl.createDiv({ cls: ERT_CLASSES.STACK });
    const defaultProfile = ensureDefaultRuntimeProfile(plugin);
    const session = defaultProfile.sessionPlanning ?? {};

    new Setting(body)
        .setName(t('settings.goalsSessions.draftingWpm.name'))
        .setDesc(t('settings.goalsSessions.draftingWpm.desc'))
        .addText((text: TextComponent) => {
            wireNumberInput({
                plugin,
                text,
                currentValue: session.draftingWpm,
                max: 1000,
                onSave: (value) => {
                    const profile = ensureDefaultRuntimeProfile(plugin);
                    profile.sessionPlanning = { ...profile.sessionPlanning, draftingWpm: value };
                },
            });
        });

    new Setting(body)
        .setName(t('settings.goalsSessions.targetMode.name'))
        .setDesc(t('settings.goalsSessions.targetMode.desc'))
        .addDropdown(dropdown => {
            const current = plugin.getWritingSessionService().getSettings().defaults.targetMode ?? 'time';
            dropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected');
            dropdown
                .addOption('time', t('settings.goalsSessions.targetMode.time'))
                .addOption('words', t('settings.goalsSessions.targetMode.words'))
                .addOption('both', t('settings.goalsSessions.targetMode.both'))
                .setValue(current)
                .onChange(async (value) => {
                    await plugin.getWritingSessionService().setDefaultTargetMode(value as WritingSessionTargetMode);
                    fitSelectToSelectedLabel(dropdown.selectEl, { minPx: 112, maxPx: 220, extraPx: 18 });
                });
            fitSelectToSelectedLabel(dropdown.selectEl, { minPx: 112, maxPx: 220, extraPx: 18 });
        });

    new Setting(body)
        .setName(t('settings.goalsSessions.dailyMinutes.name'))
        .setDesc(t('settings.goalsSessions.dailyMinutes.desc'))
        .addText((text: TextComponent) => {
            wireNumberInput({
                plugin,
                text,
                currentValue: session.dailyMinutes,
                max: 1440,
                onSave: (value) => {
                    const profile = ensureDefaultRuntimeProfile(plugin);
                    profile.sessionPlanning = { ...profile.sessionPlanning, dailyMinutes: value };
                },
            });
        });

    new Setting(body)
        .setName(t('settings.goalsSessions.dailyWords.name'))
        .setDesc(t('settings.goalsSessions.dailyWords.desc'))
        .addText((text: TextComponent) => {
            wireNumberInput({
                plugin,
                text,
                currentValue: session.dailyWords,
                max: 50000,
                onSave: (value) => {
                    const profile = ensureDefaultRuntimeProfile(plugin);
                    profile.sessionPlanning = { ...profile.sessionPlanning, dailyWords: value };
                },
            });
        });

    new Setting(body)
        .setName(t('settings.goalsSessions.weeklyGoalDays.name'))
        .setDesc(t('settings.goalsSessions.weeklyGoalDays.desc'))
        .addText((text: TextComponent) => {
            wireNumberInput({
                plugin,
                text,
                currentValue: plugin.getWritingSessionService().getSettings().defaults.weeklyGoalDays ?? 7,
                min: 1,
                max: 7,
                onSave: (value) => {
                    const settings = plugin.getWritingSessionService().getSettings();
                    settings.defaults.weeklyGoalDays = Math.min(7, Math.max(1, Math.round(value ?? 7)));
                },
            });
        });

    renderWritingStatsPanel(plugin, body);
}
