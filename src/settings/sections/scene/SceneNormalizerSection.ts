import { App, ButtonComponent, Modal, Notice, TFile, setIcon, setTooltip, Setting as Settings } from 'obsidian';
import { ERT_CLASSES } from '../../../ui/classes';
import { confirmWithErtModal } from '../../../modals/ErtConfirmModal';
import type RadialTimelinePlugin from '../../../main';
import { t, tCount } from '../../../i18n';
import { addHeadingIcon, addWikiLink, applyErtHeaderLayout } from '../../wikiLink';
import {
    collectFilesForAuditWithScope,
    formatAuditReport,
    formatSemanticWarningChipText,
    formatSemanticWarningReason,
    getSemanticWarningType,
    groupSemanticWarningEntries,
    type NoteAuditEntry,
    type YamlAuditResult,
} from '../../../utils/yamlAudit';
import {
    previewDeleteFields,
    previewReorder,
    type ReorderResult,
} from '../../../utils/yamlManager';
import { buildScenePropertyDefinitions } from '../../../sceneProperties/scenePropertyAdapter';
import {
    analyzeScenes,
    deleteAdvancedSceneFields,
    ensureSceneIds,
    fixDuplicateSceneIds,
    insertMissingAdvancedFields,
    insertMissingCoreFields,
    reorderSceneFields,
} from '../../../sceneProperties/sceneNormalizer';
import type { SceneNormalizationAudit } from '../../../sceneProperties/types';
import { resolveSceneExpectedKeys, resolveScenePropertyPolicy } from '../../../sceneProperties/scenePropertyPolicy';
import { getExcludeKeyPredicate, RESERVED_OBSIDIAN_KEYS } from '../../../utils/yamlTemplateNormalize';
import { formatSafetyIssues } from '../../../utils/yamlSafety';
import { openOrRevealFile } from '../../../utils/fileUtils';
import { getAdvancedMode, shouldEnableRemoveAdvanced } from '../../../scenes/core/scenePropertyState';
import { writeDeletionSnapshot } from '../../../utils/logVaultOps';

function createBadge(container: HTMLElement, text: string): HTMLElement {
    const badge = container.createSpan({
        cls: ['ert-badgePill', 'ert-badgePill--sm', 'ert-badgePill--neutral']
    });
    badge.createSpan({ cls: 'ert-badgePill__text', text });
    return badge;
}

function setButtonDisabled(
    button: ButtonComponent | undefined,
    disabled: boolean,
    disabledReason?: string,
    enabledReason?: string
): void {
    if (!button) return;
    button.setDisabled(disabled);
    const tip = disabled ? disabledReason : enabledReason;
    setTooltip(button.buttonEl, tip ?? '');
}

function setIconButtonDisabled(
    button: HTMLButtonElement | undefined,
    disabled: boolean,
    disabledReason?: string,
    enabledReason?: string
): void {
    if (!button) return;
    button.disabled = disabled;
    const tip = disabled ? disabledReason : enabledReason;
    setTooltip(button, tip ?? '');
}

function toDisplayAuditResult(sceneAudit: SceneNormalizationAudit): YamlAuditResult {
    const notes: NoteAuditEntry[] = sceneAudit.notes.map((note) => ({
        file: note.file,
        missingFields: [...note.missingCoreKeys, ...note.missingAdvancedKeys],
        missingReferenceId: note.missingSceneId,
        duplicateReferenceId: note.duplicateSceneId,
        extraKeys: note.extraKeys,
        orderDrift: note.orderDrift,
        semanticWarnings: note.semanticWarnings,
        reason: note.reason,
        safetyResult: note.safetyResult,
    }));

    return {
        notes,
        unreadFiles: sceneAudit.unreadFiles,
        summary: {
            totalNotes: sceneAudit.summary.totalScenes,
            unreadNotes: sceneAudit.summary.unreadScenes,
            notesWithMissing: notes.filter((note) => note.missingFields.length > 0).length,
            notesMissingIds: sceneAudit.summary.scenesMissingIds,
            notesDuplicateIds: sceneAudit.summary.scenesDuplicateIds,
            notesWithExtra: sceneAudit.summary.scenesWithExtra,
            notesWithDrift: sceneAudit.summary.scenesWithDrift,
            notesWithWarnings: sceneAudit.summary.scenesWithWarnings,
            clean: sceneAudit.summary.clean,
            notesUnsafe: sceneAudit.summary.scenesUnsafe,
            notesSuspicious: sceneAudit.summary.scenesSuspicious,
        },
        safetyResults: sceneAudit.safetyResults,
    };
}

function isEmptyValue(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

function formatBatchNotice(params: {
    updated: number;
    skipped?: number;
    failed?: number;
    skippedText?: (count: number) => string;
}): string {
    const {
        updated,
        skipped = 0,
        failed = 0,
        skippedText = (count: number) => t('ui.sceneNormalizerSection.unchangedCount', { count }),
    } = params;
    const parts: string[] = [];
    if (updated > 0) parts.push(t('ui.sceneNormalizerSection.updatedScenesPart', { scenes: tCount('scene', updated) }));
    if (skipped > 0) parts.push(skippedText(skipped));
    if (failed > 0) parts.push(t('ui.sceneNormalizerSection.failedCount', { count: failed }));
    return parts.join(', ') || t('ui.sceneNormalizerSection.noChangesMade');
}

export function renderSceneNormalizerSection(params: {
    app: App;
    plugin: RadialTimelinePlugin;
    parentEl: HTMLElement;
}): void {
    const { app, plugin, parentEl } = params;

    let sceneAudit: SceneNormalizationAudit | null = null;
    let auditResult: YamlAuditResult | null = null;
    let auditScopeSummary = '';
    let hasCheckedScenes = false;
    let checkedSceneFiles: TFile[] = [];
    const buildPolicyBadge = (): string => (
        getAdvancedMode(plugin.settings) === 'enabled' ? t('ui.sceneNormalizerSection.policyCoreAdvanced') : t('ui.sceneNormalizerSection.policyCoreOnly')
    );

    const headerRow = new Settings(parentEl)
        .setName(t('ui.sceneNormalizerSection.heading'));
    headerRow.settingEl.addClass('ert-scene-properties-row', 'ert-scene-maintenance-row');
    addHeadingIcon(headerRow, 'shield-check');
    addWikiLink(headerRow, 'Settings-Core#scene-properties');
    applyErtHeaderLayout(headerRow);
    const policyBadgeEl = createBadge(headerRow.controlEl, buildPolicyBadge());
    const panel = parentEl.createDiv({ cls: ['ert-panel', 'ert-stack', 'ert-scene-maintenance-panel', 'ert-settings-hidden'] });
    const maintenanceSection = panel.createDiv({ cls: ['ert-stack', 'ert-scene-maintenance-section'] });
    maintenanceSection.createDiv({ cls: 'ert-scene-maintenance-group-label', text: t('ui.sceneNormalizerSection.maintenanceGroup') });
    const maintenanceGroup = maintenanceSection.createDiv({ cls: ['ert-inline-actions', 'ert-scene-maintenance-actions'] });
    const cleanupSection = panel.createDiv({ cls: ['ert-stack', 'ert-scene-maintenance-section', 'ert-scene-maintenance-section--cleanup'] });
    cleanupSection.createDiv({ cls: 'ert-scene-maintenance-group-label', text: t('ui.sceneNormalizerSection.cleanupGroup') });
    const cleanupGroup = cleanupSection.createDiv({ cls: ['ert-inline-actions', 'ert-inline-actions--end', 'ert-scene-maintenance-actions', 'ert-scene-maintenance-actions--cleanup'] });
    const resultsSection = panel.createDiv({ cls: ['ert-stack', 'ert-scene-maintenance-section', 'ert-scene-maintenance-section--results', 'ert-settings-hidden'] });
    resultsSection.createDiv({ cls: 'ert-scene-maintenance-group-label', text: t('ui.sceneNormalizerSection.resultsGroup') });
    const resultsEl = resultsSection.createDiv({ cls: 'ert-audit-results-row' });
    const refreshResultsVisibility = () => {
        resultsSection.toggleClass('ert-settings-hidden', resultsEl.childElementCount === 0);
    };
    const refreshMaintenanceCopy = () => {
        policyBadgeEl.querySelector('.ert-badgePill__text')?.replaceChildren(policyBadgeEl.ownerDocument.createTextNode(buildPolicyBadge()));
        updateButtons();
        if (auditResult && sceneAudit) renderResults();
    };
    parentEl.addEventListener('ert:scene-advanced-maintenance-changed', refreshMaintenanceCopy);

    new ButtonComponent(headerRow.controlEl)
        .setButtonText(t('ui.sceneNormalizerSection.checkNotesButton'))
        .onClick(() => void runCheckScenes());

    let copyBtn: HTMLButtonElement | undefined;
    let addCoreBtn: ButtonComponent | undefined;
    let addAdvancedBtn: ButtonComponent | undefined;
    let addIdsBtn: ButtonComponent | undefined;
    let reorderBtn: ButtonComponent | undefined;
    let removeAdvancedBtn: ButtonComponent | undefined;
    let fixDuplicateBtn: ButtonComponent | undefined;

    const updateButtons = () => {
        const summary = sceneAudit?.summary;
        const notes = sceneAudit?.notes ?? [];
        const advancedMode = getAdvancedMode(plugin.settings);
        const advancedEnabled = advancedMode === 'enabled';
        const removableAdvanced = shouldEnableRemoveAdvanced({
            settings: plugin.settings,
            scenes: checkedSceneFiles
                .map((file) => app.metadataCache.getFileCache(file)?.frontmatter)
                .filter((frontmatter): frontmatter is Record<string, unknown> => !!frontmatter),
        });

        // Operations that actively skip dangerous notes (see yamlManager.ts):
        // reorder and remove advanced. Count only what those operations
        // would actually touch so the button mutes once the non-dangerous
        // work is done.
        const isSafe = (note: typeof notes[number]) => note.safetyResult?.status !== 'dangerous';
        const actionableDrift = notes.filter((n) => n.orderDrift && isSafe(n)).length;
        const driftBlockedByUnsafe = (summary?.scenesWithDrift ?? 0) - actionableDrift;
        const driftBlockedSuffix = driftBlockedByUnsafe > 0
            ? ` ${t('ui.sceneNormalizerSection.driftBlockedSuffix', { notes: tCount('unsafeNote', driftBlockedByUnsafe) })}`
            : '';

        const uncheckedHint = hasCheckedScenes
            ? undefined
            : t('ui.sceneNormalizerSection.uncheckedHint');

        setIconButtonDisabled(copyBtn, !sceneAudit, sceneAudit ? undefined : t('ui.sceneNormalizerSection.copyUncheckedHint'));
        setButtonDisabled(
            addCoreBtn,
            !summary || summary.scenesWithMissingCore === 0,
            uncheckedHint || t('ui.sceneNormalizerSection.coreCompleteTooltip'),
            t('ui.sceneNormalizerSection.addCoreTooltip', { scenes: tCount('scene', summary?.scenesWithMissingCore ?? 0) })
        );
        setButtonDisabled(
            addAdvancedBtn,
            !advancedEnabled || !summary || summary.scenesWithMissingAdvanced === 0,
            !advancedEnabled
                ? t('ui.sceneNormalizerSection.advancedDisabledTooltip')
                : (uncheckedHint || t('ui.sceneNormalizerSection.advancedCompleteTooltip')),
            t('ui.sceneNormalizerSection.addAdvancedTooltip', { scenes: tCount('scene', summary?.scenesWithMissingAdvanced ?? 0) })
        );
        setButtonDisabled(
            addIdsBtn,
            !summary || summary.scenesMissingIds === 0,
            uncheckedHint || t('ui.sceneNormalizerSection.idsCompleteTooltip'),
            t('ui.sceneNormalizerSection.addIdsTooltip', { scenes: tCount('scene', summary?.scenesMissingIds ?? 0) })
        );
        setButtonDisabled(
            reorderBtn,
            !summary || actionableDrift === 0,
            uncheckedHint || `${t('ui.sceneNormalizerSection.orderCompleteTooltip')}${driftBlockedSuffix}`,
            `${t('ui.sceneNormalizerSection.reorderTooltip', { scenes: tCount('scene', actionableDrift) })}${driftBlockedSuffix}`
        );
        setButtonDisabled(
            removeAdvancedBtn,
            !removableAdvanced,
            advancedMode === 'enabled'
                ? t('ui.sceneNormalizerSection.removeMaintainedTooltip')
                : (uncheckedHint || t('ui.sceneNormalizerSection.removeNothingTooltip'))
        );
        setButtonDisabled(
            fixDuplicateBtn,
            !summary || summary.scenesDuplicateIds === 0,
            uncheckedHint || t('ui.sceneNormalizerSection.noDuplicatesTooltip'),
            t('ui.sceneNormalizerSection.fixDuplicatesTooltip', { ids: tCount('duplicateSceneId', summary?.scenesDuplicateIds ?? 0) })
        );
    };

    const renderResults = () => {
        resultsEl.empty();
        if (!auditResult || !sceneAudit) {
            refreshResultsVisibility();
            return;
        }

        const summary = auditResult.summary;
        const advancedEnabled = getAdvancedMode(plugin.settings) === 'enabled';
        const healthLevel = (summary.notesUnsafe > 0)
            ? 'unsafe'
            : (summary.notesMissingIds > 0 || summary.notesDuplicateIds > 0)
                ? 'critical'
                : (sceneAudit.summary.scenesWithMissingCore > 0 || sceneAudit.summary.scenesWithMissingAdvanced > 0)
                    ? 'needs-attention'
                    : (summary.notesWithExtra > 0 || summary.notesWithDrift > 0 || summary.notesWithWarnings > 0 || summary.notesSuspicious > 0)
                        ? 'mixed'
                        : 'clean';
        const healthLabels: Record<string, string> = {
            clean: t('ui.sceneNormalizerSection.healthClean'),
            mixed: t('ui.sceneNormalizerSection.healthMixed'),
            'needs-attention': t('ui.sceneNormalizerSection.healthNeedsAttention'),
            critical: t('ui.sceneNormalizerSection.healthCritical'),
            unsafe: t('ui.sceneNormalizerSection.healthUnsafe'),
        };
        const warningsOnly = healthLevel === 'mixed'
            && summary.notesWithWarnings > 0
            && summary.notesWithExtra === 0
            && summary.notesWithDrift === 0
            && summary.notesMissingIds === 0
            && summary.notesDuplicateIds === 0
            && sceneAudit.summary.scenesWithMissingCore === 0
            && sceneAudit.summary.scenesWithMissingAdvanced === 0
            && summary.notesSuspicious === 0
            && summary.notesUnsafe === 0;

        const headerEl = resultsEl.createDiv({ cls: 'ert-audit-result-header' });
        const statusEl = headerEl.createSpan({ cls: `ert-audit-health ert-audit-health--${healthLevel}` });
        statusEl.textContent = t('ui.sceneNormalizerSection.statusLine', { status: warningsOnly ? t('ui.sceneNormalizerSection.warningsToReview') : healthLabels[healthLevel] });
        headerEl.createSpan({ text: ` · ${t('ui.sceneNormalizerSection.scopeLine', { scope: auditScopeSummary })}`, cls: 'ert-audit-summary' });

        if (
            summary.clean === summary.totalNotes
            && summary.unreadNotes === 0
            && summary.notesWithWarnings === 0
            && summary.notesUnsafe === 0
            && summary.notesSuspicious === 0
            && summary.notesMissingIds === 0
            && summary.notesDuplicateIds === 0
        ) {
            resultsEl.createDiv({
                text: t('ui.sceneNormalizerSection.allScenesClean', { count: summary.totalNotes }),
                cls: 'ert-audit-clean'
            });
            return;
        }

        type ChipConfig = {
            key: string;
            label: string;
            displayText?: string;
            kind: 'critical' | 'duplicate' | 'missing' | 'extra' | 'drift' | 'warning' | 'unsafe' | 'suspicious';
            warningType?: string;
            entries: NoteAuditEntry[];
        };
        const warningChips: ChipConfig[] = groupSemanticWarningEntries(auditResult.notes).map((group) => ({
            key: `warning:${group.label}`,
            label: group.label,
            displayText: formatSemanticWarningChipText(group),
            kind: 'warning' as const,
            warningType: group.label,
            entries: group.entries,
        }));
        /** A fixed audit category; its chip reads as a count plus the category, e.g. "3 missing ids". */
        const staticChip = (
            key: string,
            label: string,
            kind: ChipConfig['kind'],
            entries: NoteAuditEntry[],
            displayText: (count: number) => string
        ): ChipConfig => ({ key, label, kind, entries, displayText: displayText(entries.length) });
        const chips: ChipConfig[] = [
            staticChip('missing-ids', 'Missing IDs', 'critical', auditResult.notes.filter((note) => note.missingReferenceId),
                (count) => t('ui.sceneNormalizerSection.chipMissingIds', { count })),
            staticChip('duplicate-ids', 'Duplicate IDs', 'duplicate', auditResult.notes.filter((note) => !!note.duplicateReferenceId),
                (count) => t('ui.sceneNormalizerSection.chipDuplicateIds', { count })),
            staticChip('unsafe', 'Unsafe', 'unsafe', auditResult.notes.filter((note) => note.safetyResult?.status === 'dangerous'),
                (count) => t('ui.sceneNormalizerSection.chipUnsafe', { count })),
            staticChip('suspicious', 'Needs review', 'suspicious', auditResult.notes.filter((note) => note.safetyResult?.status === 'suspicious'),
                (count) => t('ui.sceneNormalizerSection.chipNeedsReview', { count })),
            staticChip('missing', advancedEnabled ? 'Missing properties' : 'Missing core properties', 'missing', auditResult.notes.filter((note) => note.missingFields.length > 0),
                (count) => advancedEnabled
                    ? t('ui.sceneNormalizerSection.chipMissingProperties', { count })
                    : t('ui.sceneNormalizerSection.chipMissingCoreProperties', { count })),
            staticChip('extra', 'Other plugin keys (read-only)', 'extra', auditResult.notes.filter((note) => note.extraKeys.length > 0),
                (count) => t('ui.sceneNormalizerSection.chipOtherKeys', { count })),
            staticChip('drift', 'Layout cleanup', 'drift', auditResult.notes.filter((note) => note.orderDrift),
                (count) => t('ui.sceneNormalizerSection.chipLayoutCleanup', { count })),
            ...warningChips,
        ];
        const visibleChips = chips.filter((chip) => chip.entries.length > 0);

        let activeKey: string | null = visibleChips[0]?.key ?? null;
        let page = 0;
        const chipsEl = resultsEl.createDiv({ cls: 'ert-audit-chips' });
        const detailsEl = resultsEl.createDiv({ cls: 'ert-audit-details' });

        const renderChips = () => {
            chipsEl.empty();
            visibleChips.forEach((chip) => {
                const styleKind = chip.kind === 'duplicate' ? 'critical' : chip.kind;
                const chipBtn = chipsEl.createEl('button', {
                    cls: `ert-chip ert-audit-chip ert-audit-chip--${styleKind}${activeKey === chip.key ? ' is-active' : ''}`,
                    text: chip.displayText ?? `${chip.entries.length} ${chip.label.toLowerCase()}`,
                    attr: { type: 'button' }
                });
                chipBtn.addEventListener('click', () => {
                    activeKey = activeKey === chip.key ? null : chip.key;
                    page = 0;
                    renderChips();
                    renderNoteList();
                });
            });
            if (summary.clean > 0) {
                chipsEl.createSpan({ text: t('ui.sceneNormalizerSection.cleanChip', { count: summary.clean }), cls: 'ert-chip ert-audit-chip ert-audit-chip--clean' });
            }
        };

        const renderNoteList = () => {
            detailsEl.empty();
            if (!activeKey) return;
            const activeChip = visibleChips.find((chip) => chip.key === activeKey);
            if (!activeChip) return;

            const total = activeChip.entries.length;
            const pageSize = 5;
            const start = page * pageSize;
            const end = Math.min(start + pageSize, total);
            const pageEntries = activeChip.entries.slice(start, end);
            const pillsEl = detailsEl.createDiv({ cls: 'ert-audit-note-pills' });

            for (const entry of pageEntries) {
                let reason = entry.reason;
                if (activeChip.kind === 'extra') {
                    reason = t('ui.sceneNormalizerSection.notManagedReason', { keys: entry.extraKeys.join(', ') });
                } else if (activeChip.kind === 'drift') {
                    reason = t('ui.sceneNormalizerSection.orderDiffersReason');
                } else if (activeChip.kind === 'critical') {
                    reason = t('ui.sceneNormalizerSection.missingSceneIdReason');
                } else if (activeChip.kind === 'duplicate') {
                    reason = entry.duplicateReferenceId
                        ? t('ui.sceneNormalizerSection.duplicateSceneIdValue', { id: entry.duplicateReferenceId })
                        : t('ui.sceneNormalizerSection.duplicateSceneIdReason');
                } else if (activeChip.kind === 'warning') {
                    const warnings = activeChip.warningType
                        ? entry.semanticWarnings.filter((warning) => getSemanticWarningType(warning) === activeChip.warningType)
                        : entry.semanticWarnings;
                    reason = formatSemanticWarningReason(warnings);
                }

                const pillStyleKind = activeChip.kind === 'duplicate' ? 'critical' : activeChip.kind;
                const pillEl = pillsEl.createEl('button', {
                    cls: `ert-audit-note-pill ert-audit-note-pill--${pillStyleKind}`,
                    attr: { type: 'button' }
                });
                if (entry.safetyResult?.status === 'dangerous') {
                    const badge = pillEl.createSpan({ cls: 'ert-audit-safety-badge ert-audit-safety-badge--danger' });
                    badge.setText('!');
                    setTooltip(badge, formatSafetyIssues(entry.safetyResult));
                } else if (entry.safetyResult?.status === 'suspicious') {
                    const badge = pillEl.createSpan({ cls: 'ert-audit-safety-badge ert-audit-safety-badge--warning' });
                    badge.setText('?');
                    setTooltip(badge, formatSafetyIssues(entry.safetyResult));
                }
                pillEl.createSpan({ text: entry.file.basename, cls: 'ert-audit-note-pill-name' });
                pillEl.createSpan({ text: ` — ${reason}`, cls: 'ert-audit-note-pill-reason' });
                setTooltip(pillEl, `${entry.file.basename}: ${reason}`);
                pillEl.addEventListener('click', () => { void (async () => {
                    await openOrRevealFile(app, entry.file, false);
                    new Notice(reason);
                })(); });
            }

            const navEl = detailsEl.createDiv({ cls: 'ert-audit-pagination' });
            navEl.createSpan({ cls: 'ert-audit-pagination-label', text: t('ui.sceneNormalizerSection.paginationLabel', { start: start + 1, end, total }) });
            if (page > 0) {
                const prevBtn = navEl.createEl('button', { text: t('ui.sceneNormalizerSection.prevButton'), cls: 'ert-audit-nav-btn', attr: { type: 'button' } });
                prevBtn.addEventListener('click', () => {
                    page -= 1;
                    renderNoteList();
                });
            }
            if (end < total) {
                const nextBtn = navEl.createEl('button', { text: t('ui.sceneNormalizerSection.nextButton', { count: Math.min(pageSize, total - end) }), cls: 'ert-audit-nav-btn', attr: { type: 'button' } });
                nextBtn.addEventListener('click', () => {
                    page += 1;
                    renderNoteList();
                });
            }
        };

        renderChips();
        renderNoteList();
        refreshResultsVisibility();
    };

    const runCheckScenes = async () => {
        panel.classList.remove('ert-settings-hidden');
        hasCheckedScenes = true;
        updateButtons();
        const auditScope = collectFilesForAuditWithScope(app, 'Scene', plugin.settings);
        checkedSceneFiles = auditScope.files;
        auditScopeSummary = auditScope.scopeSummary;
        if (auditScope.reason) {
            resultsEl.empty();
            resultsEl.createDiv({ text: auditScope.reason, cls: 'ert-audit-clean' });
            refreshResultsVisibility();
            sceneAudit = null;
            auditResult = null;
            checkedSceneFiles = [];
            updateButtons();
            new Notice(auditScope.reason);
            return;
        }
        if (auditScope.files.length === 0) {
            resultsEl.empty();
            resultsEl.createDiv({ text: t('ui.sceneNormalizerSection.noScenesInScope'), cls: 'ert-audit-clean' });
            refreshResultsVisibility();
            sceneAudit = null;
            auditResult = null;
            checkedSceneFiles = [];
            updateButtons();
            return;
        }

        sceneAudit = await analyzeScenes({
            app,
            settings: plugin.settings,
            files: auditScope.files,
            includeSafetyScan: true,
        });
        auditResult = toDisplayAuditResult(sceneAudit);
        updateButtons();
        renderResults();
    };

    copyBtn = cleanupGroup.createEl('button', {
        cls: [ERT_CLASSES.ICON_BTN],
        attr: { type: 'button', 'aria-label': t('ui.sceneNormalizerSection.copyReportTooltip') }
    });
    setIcon(copyBtn, 'clipboard-copy');
    setTooltip(copyBtn, t('ui.sceneNormalizerSection.copyReportTooltip'));
    copyBtn.addEventListener('click', () => {
        if (!auditResult) return;
        const report = formatAuditReport(auditResult, 'Scene');
        void navigator.clipboard.writeText(report).then(() => new Notice(t('ui.sceneNormalizerSection.reportCopiedNotice')));
    });

    addCoreBtn = new ButtonComponent(maintenanceGroup)
        .setButtonText(t('ui.sceneNormalizerSection.addCoreButton'))
        .onClick(async () => {
            if (!sceneAudit) return;
            const targetFiles = sceneAudit.notes.filter((note) => note.missingCoreKeys.length > 0).map((note) => note.file);
            if (targetFiles.length === 0) return;
            const result = await insertMissingCoreFields({ app, settings: plugin.settings, files: targetFiles, audit: sceneAudit });
            new Notice(result.updated > 0 ? t('ui.sceneNormalizerSection.updatedScenesNotice', { scenes: tCount('scene', result.updated) }) : t('ui.sceneNormalizerSection.noChangesMade'));
            window.setTimeout(() => { void runCheckScenes(); }, 750);
        });

    addAdvancedBtn = new ButtonComponent(maintenanceGroup)
        .setButtonText(t('ui.sceneNormalizerSection.addAdvancedButton'))
        .onClick(async () => {
            if (!sceneAudit) return;
            const targetFiles = sceneAudit.notes.filter((note) => note.missingAdvancedKeys.length > 0).map((note) => note.file);
            if (targetFiles.length === 0) return;
            const result = await insertMissingAdvancedFields({ app, settings: plugin.settings, files: targetFiles, audit: sceneAudit });
            new Notice(result.updated > 0 ? t('ui.sceneNormalizerSection.updatedScenesNotice', { scenes: tCount('scene', result.updated) }) : t('ui.sceneNormalizerSection.noChangesMade'));
            window.setTimeout(() => { void runCheckScenes(); }, 750);
        });

    addIdsBtn = new ButtonComponent(maintenanceGroup)
        .setButtonText(t('ui.sceneNormalizerSection.addIdsButton'))
        .onClick(async () => {
            if (!sceneAudit) return;
            const result = await ensureSceneIds({
                app,
                settings: plugin.settings,
                files: sceneAudit.notes.filter((note) => note.missingSceneId).map((note) => note.file),
            });
            if (result.failed > 0) {
                console.warn('[Radial Timeline] Failed to add missing scene IDs.', result.errors);
            }
            new Notice(formatBatchNotice({
                updated: result.updated,
                skipped: result.skipped,
                failed: result.failed,
                skippedText: (count) => t('ui.sceneNormalizerSection.alreadyHadIds', { count }),
            }));
            window.setTimeout(() => { void runCheckScenes(); }, 750);
        });

    reorderBtn = new ButtonComponent(maintenanceGroup)
        .setButtonText(t('ui.sceneNormalizerSection.reorderButton'))
        .onClick(async () => {
            if (!sceneAudit || !auditResult) return;
            const notesWithDrift = sceneAudit.notes.filter((note) => note.orderDrift && note.safetyResult?.status !== 'dangerous');
            if (notesWithDrift.length === 0) return;

            const expectedKeys = resolveSceneExpectedKeys(
                plugin.settings,
                buildScenePropertyDefinitions(plugin.settings),
                resolveScenePropertyPolicy(plugin.settings)
            );
            const canonicalOrder = expectedKeys.canonicalOrder;
            const baseDynamic = getExcludeKeyPredicate('Scene', plugin.settings);
            const inactiveAdvancedSet = new Set(expectedKeys.toleratedInactiveKeys);
            const isDynamic = (key: string) => baseDynamic(key) || inactiveAdvancedSet.has(key);
            const preview = previewReorder(app, notesWithDrift[0].file, canonicalOrder, isDynamic);

            const confirmed = await new Promise<boolean>((resolve) => {
                const modal = new Modal(app);
                modal.titleEl.setText('');
                modal.contentEl.empty();
                modal.modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
                modal.contentEl.addClass('ert-modal-container', 'ert-stack');
                const header = modal.contentEl.createDiv({ cls: 'ert-modal-header' });
                header.createSpan({ cls: 'ert-modal-badge', text: t('ui.sceneNormalizerSection.reorderModalBadge') });
                header.createDiv({ cls: 'ert-modal-title', text: t('ui.sceneNormalizerSection.reorderButton') });
                header.createDiv({ cls: 'ert-modal-subtitle', text: t('ui.sceneNormalizerSection.reorderModalSubtitle', { scenes: tCount('scene', notesWithDrift.length) }) });
                const body = modal.contentEl.createDiv({ cls: ['ert-panel', 'ert-panel--glass'] });
                body.createDiv({ text: t('ui.sceneNormalizerSection.scopeLine', { scope: auditScopeSummary }), cls: 'ert-modal-subtitle' });
                body.createDiv({ text: t('ui.sceneNormalizerSection.reorderModalBody') });
                if (preview) {
                    body.createDiv({ text: t('ui.sceneNormalizerSection.reorderPreviewLabel', { name: notesWithDrift[0].file.basename }), cls: 'ert-modal-subtitle' });
                    const beforeAfter = body.createDiv({ cls: 'ert-reorder-preview' });
                    const beforeCol = beforeAfter.createDiv({ cls: 'ert-reorder-preview-col' });
                    beforeCol.createDiv({ text: t('ui.sceneNormalizerSection.beforeLabel'), cls: 'ert-reorder-preview-label' });
                    const beforeList = beforeCol.createEl('ol');
                    preview.before.forEach((key) => beforeList.createEl('li', { text: key }));
                    const afterCol = beforeAfter.createDiv({ cls: 'ert-reorder-preview-col' });
                    afterCol.createDiv({ text: t('ui.sceneNormalizerSection.afterLabel'), cls: 'ert-reorder-preview-label' });
                    const afterList = afterCol.createEl('ol');
                    preview.after.forEach((key) => afterList.createEl('li', { text: key }));
                }
                const footer = modal.contentEl.createDiv({ cls: 'ert-modal-actions' });
                new ButtonComponent(footer).setButtonText(t('ui.sceneNormalizerSection.reorderConfirmButton')).setCta().onClick(() => { resolve(true); modal.close(); });
                new ButtonComponent(footer).setButtonText(t('common.cancel')).onClick(() => { resolve(false); modal.close(); });
                modal.onClose = () => resolve(false);
                modal.open();
            });
            if (!confirmed) return;

            const result: ReorderResult = await reorderSceneFields({
                app,
                settings: plugin.settings,
                files: notesWithDrift.map((note) => note.file),
                audit: sceneAudit,
            });
            new Notice(result.reordered > 0 ? t('ui.sceneNormalizerSection.reorderedScenesNotice', { scenes: tCount('scene', result.reordered) }) : t('ui.sceneNormalizerSection.noChangesMade'));
            window.setTimeout(() => { void runCheckScenes(); }, 750);
        });

    removeAdvancedBtn = new ButtonComponent(cleanupGroup)
        .setButtonText(t('ui.sceneNormalizerSection.removeAdvancedButton'))
        .setDestructive()
        .onClick(async () => {
            if (!sceneAudit) return;
            const targetFiles = checkedSceneFiles.filter((file) => {
                const note = sceneAudit?.notes.find((entry) => entry.file.path === file.path);
                if (note?.safetyResult?.status === 'dangerous') return false;
                const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
                return !!frontmatter && shouldEnableRemoveAdvanced({
                    settings: plugin.settings,
                    scenes: [frontmatter],
                });
            });
            if (targetFiles.length === 0) return;
            const advancedKeys = buildScenePropertyDefinitions(plugin.settings).advanced.map((definition) => definition.key);
            const protectedKeys = new Set([
                ...buildScenePropertyDefinitions(plugin.settings).core.map((definition) => definition.key),
                ...RESERVED_OBSIDIAN_KEYS,
            ]);
            const preview = previewDeleteFields(app, targetFiles, advancedKeys, protectedKeys);
            let deletionSnapshotPath: string | null = null;
            for (const [, detail] of preview.entries()) {
                if (detail.fields.some((field) => !isEmptyValue(detail.values[field]))) {
                    deletionSnapshotPath = await writeDeletionSnapshot(app, {
                        noteType: 'Scene',
                        operation: 'delete_advanced',
                        preview,
                        scopeSummary: auditScopeSummary,
                    });
                    break;
                }
            }
            const result = await deleteAdvancedSceneFields({
                app,
                settings: plugin.settings,
                files: targetFiles,
                audit: sceneAudit,
            });
            const parts = [];
            if (result.deleted > 0) parts.push(t('ui.sceneNormalizerSection.cleanedScenes', { scenes: tCount('scene', result.deleted) }));
            if (deletionSnapshotPath) parts.push(t('ui.sceneNormalizerSection.snapshotPath', { path: deletionSnapshotPath }));
            new Notice(parts.join(', ') || t('ui.sceneNormalizerSection.noChangesMade'));
            window.setTimeout(() => { void runCheckScenes(); }, 750);
        });

    fixDuplicateBtn = new ButtonComponent(cleanupGroup)
        .setButtonText(t('ui.sceneNormalizerSection.fixDuplicatesButton'))
        .setDestructive()
        .onClick(async () => {
            if (!sceneAudit) return;
            const targetFiles = [...new Set(sceneAudit.notes.filter((note) => !!note.duplicateSceneId).map((note) => note.file))];
            if (targetFiles.length === 0) return;
            const sourceBookId = plugin.settings.activeBookId;
            const sourcePath = plugin.settings.sourcePath;
            const groups = new Map<string, string[]>();
            for (const note of sceneAudit.notes) {
                if (!note.duplicateSceneId) continue;
                const paths = groups.get(note.duplicateSceneId) ?? []; // SAFE: first member starts a new preview group
                paths.push(note.file.path);
                groups.set(note.duplicateSceneId, paths);
            }
            const preview = [...groups].map(([id, paths]) => {
                paths.sort((a, b) => a.localeCompare(b));
                return t('ui.sceneNormalizerSection.duplicatePreviewLine', { id, path: paths[0], paths: paths.slice(1).join(', ') });
            }).join('\n');
            if (!await confirmWithErtModal(app, {
                title: t('ui.sceneNormalizerSection.fixDuplicatesButton'),
                message: t('ui.sceneNormalizerSection.fixDuplicatesMessage', { preview }),
                confirmText: t('ui.sceneNormalizerSection.fixIdsConfirm'),
            })) return;
            if (sourceBookId !== plugin.settings.activeBookId || sourcePath !== plugin.settings.sourcePath) {
                new Notice(t('ui.sceneNormalizerSection.bookChangedNotice'));
                return;
            }
            const result = await fixDuplicateSceneIds({
                app,
                settings: plugin.settings,
                files: targetFiles,
            });
            if (result.failed > 0) {
                console.warn('[Radial Timeline] Failed to fix duplicate scene IDs.', result.errors);
            }
            new Notice(formatBatchNotice({
                updated: result.updated,
                skipped: result.skipped,
                failed: result.failed,
            }));
            window.setTimeout(() => { void runCheckScenes(); }, 750);
        });

    refreshMaintenanceCopy();
    refreshResultsVisibility();
}
