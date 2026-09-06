import { App, ButtonComponent, Component, Modal, normalizePath, Notice, setIcon, Setting as Settings, setTooltip, TFile } from 'obsidian';
import { t } from '../../../i18n';
import type RadialTimelinePlugin from '../../../main';
import { describeStructuralStatus } from '../../../storyBeats/beatSystemStatus';
import type { BeatSystemStructuralStatus } from '../../../storyBeats/types';
import { getLoadedBeatTabWorkspaceSystemId } from '../../../storyBeats/workspaceState';
import type { LoadedBeatTab } from '../../../types/settings';
import { openOrRevealFile } from '../../../utils/fileUtils';
import { getActiveFrontmatterMappings } from '../../../utils/frontmatter';
import { writeDeletionSnapshot } from '../../../utils/logVaultOps';
import { runReferenceIdBackfill, runReferenceIdDuplicateRepair } from '../../../utils/referenceIdBackfill';
import { collectFilesForAudit, collectFilesForAuditWithScope, formatAuditReport, formatSemanticWarningChipText, formatSemanticWarningReason, getSemanticWarningType, groupSemanticWarningEntries, runYamlAudit, type NoteAuditEntry, type YamlAuditResult, } from '../../../utils/yamlAudit';
import { planDeprecatedFieldMigration, planFillEmptyValues, runBackdropSynopsisToContextMigration, runBeatDescriptionToPurposeMigration, runYamlBackfill, runYamlFillEmptyValues, type BackfillResult, type DeprecatedMigrationPlan, type FillEmptyPlan } from '../../../utils/yamlBackfill';
import { previewDeleteFields, previewReorder, runYamlDeleteFields, runYamlReorder, summarizeDeletePreview, type DeleteResult, type ReorderResult } from '../../../utils/yamlManager';
import { formatSafetyIssues } from '../../../utils/yamlSafety';
import { computeCanonicalOrder, getCustomDefaults, getCustomKeys, getExcludeKeyPredicate, getTemplateParts, RESERVED_OBSIDIAN_KEYS, extractKeysInOrder as sharedExtractKeysInOrder, type NoteType } from '../../../utils/yamlTemplateNormalize';
import { confirmAudit } from './confirmAudit';
import { dirtyState } from './dirtyState';

export interface YamlAuditPanelControls {
    refreshPrimaryAction: () => void;
    reset: () => void;
    refreshDefaults: () => void;
    run: () => Promise<void>;
}
export interface BeatAuditWorkspace {
    getActiveTab: () => LoadedBeatTab | undefined;
    isEditable: () => boolean;
    isDirty: () => boolean;
    save: () => Promise<void>;
    getStructuralStatus: () => BeatSystemStructuralStatus;
}
/** Owns the audit result, event subscription and delayed refreshes for one panel. */
export function renderYamlAuditPanel(parentEl: HTMLElement, options: {
    app: App;
    plugin: RadialTimelinePlugin;
    scope: Component;
    beatSystemKey?: string;
} & ({ noteType: 'Beat'; workspace: BeatAuditWorkspace }
    | { noteType: Exclude<NoteType, 'Beat'>; workspace?: never })): YamlAuditPanelControls {
    const { app, plugin, scope, noteType, beatSystemKey, workspace } = options;
    const panelScope = scope.addChild(new Component());
    let disposed = false;
    let auditRevision = 0;
    const timers = new Set<number>();
    panelScope.register(() => {
        disposed = true;
        timers.forEach(id => window.clearTimeout(id));
        timers.clear();
    });
    const scheduleAuditRefresh = (run: () => Promise<void>) => {
        if (disposed) return;
        const id = window.setTimeout(() => { timers.delete(id); void run(); }, 750);
        timers.add(id);
    };
    const AUDIT_PAGE_SIZE = 5;
    const AUDIT_OPEN_ALL_MAX = 25;

    let auditResult: YamlAuditResult | null = null;
    let structuralStatus: BeatSystemStructuralStatus | null = null;
    let auditScopeSummary = '';
    let fillEmptyPlan: FillEmptyPlan | null = null;
    let deprecatedMigrationPlan: DeprecatedMigrationPlan | null = null;

    const resolveBeatAuditSystemKey = (): string | undefined => {
        if (noteType !== 'Beat') return beatSystemKey;
        const activeTab = workspace?.getActiveTab();
        if (!activeTab) return beatSystemKey;
        return activeTab.sourceKind === 'builtin'
            ? activeTab.name
            : `custom:${getLoadedBeatTabWorkspaceSystemId(activeTab)}`;
    };
    const isCustomBeatAudit = (): boolean => {
        const activeBeatSystemKey = resolveBeatAuditSystemKey();
        return noteType === 'Beat'
            && (workspace?.isEditable() ?? false)
            && !!activeBeatSystemKey
            && activeBeatSystemKey.startsWith('custom:');
    };
    const isCustomBeatSetOfficial = (): boolean => {
        if (!isCustomBeatAudit()) return false;
        const activeTab = workspace?.getActiveTab();
        if (!activeTab) return false;
        if (activeTab.sourceKind !== 'saved') return false;
        if ((workspace?.isDirty() ?? false)) return false;
        return true;
    };
    const isBeatAuditWriteReady = (): boolean => {
        if (noteType !== 'Beat') return true;
        if (!(workspace?.isEditable() ?? false)) return true;
        return isCustomBeatSetOfficial();
    };
    const buildFillEmptyPlan = (files: TFile[], activeBeatSystemKey?: string): FillEmptyPlan | null => {
        if (!isBeatAuditWriteReady()) return null;
        return planFillEmptyValues({
            app,
            files,
            sourcePath: normalizePath((plugin.settings.sourcePath || '').trim()),
            customKeys: getCustomKeys('Beat', plugin.settings, activeBeatSystemKey),
            defaults: getCustomDefaults('Beat', plugin.settings, activeBeatSystemKey)
        });
    };
    const buildDeprecatedMigrationPlan = (files: TFile[]): DeprecatedMigrationPlan | null => {
        if (noteType !== 'Beat' && noteType !== 'Backdrop') return null;
        return planDeprecatedFieldMigration({ app, files, noteType, mappings: getActiveFrontmatterMappings(plugin.settings) });
    };

    // ─── Header row: two-column Setting layout (title+desc left, audit button right) ──
    const auditSetting = new Settings(parentEl)
        .setName(`Check ${noteType.toLowerCase()} properties`)
        .setDesc(
            isCustomBeatAudit()
                ? 'Check beat notes for missing properties, empty custom-field values, IDs, and property order issues.'
                : `Check ${noteType.toLowerCase()} notes for missing properties, unused fields, IDs, and property order issues.`
        );
    auditSetting.settingEl.addClass('ert-audit-setting');
    auditSetting.infoEl.addClass('ert-audit-setting-info');

    // Copy button (hidden until audit runs)
    let copyBtn: HTMLButtonElement | undefined;
    auditSetting.addButton(button => {
        button
            .setIcon('clipboard-copy')
            .setTooltip(t('settings.beats.audit.copyTooltip'))
            .onClick(() => {
                if (!auditResult) return;
                const report = formatAuditReport(auditResult, noteType);
                void navigator.clipboard.writeText(report).then(() => {
                    new Notice(t('settings.beats.audit.copiedNotice'));
                });
            });
        copyBtn = button.buttonEl;
        copyBtn.classList.add('ert-settings-hidden');
    });

    // Insert missing fields button (hidden until audit finds missing fields)
    let backfillBtn: HTMLButtonElement | undefined;
    auditSetting.addButton(button => {
        button
            .setButtonText(t('settings.beats.audit.insertFieldsText'))
            .setTooltip(t('settings.beats.audit.insertFieldsTooltip'))
            .onClick(() => void handleBackfill());
        backfillBtn = button.buttonEl;
        backfillBtn.classList.add('ert-settings-hidden');
    });
    // Insert missing IDs button (hidden until audit finds missing IDs)
    let insertMissingIdsBtn: HTMLButtonElement | undefined;
    auditSetting.addButton(button => {
        button
            .setButtonText(t('settings.beats.audit.insertIdsText'))
            .setTooltip(t('settings.beats.audit.insertIdsTooltip'))
            .onClick(() => void handleInsertMissingIds());
        insertMissingIdsBtn = button.buttonEl;
        insertMissingIdsBtn.classList.add('ert-settings-hidden');
    });
    let fixDuplicateIdsBtn: HTMLButtonElement | undefined;
    auditSetting.addButton(button => {
        button
            .setButtonText(t('settings.beats.audit.fixDuplicateIdsText'))
            .setTooltip(t('settings.beats.audit.fixDuplicateIdsTooltip'))
            .onClick(() => void handleFixDuplicateIds());
        fixDuplicateIdsBtn = button.buttonEl;
        fixDuplicateIdsBtn.classList.add('ert-settings-hidden');
    });
    let fillEmptyBtn: HTMLButtonElement | undefined;
    auditSetting.addButton(button => {
        button
            .setButtonText(t('settings.beats.audit.fillEmptyText'))
            .setTooltip(t('settings.beats.audit.fillEmptyTooltip'))
            .onClick(() => void handleFillEmptyValues());
        fillEmptyBtn = button.buttonEl;
        fillEmptyBtn.classList.add('ert-settings-hidden');
    });

    // Migrate deprecated fields button (hidden until audit finds legacy keys with safe migration path)
    let migrateDeprecatedBtn: HTMLButtonElement | undefined;
    auditSetting.addButton(button => {
        button
            .setButtonText(t('settings.beats.audit.migrateDeprecatedText'))
            .setTooltip(t('settings.beats.audit.migrateDeprecatedTooltip'))
            .onClick(() => void handleMigrateDeprecatedFields());
        migrateDeprecatedBtn = button.buttonEl;
        migrateDeprecatedBtn.classList.add('ert-settings-hidden');
    });

    // Delete custom fields button (hidden until custom template has keys)
    let deleteAdvancedBtn: HTMLButtonElement | undefined;
    auditSetting.addButton(button => {
        button
            .setButtonText(t('settings.beats.audit.deleteCustomText'))
            .setTooltip(t('settings.beats.audit.deleteCustomTooltip'))
            .onClick(() => void handleDeleteAdvancedFields());
        deleteAdvancedBtn = button.buttonEl;
        deleteAdvancedBtn.classList.add('ert-settings-hidden');
    });

    // Reorder fields button (hidden until audit finds order drift)
    let reorderBtn: HTMLButtonElement | undefined;
    auditSetting.addButton(button => {
        button
            .setButtonText(t('settings.beats.audit.reorderText'))
            .setTooltip(t('settings.beats.audit.reorderTooltip'))
            .onClick(() => void handleReorderFields());
        reorderBtn = button.buttonEl;
        reorderBtn.classList.add('ert-settings-hidden');
    });

    // Run audit button — disabled when no notes of this type exist
    let auditBtn: ButtonComponent | undefined;
    let auditPrimaryAction: (() => void | Promise<void>) | null = null;
    const updateAuditPrimaryAction = () => {
        if (!auditBtn) return;
        const isBeatFieldsStage = noteType === 'Beat' && (workspace?.isEditable() ?? false);
        if (isBeatFieldsStage && (workspace?.isDirty() ?? false)) {
            auditBtn.setDisabled(false);
            auditBtn.setButtonText(t('settings.beats.audit.saveChangesText'));
            auditBtn.setTooltip(t('settings.beats.audit.saveChangesTooltip'));
            auditBtn.buttonEl.classList.add('ert-save-changes-btn--attention');
            auditPrimaryAction = () => { void workspace?.save(); };
            return;
        }
        auditBtn.buttonEl.classList.remove('ert-save-changes-btn--attention');
        const activeBeatSystemKey = resolveBeatAuditSystemKey();
        const preCheckScope = collectFilesForAuditWithScope(app, noteType, plugin.settings, activeBeatSystemKey);
        if (preCheckScope.reason) {
            auditBtn.setDisabled(true);
            auditBtn.setButtonText(t('settings.beats.audit.checkNotesText'));
            auditBtn.setTooltip(preCheckScope.reason);
        } else if (preCheckScope.files.length === 0) {
            auditBtn.setDisabled(true);
            auditBtn.setButtonText(t('settings.beats.audit.checkNotesText'));
            auditBtn.setTooltip(`No ${noteType.toLowerCase()} notes found. Create beat notes first.`);
        } else {
            auditBtn.setDisabled(false);
            auditBtn.setButtonText(t('settings.beats.audit.checkNotesText'));
            auditBtn.setTooltip(`Check ${preCheckScope.scopeSummary} for missing properties, unused fields, IDs, and layout issues`);
        }
        auditPrimaryAction = () => runAudit();
    };
    auditSetting.addButton(button => {
        auditBtn = button;
        button
            .setButtonText(t('settings.beats.audit.checkNotesText'))
            .setTooltip(`Check all ${noteType.toLowerCase()} notes for missing properties, unused fields, IDs, and layout issues`)
            .onClick(() => auditPrimaryAction?.());
    });

    updateAuditPrimaryAction();
    if (noteType === 'Beat') {
        panelScope.register(dirtyState.subscribe(updateAuditPrimaryAction));
    }

    // ─── Results row: appears inside the Setting info column after audit runs ──────────
    const resultsEl = auditSetting.infoEl.createDiv({ cls: 'ert-audit-results-row ert-settings-hidden' });

    const clearAuditState = () => {
        auditRevision++;
        auditResult = null;
        structuralStatus = null;
        auditScopeSummary = '';
        fillEmptyPlan = null;
        deprecatedMigrationPlan = null;
        resultsEl.empty();
        resultsEl.classList.add('ert-settings-hidden');
        copyBtn?.classList.add('ert-settings-hidden');
        backfillBtn?.classList.add('ert-settings-hidden');
        insertMissingIdsBtn?.classList.add('ert-settings-hidden');
        fixDuplicateIdsBtn?.classList.add('ert-settings-hidden');
        fillEmptyBtn?.classList.add('ert-settings-hidden');
        migrateDeprecatedBtn?.classList.add('ert-settings-hidden');
        deleteAdvancedBtn?.classList.add('ert-settings-hidden');
        reorderBtn?.classList.add('ert-settings-hidden');
        updateAuditPrimaryAction();
    };


    const runAudit = async () => {
        if (disposed) return;
        const revision = ++auditRevision;
        const activeBeatSystemKey = resolveBeatAuditSystemKey();
        const auditScope = collectFilesForAuditWithScope(app, noteType, plugin.settings, activeBeatSystemKey);
        const files = auditScope.files;
        auditScopeSummary = auditScope.scopeSummary;
        if (auditScope.reason) {
            deprecatedMigrationPlan = null;
            migrateDeprecatedBtn?.classList.add('ert-settings-hidden');
            resultsEl.empty();
            resultsEl.classList.remove('ert-settings-hidden');
            resultsEl.createDiv({
                text: auditScope.reason,
                cls: 'ert-audit-clean'
            });
            new Notice(auditScope.reason);
            return;
        }
        if (files.length === 0) {
            deprecatedMigrationPlan = null;
            migrateDeprecatedBtn?.classList.add('ert-settings-hidden');
            resultsEl.empty();
            resultsEl.classList.remove('ert-settings-hidden');
            resultsEl.createDiv({
                text: `No ${noteType.toLowerCase()} notes found in the active book scope.`,
                cls: 'ert-audit-clean'
            });
            new Notice(`No ${noteType.toLowerCase()} notes found in scope: ${auditScopeSummary}`);
            return;
        }
        structuralStatus = noteType === 'Beat'
            ? workspace.getStructuralStatus()
            : null;
        const result = await runYamlAudit({
            app,
            settings: plugin.settings,
            noteType,
            files,
            beatSystemKey: activeBeatSystemKey,
            includeSafetyScan: true,
        });
        if (disposed || revision !== auditRevision) return;
        auditResult = result;

        copyBtn?.classList.remove('ert-settings-hidden');
        if (auditResult.summary.notesWithMissing > 0) {
            backfillBtn?.classList.remove('ert-settings-hidden');
        } else {
            backfillBtn?.classList.add('ert-settings-hidden');
        }
        if (auditResult.summary.notesMissingIds > 0) {
            insertMissingIdsBtn?.classList.remove('ert-settings-hidden');
        } else {
            insertMissingIdsBtn?.classList.add('ert-settings-hidden');
        }
        if (auditResult.summary.notesDuplicateIds > 0) {
            fixDuplicateIdsBtn?.classList.remove('ert-settings-hidden');
        } else {
            fixDuplicateIdsBtn?.classList.add('ert-settings-hidden');
        }

        fillEmptyPlan = buildFillEmptyPlan(files, activeBeatSystemKey);
        if (fillEmptyPlan) {
            fillEmptyBtn?.classList.remove('ert-settings-hidden');
            fillEmptyBtn?.setAttribute(
                'aria-label',
                `Fill ${fillEmptyPlan.filledFields} empty value${fillEmptyPlan.filledFields !== 1 ? 's' : ''} in ${fillEmptyPlan.files.length} note${fillEmptyPlan.files.length !== 1 ? 's' : ''}`
            );
        } else {
            fillEmptyBtn?.classList.add('ert-settings-hidden');
        }

        deprecatedMigrationPlan = buildDeprecatedMigrationPlan(files);
        if (deprecatedMigrationPlan) {
            const actionable = deprecatedMigrationPlan.moveCount + deprecatedMigrationPlan.removeEmptyCount;
            migrateDeprecatedBtn?.classList.remove('ert-settings-hidden');
            migrateDeprecatedBtn?.setAttribute(
                'aria-label',
                `Migrate ${actionable} deprecated ${deprecatedMigrationPlan.legacyKey} field${actionable !== 1 ? 's' : ''} to ${deprecatedMigrationPlan.canonicalKey}`
            );
        } else {
            migrateDeprecatedBtn?.classList.add('ert-settings-hidden');
        }

        // Show delete-custom button when a custom template exists and
        // at least one safe note has any of those advanced keys
        const advancedKeySet = new Set(getCustomKeys(noteType, plugin.settings, activeBeatSystemKey));
        if (advancedKeySet.size > 0) {
            const notesWithAdvKeys = auditResult.notes.filter(n => {
                if (n.safetyResult?.status === 'dangerous') return false;
                const cache = app.metadataCache.getFileCache(n.file);
                if (!cache?.frontmatter) return false;
                return Object.keys(cache.frontmatter).some(k => advancedKeySet.has(k));
            });
            if (notesWithAdvKeys.length > 0) {
                deleteAdvancedBtn?.classList.remove('ert-settings-hidden');
                deleteAdvancedBtn?.setAttribute(
                    'aria-label',
                    `Delete custom fields from ${notesWithAdvKeys.length} note${notesWithAdvKeys.length !== 1 ? 's' : ''}`
                );
            } else {
                deleteAdvancedBtn?.classList.add('ert-settings-hidden');
            }
        } else {
            deleteAdvancedBtn?.classList.add('ert-settings-hidden');
        }

        // Show reorder button when audit finds order drift (and not all files are unsafe)
        const safeDriftNotes = auditResult.notes.filter(n =>
            n.orderDrift && n.safetyResult?.status !== 'dangerous'
        );
        if (safeDriftNotes.length > 0) {
            reorderBtn?.classList.remove('ert-settings-hidden');
            reorderBtn?.setAttribute(
                'aria-label',
                `Reorder properties in ${safeDriftNotes.length} note${safeDriftNotes.length !== 1 ? 's' : ''}`
            );
        } else {
            reorderBtn?.classList.add('ert-settings-hidden');
        }

        renderResults();
        updateAuditPrimaryAction();
    };

    const getAuditScopeDisplay = (): string => {
        if (noteType === 'Beat' && structuralStatus?.scope.bookTitle) {
            return structuralStatus.scope.bookTitle;
        }
        return auditScopeSummary.replace(/^\d+\s+\w+\s+in\s+/i, '');
    };

    const buildStructureStatusLines = (): string[] => noteType === 'Beat' ? describeStructuralStatus(structuralStatus) : [];

    // ─── Render results ──────────────────────────────────────────────
    const renderResults = () => {
        resultsEl.empty();
        resultsEl.classList.remove('ert-settings-hidden');
        if (!auditResult) return;

        const s = auditResult.summary;
        const emptyValueNotes = fillEmptyPlan?.entries.length ?? 0;
        const emptyValueFields = fillEmptyPlan?.filledFields ?? 0;
        const schemaIssuePaths = new Set(
            auditResult.notes
                .filter(n =>
                    n.missingFields.length > 0
                    || n.missingReferenceId
                    || !!n.duplicateReferenceId
                    || n.extraKeys.length > 0
                    || n.orderDrift
                    || n.semanticWarnings.length > 0
                )
                .map(n => n.file.path)
        );
        const emptyOnlyCount = fillEmptyPlan
            ? fillEmptyPlan.entries.filter(entry => !schemaIssuePaths.has(entry.file.path)).length
            : 0;
        const effectiveClean = Math.max(0, s.clean - emptyOnlyCount);

        // Properties summary line
        const healthLevel = (s.notesUnsafe > 0)
            ? 'unsafe'
            : (s.notesMissingIds > 0 || s.notesDuplicateIds > 0)
                ? 'critical'
                : (s.notesWithMissing > 0 || emptyValueNotes > 0)
                ? 'needs-attention'
                : (s.notesWithExtra > 0 || s.notesWithDrift > 0 || s.notesWithWarnings > 0 || s.notesSuspicious > 0)
                    ? 'mixed'
                    : 'clean';
        const healthLabels: Record<string, string> = {
            'clean': t('settings.beats.audit.healthClean'),
            'mixed': t('settings.beats.audit.healthMixed'),
            'needs-attention': t('settings.beats.audit.healthNeedsAttention'),
            'critical': t('settings.beats.audit.healthCritical'),
            'unsafe': t('settings.beats.audit.healthUnsafe'),
        };
        const headerEl = resultsEl.createDiv({ cls: 'ert-audit-result-header' });
        headerEl.createSpan({ text: `Scope: ${getAuditScopeDisplay()}`, cls: 'ert-audit-summary' });

        const propertiesLine = resultsEl.createDiv({
            cls: healthLevel === 'clean'
                ? 'ert-audit-clean'
                : `ert-audit-health ert-audit-health--${healthLevel}`
        });
        propertiesLine.textContent = healthLevel === 'clean'
            ? 'Note properties: Clean — all notes match the current property rules.'
            : `Note properties: ${healthLabels[healthLevel]}.`;

        for (const line of buildStructureStatusLines()) {
            resultsEl.createDiv({
                text: line,
                cls: 'ert-audit-summary'
            });
        }

        if (s.notesMissingIds > 0) {
            resultsEl.createDiv({
                text: `Critical: Missing IDs (${s.notesMissingIds})`,
                cls: 'ert-audit-critical-summary'
            });
        }
        if (s.notesDuplicateIds > 0) {
            resultsEl.createDiv({
                text: `Critical: Duplicate IDs (${s.notesDuplicateIds})`,
                cls: 'ert-audit-critical-summary'
            });
        }

        // Safety banner — unsafe files
        if (s.notesUnsafe > 0) {
            const unsafeBanner = resultsEl.createDiv({ cls: 'ert-audit-safety-banner ert-audit-safety-banner--danger' });
            unsafeBanner.createSpan({
                text: `${s.notesUnsafe} note${s.notesUnsafe !== 1 ? 's have' : ' has'} dangerous frontmatter (broken YAML, code injection, or suspicious content). These notes are excluded from all batch operations. Open each file to inspect and fix manually.`
            });
        }

        // Safety banner — suspicious files
        if (s.notesSuspicious > 0) {
            const suspectBanner = resultsEl.createDiv({ cls: 'ert-audit-safety-banner ert-audit-safety-banner--warning' });
            suspectBanner.createSpan({
                text: `${s.notesSuspicious} note${s.notesSuspicious !== 1 ? 's have' : ' has'} suspicious frontmatter — review before running batch operations.`
            });
        }

        // Unread warning
        if (s.unreadNotes > 0) {
            const unreadEl = resultsEl.createDiv({ cls: 'ert-audit-unread-warn' });
            unreadEl.textContent = `${s.unreadNotes} note${s.unreadNotes !== 1 ? 's' : ''} not yet indexed — rerun audit after Obsidian finishes indexing.`;
        }

        if (emptyValueNotes > 0) {
            const emptyEl = resultsEl.createDiv({ cls: 'ert-audit-unread-warn' });
            emptyEl.textContent = `${emptyValueNotes} note${emptyValueNotes !== 1 ? 's' : ''} have ${emptyValueFields} empty custom field value${emptyValueFields !== 1 ? 's' : ''}.`;

            const emptyDetails = resultsEl.createDiv({ cls: 'ert-audit-note-pills' });
            for (const entry of fillEmptyPlan!.entries.slice(0, AUDIT_OPEN_ALL_MAX)) {
                const keys = entry.emptyKeys.join(', ');
                const pillEl = emptyDetails.createEl('button', {
                    cls: 'ert-audit-note-pill ert-audit-note-pill--warning',
                    attr: { type: 'button' }
                });
                pillEl.createSpan({ text: entry.file.basename, cls: 'ert-audit-note-pill-name' });
                pillEl.createSpan({ text: ` — empty: ${keys}`, cls: 'ert-audit-note-pill-reason' });
                setTooltip(pillEl, `${entry.file.basename}: empty values in ${keys}`);
                pillEl.addEventListener('click', () => { void (async () => {
                    await openOrRevealFile(app, entry.file, false);
                    new Notice(`Empty values: ${keys}`);
                })(); });
            }
        }

        // All clean — early return
        if (
            s.clean === s.totalNotes
            && s.unreadNotes === 0
            && s.notesWithWarnings === 0
            && s.notesUnsafe === 0
            && s.notesSuspicious === 0
            && s.notesMissingIds === 0
            && s.notesDuplicateIds === 0
            && emptyValueNotes === 0
        ) {
            return;
        }

        // Collect all entries across all categories for a flat display
        interface ChipConfig {
            key: string;
            label: string;
            displayText?: string;
            count: number;
            kind: 'critical' | 'duplicate' | 'missing' | 'extra' | 'drift' | 'warning' | 'unsafe' | 'suspicious';
            warningType?: string;
            entries: NoteAuditEntry[];
        }

        const warningChips: ChipConfig[] = groupSemanticWarningEntries(auditResult.notes).map((group) => ({
            key: `warning:${group.label}`,
            label: group.label,
            displayText: formatSemanticWarningChipText(group),
            count: group.entries.length,
            kind: 'warning',
            warningType: group.label,
            entries: group.entries,
        }));
        const chips: ChipConfig[] = [
            { key: 'missing-ids', label: 'Critical: Missing IDs', count: s.notesMissingIds, kind: 'critical',
              entries: auditResult.notes.filter(n => n.missingReferenceId) },
            { key: 'duplicate-ids', label: 'Critical: Duplicate IDs', count: s.notesDuplicateIds, kind: 'duplicate',
              entries: auditResult.notes.filter(n => !!n.duplicateReferenceId) },
            { key: 'unsafe', label: 'Unsafe', count: s.notesUnsafe, kind: 'unsafe',
              entries: auditResult.notes.filter(n => n.safetyResult?.status === 'dangerous') },
            { key: 'suspicious', label: 'Suspicious', count: s.notesSuspicious, kind: 'suspicious',
              entries: auditResult.notes.filter(n => n.safetyResult?.status === 'suspicious') },
            { key: 'missing', label: 'Missing properties', count: s.notesWithMissing, kind: 'missing',
              entries: auditResult.notes.filter(n => n.missingFields.length > 0) },
            { key: 'extra', label: 'Other plugin keys (read-only)', count: s.notesWithExtra, kind: 'extra',
              entries: auditResult.notes.filter(n => n.extraKeys.length > 0) },
            { key: 'drift', label: 'Layout cleanup', count: s.notesWithDrift, kind: 'drift',
              entries: auditResult.notes.filter(n => n.orderDrift) },
            ...warningChips,
        ];

        // Category chips row (clickable to filter)
        let activeKey: string | null = chips.find(c => c.count > 0)?.key ?? null;
        const chipsEl = resultsEl.createDiv({ cls: 'ert-audit-chips' });

        const detailsEl = resultsEl.createDiv({ cls: 'ert-audit-details' });

        const renderChips = () => {
            chipsEl.empty();
            for (const chip of chips) {
                if (chip.count === 0) continue;
                const chipStyleKind = chip.kind === 'duplicate' ? 'critical' : chip.kind;
                const chipBtn = chipsEl.createEl('button', {
                    cls: `ert-chip ert-audit-chip ert-audit-chip--${chipStyleKind}${activeKey === chip.key ? ' is-active' : ''}`,
                    text: chip.displayText ?? `${chip.count} ${chip.label.toLowerCase()}`,
                    attr: { type: 'button' }
                });
                chipBtn.addEventListener('click', () => {
                    activeKey = activeKey === chip.key ? null : chip.key;
                    renderChips();
                    renderNoteList();
                });
            }
            if (effectiveClean > 0) {
                chipsEl.createSpan({ text: `${effectiveClean} clean`, cls: 'ert-chip ert-audit-chip ert-audit-chip--clean' });
            }
        };

        // Note pills — flat list across the row, wrapping, up to 5 per page
        let page = 0;

        const renderNoteList = () => {
            detailsEl.empty();
            if (!activeKey) return;

            const activeChip = chips.find(c => c.key === activeKey);
            if (!activeChip || activeChip.entries.length === 0) return;

            const total = activeChip.entries.length;
            const start = page * AUDIT_PAGE_SIZE;
            const end = Math.min(start + AUDIT_PAGE_SIZE, total);
            const pageEntries = activeChip.entries.slice(start, end);

            // Note pills in a flowing row
            const pillsEl = detailsEl.createDiv({ cls: 'ert-audit-note-pills' });
            for (const entry of pageEntries) {
                let reason: string;
                switch (activeChip.kind) {
                    case 'critical':
                        reason = 'Missing reference ID';
                        break;
                    case 'duplicate':
                        reason = entry.duplicateReferenceId
                            ? `Duplicate Reference ID: ${entry.duplicateReferenceId}`
                            : 'Duplicate Reference ID';
                        break;
                    case 'missing':
                        reason = entry.missingFields.join(', ');
                        break;
                    case 'extra':
                        reason = `Not managed by Radial Timeline: ${entry.extraKeys.join(', ')}`;
                        break;
                    case 'warning':
                        reason = formatSemanticWarningReason(activeChip.warningType
                            ? entry.semanticWarnings.filter(warning => getSemanticWarningType(warning) === activeChip.warningType)
                            : entry.semanticWarnings);
                        break;
                    case 'unsafe':
                    case 'suspicious':
                        reason = entry.safetyResult
                            ? entry.safetyResult.issues.map(i => i.message).join(' | ')
                            : 'safety issue';
                        break;
                    default:
                        reason = 'layout cleanup needed';
                }
                const reasonShort = reason.length > 40 ? reason.slice(0, 39) + '…' : reason;
                const pillStyleKind = activeChip.kind === 'duplicate' ? 'critical' : activeChip.kind;

                const pillEl = pillsEl.createEl('button', {
                    cls: `ert-audit-note-pill ert-audit-note-pill--${pillStyleKind}`,
                    attr: { type: 'button' }
                });

                // Safety badge on pill
                if (entry.safetyResult?.status === 'dangerous') {
                    const badge = pillEl.createSpan({ cls: 'ert-audit-safety-badge ert-audit-safety-badge--danger' });
                    setIcon(badge, 'shield-alert');
                    setTooltip(badge, formatSafetyIssues(entry.safetyResult));
                } else if (entry.safetyResult?.status === 'suspicious') {
                    const badge = pillEl.createSpan({ cls: 'ert-audit-safety-badge ert-audit-safety-badge--warning' });
                    setIcon(badge, 'shield-question');
                    setTooltip(badge, formatSafetyIssues(entry.safetyResult));
                }

                pillEl.createSpan({ text: entry.file.basename, cls: 'ert-audit-note-pill-name' });
                pillEl.createSpan({ text: ` — ${reasonShort}`, cls: 'ert-audit-note-pill-reason' });
                setTooltip(pillEl, `${entry.file.basename}: ${reason}`);

                pillEl.addEventListener('click', () => { void (async () => {
                    await openOrRevealFile(app, entry.file, false);
                    if (activeChip.kind === 'critical') {
                        new Notice('Missing reference ID');
                    } else if (activeChip.kind === 'duplicate') {
                        new Notice(reason);
                    } else if (activeChip.kind === 'unsafe' || activeChip.kind === 'suspicious') {
                        new Notice(`Review note: ${reason}`);
                    } else if (entry.missingFields.length > 0) {
                        new Notice(`Missing properties: ${entry.missingFields.join(', ')}`);
                    } else if (entry.semanticWarnings.length > 0) {
                        new Notice(`Warnings: ${entry.semanticWarnings.join(' | ')}`);
                    }
                })(); });
            }

            // Pagination + Open all row
            const navEl = detailsEl.createDiv({ cls: 'ert-audit-pagination' });
            const paginationLabel = navEl.createSpan({ cls: 'ert-audit-pagination-label' });
            paginationLabel.textContent = `${start + 1}–${end} of ${total}`;

            if (page > 0) {
                const prevBtn = navEl.createEl('button', {
                    text: '← Prev',
                    cls: 'ert-audit-nav-btn',
                    attr: { type: 'button' }
                });
                prevBtn.addEventListener('click', () => { page--; renderNoteList(); });
            }
            if (end < total) {
                const nextBtn = navEl.createEl('button', {
                    text: `Next ${Math.min(AUDIT_PAGE_SIZE, total - end)} →`,
                    cls: 'ert-audit-nav-btn',
                    attr: { type: 'button' }
                });
                nextBtn.addEventListener('click', () => { page++; renderNoteList(); });
            }
            if (total <= AUDIT_OPEN_ALL_MAX && total > 1) {
                const openAllBtn = navEl.createEl('button', {
                    text: `Open all ${total}`,
                    cls: 'ert-audit-nav-btn',
                    attr: { type: 'button' }
                });
                openAllBtn.addEventListener('click', () => { void (async () => {
                    for (const e of activeChip.entries) {
                        await openOrRevealFile(app, e.file, true);
                    }
                })(); });
            }
        };

        renderChips();
        renderNoteList();
    };

    // ─── Insert missing IDs action ───────────────────────────────────
    const handleInsertMissingIds = async () => {
        if (!auditResult || auditResult.summary.notesMissingIds === 0) return;

        const targetFiles = auditResult.notes
            .filter(n => n.missingReferenceId)
            .map(n => n.file);
        if (targetFiles.length === 0) return;

        const confirmed = await confirmAudit(app, {
            badge: `${noteType.toUpperCase()} AUDIT`,
            title: 'Insert missing IDs',
            subtitle: `Insert Reference IDs into ${targetFiles.length} ${noteType.toLowerCase()} note${targetFiles.length !== 1 ? 's' : ''}.`,
            scope: auditScopeSummary,
            action: 'Insert IDs',
            renderBody: body => {
                body.createDiv({ text: 'Only notes missing a Reference ID will be updated. Existing IDs are preserved.' });
            }
        });

        if (!confirmed) return;

        const result = await runReferenceIdBackfill({
            app,
            files: targetFiles,
            noteType
        });

        const parts: string[] = [];
        if (result.updated > 0) parts.push(`Updated ${result.updated} note${result.updated !== 1 ? 's' : ''}`);
        if (result.skipped > 0) parts.push(`${result.skipped} already had IDs`);
        if (result.failed > 0) parts.push(`${result.failed} failed`);
        new Notice(parts.join(', ') || 'No changes made.');

        scheduleAuditRefresh(runAudit);
    };

    // ─── Fix duplicate IDs action ────────────────────────────────────
    const handleFixDuplicateIds = async () => {
        if (!auditResult || auditResult.summary.notesDuplicateIds === 0) return;

        const duplicateEntries = auditResult.notes.filter(n => !!n.duplicateReferenceId);
        if (duplicateEntries.length === 0) return;
        const targetFiles = [...new Set(duplicateEntries.map(n => n.file))];
        const duplicateIdCount = new Set(
            duplicateEntries
                .map(n => n.duplicateReferenceId)
                .filter((id): id is string => !!id)
        ).size;

        const confirmed = await confirmAudit(app, {
            badge: `${noteType.toUpperCase()} AUDIT`,
            title: 'Fix duplicate IDs',
            subtitle: `Resolve ${duplicateIdCount} duplicate Reference ID group${duplicateIdCount !== 1 ? 's' : ''} across ${targetFiles.length} ${noteType.toLowerCase()} note${targetFiles.length !== 1 ? 's' : ''}.`,
            scope: auditScopeSummary,
            action: 'Fix duplicates',
            renderBody: body => {
                body.createDiv({ text: 'For each duplicate ID, one note keeps the existing ID and the others receive new IDs.' });
            }
        });

        if (!confirmed) return;

        const result = await runReferenceIdDuplicateRepair({
            app,
            files: targetFiles,
            noteType
        });

        const parts: string[] = [];
        if (result.updated > 0) parts.push(`Updated ${result.updated} note${result.updated !== 1 ? 's' : ''}`);
        if (result.skipped > 0) parts.push(`${result.skipped} unchanged`);
        if (result.failed > 0) parts.push(`${result.failed} failed`);
        new Notice(parts.join(', ') || 'No changes made.');

        scheduleAuditRefresh(runAudit);
    };

    // ─── Backfill action ─────────────────────────────────────────────
    const handleBackfill = async () => {
        if (!auditResult || auditResult.summary.notesWithMissing === 0) return;

        const defaults = getCustomDefaults(noteType, plugin.settings, resolveBeatAuditSystemKey());
        const targetFiles = auditResult.notes
            .filter(n => n.missingFields.length > 0)
            .map(n => n.file);

        const allMissingKeys = new Set<string>();
        for (const n of auditResult.notes) {
            for (const k of n.missingFields) allMissingKeys.add(k);
        }
        const fieldsToInsert: Record<string, string | string[]> = {};
        for (const k of allMissingKeys) {
            fieldsToInsert[k] = defaults[k] ?? '';
        }

        // Confirmation modal
        const confirmed = await confirmAudit(app, {
            badge: `${noteType.toUpperCase()} AUDIT`,
            title: 'Insert missing fields',
            subtitle: `Insert fields into ${targetFiles.length} ${noteType.toLowerCase()} note${targetFiles.length !== 1 ? 's' : ''}.`,
            scope: auditScopeSummary,
            action: 'Insert',
            renderBody: body => {
                body.createDiv({ text: 'The following fields will be added (existing values are never overwritten):' });
                const fieldListEl = body.createEl('ul');
                for (const [key, val] of Object.entries(fieldsToInsert)) {
                    const valStr = Array.isArray(val) ? val.join(', ') : val;
                    fieldListEl.createEl('li', { text: valStr ? `${key}: ${valStr}` : `${key}: (empty)` });
                }
            }
        });

        if (!confirmed) return;

        let beatPurposeMigration: Awaited<ReturnType<typeof runBeatDescriptionToPurposeMigration>> | null = null;
        if (noteType === 'Beat') {
            beatPurposeMigration = await runBeatDescriptionToPurposeMigration({
                app,
                files: targetFiles
            });
        }

        const result: BackfillResult = await runYamlBackfill({
            app,
            files: targetFiles,
            fieldsToInsert,
        });

        const parts: string[] = [];
        if (beatPurposeMigration && beatPurposeMigration.movedToPurpose > 0) {
            parts.push(`Migrated ${beatPurposeMigration.movedToPurpose} Description→Purpose`);
        }
        if (beatPurposeMigration && beatPurposeMigration.removedDescription > 0) {
            parts.push(`Removed ${beatPurposeMigration.removedDescription} Description key${beatPurposeMigration.removedDescription !== 1 ? 's' : ''}`);
        }
        if (result.updated > 0) parts.push(`Updated ${result.updated} note${result.updated !== 1 ? 's' : ''}`);
        if (result.skipped > 0) parts.push(`${result.skipped} already had all fields`);
        if (result.failed > 0) parts.push(`${result.failed} failed`);
        new Notice(parts.join(', ') || 'No changes made.');

        // Wait for Obsidian metadata cache to re-index before refreshing audit
        scheduleAuditRefresh(runAudit);
    };

    const handleFillEmptyValues = async () => {
        if (!isBeatAuditWriteReady()) {
            new Notice('Save the active custom set before filling empty values.');
            return;
        }
        if (!fillEmptyPlan) {
            new Notice('No empty beat fields with defaults found in the active book folder.');
            return;
        }

        const confirmed = await confirmAudit(app, {
            badge: 'BEAT AUDIT',
            title: 'Fill empty values',
            subtitle: `Fill ${fillEmptyPlan.filledFields} empty value${fillEmptyPlan.filledFields !== 1 ? 's' : ''} in ${fillEmptyPlan.files.length} beat note${fillEmptyPlan.files.length !== 1 ? 's' : ''}.`,
            scope: fillEmptyPlan.sourcePath,
            action: 'Fill',
            renderBody: body => {
                body.createDiv({ text: 'Only existing empty keys are filled. No keys are added, removed, or overwritten.' });
                const fieldListEl = body.createEl('ul');
                fillEmptyPlan!.touchedKeys.forEach((key) => {
                    const val = fillEmptyPlan!.fieldsToInsert[key];
                    const valStr = Array.isArray(val) ? val.join(', ') : val;
                    fieldListEl.createEl('li', { text: `${key}: ${valStr}` });
                });
            }
        });

        if (!confirmed) return;

        const result = await runYamlFillEmptyValues({
            app,
            files: fillEmptyPlan.files,
            fieldsToInsert: fillEmptyPlan.fieldsToInsert,
        });

        const parts: string[] = [];
        if (result.updated > 0) parts.push(`Updated ${result.updated} note${result.updated !== 1 ? 's' : ''}`);
        if (result.filledFields > 0) parts.push(`Filled ${result.filledFields} value${result.filledFields !== 1 ? 's' : ''}`);
        if (result.skipped > 0) parts.push(`${result.skipped} unchanged`);
        if (result.failed > 0) parts.push(`${result.failed} failed`);
        new Notice(parts.join(', ') || 'No changes made.');

        // Wait for Obsidian metadata cache to re-index before refreshing audit
        scheduleAuditRefresh(runAudit);
    };

    const handleMigrateDeprecatedFields = async () => {
        if (!deprecatedMigrationPlan) {
            new Notice('No deprecated field migrations available.');
            return;
        }

        const { legacyKey, canonicalKey, files, moveCount, removeEmptyCount, preservedCount } = deprecatedMigrationPlan;
        const actionableCount = moveCount + removeEmptyCount;

        const confirmed = await confirmAudit(app, {
            badge: 'YAML MANAGER',
            title: 'Migrate deprecated fields',
            subtitle: `Migrate ${actionableCount} deprecated field value${actionableCount !== 1 ? 's' : ''} from ${legacyKey} to ${canonicalKey}.`,
            scope: auditScopeSummary,
            action: 'Migrate',
            renderBody: body => {
                if (moveCount > 0) {
                    body.createDiv({
                        text: `${moveCount} note${moveCount !== 1 ? 's' : ''}: copy ${legacyKey} content into ${canonicalKey}, then remove ${legacyKey}.`
                    });
                }
                if (removeEmptyCount > 0) {
                    body.createDiv({
                        text: `${removeEmptyCount} note${removeEmptyCount !== 1 ? 's' : ''}: remove empty ${legacyKey} key${removeEmptyCount !== 1 ? 's' : ''}.`
                    });
                }
                if (preservedCount > 0) {
                    body.createDiv({
                        text: `${preservedCount} note${preservedCount !== 1 ? 's' : ''}: ${legacyKey} preserved because ${canonicalKey} already has content.`
                    });
                }
            }
        });

        if (!confirmed) return;

        if (noteType === 'Beat') {
            const migrated = await runBeatDescriptionToPurposeMigration({ app, files });
            const parts: string[] = [];
            if (migrated.movedToPurpose > 0) parts.push(`Migrated ${migrated.movedToPurpose} ${legacyKey}→${canonicalKey}`);
            if (migrated.removedDescription > 0) parts.push(`Removed ${migrated.removedDescription} ${legacyKey} key${migrated.removedDescription !== 1 ? 's' : ''}`);
            if (migrated.failed > 0) parts.push(`${migrated.failed} failed`);
            new Notice(parts.join(', ') || 'No changes made.');
        } else if (noteType === 'Backdrop') {
            const migrated = await runBackdropSynopsisToContextMigration({ app, files });
            const parts: string[] = [];
            if (migrated.movedToContext > 0) parts.push(`Migrated ${migrated.movedToContext} ${legacyKey}→${canonicalKey}`);
            if (migrated.removedSynopsis > 0) parts.push(`Removed ${migrated.removedSynopsis} ${legacyKey} key${migrated.removedSynopsis !== 1 ? 's' : ''}`);
            if (migrated.failed > 0) parts.push(`${migrated.failed} failed`);
            new Notice(parts.join(', ') || 'No changes made.');
        }

        scheduleAuditRefresh(runAudit);
    };

    // ─── Delete custom fields action ────────────────────────────────
    const handleDeleteAdvancedFields = async () => {
        if (!auditResult) return;

        const activeBeatSystemKey = resolveBeatAuditSystemKey();
        const parts = getTemplateParts(noteType, plugin.settings, activeBeatSystemKey);
        const baseKeySet = new Set(sharedExtractKeysInOrder(parts.base));
        const advancedKeys = sharedExtractKeysInOrder(parts.advanced)
            .filter(k => !baseKeySet.has(k));
        if (advancedKeys.length === 0) return;

        const isExcluded = getExcludeKeyPredicate(noteType, plugin.settings);
        // Advanced keys eligible for deletion (not base, not excluded, not reserved)
        const deletableAdvKeys = advancedKeys.filter(
            k => !isExcluded(k) && !RESERVED_OBSIDIAN_KEYS.has(k)
        );
        if (deletableAdvKeys.length === 0) return;

        // Find notes that have at least one of these advanced keys
        const advKeySet = new Set(deletableAdvKeys);
        const targetNotes = auditResult.notes.filter(n => {
            if (n.safetyResult?.status === 'dangerous') return false;
            const cache = app.metadataCache.getFileCache(n.file);
            if (!cache?.frontmatter) return false;
            return Object.keys(cache.frontmatter).some(k => advKeySet.has(k));
        });
        if (targetNotes.length === 0) return;

        // Protected set: base keys + reserved + dynamic
        const protectedKeys = new Set([
            ...baseKeySet,
            ...RESERVED_OBSIDIAN_KEYS,
        ]);

        // Preview
        const targetFiles = targetNotes.map(n => n.file);
        const preview = previewDeleteFields(
            app, targetFiles, deletableAdvKeys, protectedKeys
        );

        const { emptyFieldCount, valuedFieldCount, samples: valuedFieldSamples } = summarizeDeletePreview(preview);
        const totalFieldCount = emptyFieldCount + valuedFieldCount;
        const hasValuedFields = valuedFieldCount > 0;
        const deletePhrase = `DELETE ${valuedFieldCount}`;

        const unsafeSkippedCount = auditResult.notes.filter(n =>
            n.safetyResult?.status === 'dangerous'
        ).length;

        // Confirmation modal
        const confirmed = await new Promise<boolean>((resolve) => {
            const modal = new Modal(app);
            modal.titleEl.setText('');
            modal.contentEl.empty();
            modal.modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
            modal.contentEl.addClass('ert-modal-container', 'ert-stack');

            const header = modal.contentEl.createDiv({ cls: 'ert-modal-header' });
            header.createSpan({ cls: 'ert-modal-badge', text: 'YAML MANAGER' });
            header.createDiv({ cls: 'ert-modal-title', text: 'Delete custom fields' });
            header.createDiv({
                cls: 'ert-modal-subtitle',
                text: `Remove ${totalFieldCount} custom field${totalFieldCount !== 1 ? 's' : ''} from ${targetNotes.length} ${noteType.toLowerCase()} note${targetNotes.length !== 1 ? 's' : ''}. Base fields are never touched.`
            });

            if (unsafeSkippedCount > 0) {
                const banner = modal.contentEl.createDiv({ cls: 'ert-audit-safety-banner ert-audit-safety-banner--danger' });
                banner.createSpan({ text: `${unsafeSkippedCount} note${unsafeSkippedCount !== 1 ? 's' : ''} with unsafe frontmatter excluded from this operation.` });
            }

            const suspiciousCount = targetNotes.filter(n => n.safetyResult?.status === 'suspicious').length;
            if (suspiciousCount > 0) {
                const banner = modal.contentEl.createDiv({ cls: 'ert-audit-safety-banner ert-audit-safety-banner--warning' });
                banner.createSpan({ text: `${suspiciousCount} note${suspiciousCount !== 1 ? 's have' : ' has'} suspicious frontmatter — review carefully.` });
            }

            const body = modal.contentEl.createDiv({ cls: ['ert-panel', 'ert-panel--glass'] });
            body.createDiv({ text: `Scope: ${auditScopeSummary}`, cls: 'ert-modal-subtitle' });

            if (emptyFieldCount > 0) {
                body.createDiv({ text: `${emptyFieldCount} empty field${emptyFieldCount !== 1 ? 's' : ''} will be removed (no data loss).` });
            }

            if (hasValuedFields) {
                const warningEl = body.createDiv({ cls: 'ert-audit-safety-banner ert-audit-safety-banner--warning' });
                warningEl.createDiv({
                    text: `${valuedFieldCount} field${valuedFieldCount !== 1 ? 's' : ''} contain values that will be permanently deleted:`
                });
                const sampleList = warningEl.createEl('ul');
                for (const sample of valuedFieldSamples) {
                    sampleList.createEl('li', { text: `${sample.key}: ${sample.value}` });
                }
                if (valuedFieldCount > valuedFieldSamples.length) {
                    sampleList.createEl('li', { text: `... and ${valuedFieldCount - valuedFieldSamples.length} more` });
                }
                body.createDiv({
                    text: 'A deletion snapshot file will be created before this destructive step.'
                });
            }

            const fieldListEl = body.createDiv();
            fieldListEl.createDiv({ text: 'Custom fields to delete:', cls: 'ert-modal-subtitle' });
            const ul = fieldListEl.createEl('ul');
            for (const key of deletableAdvKeys) {
                ul.createEl('li', { text: key });
            }

            // Base fields preserved notice
            const preserveNotice = body.createDiv({ cls: 'ert-modal-subtitle ert-modal-subtitle--quiet' });
            preserveNotice.setText(`Base fields preserved: ${[...baseKeySet].join(', ')}`);

            // Typed confirmation for valued fields
            let confirmInput: HTMLInputElement | undefined;
            let acknowledgeInput: HTMLInputElement | undefined;
            if (hasValuedFields) {
                const confirmEl = body.createDiv({ cls: 'ert-modal-confirm-type' });
                confirmEl.createDiv({ text: `Type ${deletePhrase} to confirm:`, cls: 'ert-modal-subtitle' });
                confirmInput = confirmEl.createEl('input', { type: 'text', attr: { placeholder: deletePhrase } });
                const acknowledgeEl = body.createDiv({ cls: 'ert-modal-confirm-type' });
                const acknowledgeLabel = acknowledgeEl.createEl('label');
                acknowledgeInput = acknowledgeLabel.createEl('input', { type: 'checkbox' });
                acknowledgeLabel.appendText(' I understand non-empty values will be permanently deleted.');
            }

            const footer = modal.contentEl.createDiv({ cls: 'ert-modal-actions' });
            const deleteBtn = new ButtonComponent(footer)
                .setButtonText('Delete custom fields')
                .setDestructive()
                .onClick(() => {
                    if (hasValuedFields) {
                        if (confirmInput?.value.trim() !== deletePhrase) {
                            confirmInput?.classList.add('ert-input-error');
                            confirmInput?.focus();
                            return;
                        }
                        if (!acknowledgeInput?.checked) {
                            return;
                        }
                    }
                    resolve(true);
                    modal.close();
                });
            if (hasValuedFields) {
                deleteBtn.setDisabled(true);
                const updateDeleteState = () => {
                    const confirmedPhrase = confirmInput?.value.trim() === deletePhrase;
                    const acknowledged = !!acknowledgeInput?.checked;
                    deleteBtn.setDisabled(!(confirmedPhrase && acknowledged));
                    confirmInput?.classList.remove('ert-input-error');
                };
                confirmInput?.addEventListener('input', updateDeleteState);
                acknowledgeInput?.addEventListener('change', updateDeleteState);
            }
            new ButtonComponent(footer).setButtonText('Cancel').onClick(() => { resolve(false); modal.close(); });

            modal.onClose = () => resolve(false);
            modal.open();
        });

        if (!confirmed) return;

        let deletionSnapshotPath: string | null = null;
        if (hasValuedFields) {
            try {
                deletionSnapshotPath = await writeDeletionSnapshot(app, {
                    noteType,
                    operation: 'delete_advanced',
                    preview,
                    scopeSummary: auditScopeSummary
                });
            } catch (error) {
                console.error('[YamlManager] yaml_delete_advanced_snapshot_failed', error);
                new Notice('Delete cancelled: could not create deletion snapshot.');
                return;
            }
            if (!deletionSnapshotPath) {
                new Notice('Delete cancelled: no valued deletion snapshot was generated.');
                return;
            }
        }

        const result: DeleteResult = await runYamlDeleteFields({
            app,
            files: targetFiles,
            fieldsToDelete: deletableAdvKeys,
            protectedKeys,
            safetyResults: auditResult.safetyResults,
        });


        const msgParts: string[] = [];
        if (result.deleted > 0) msgParts.push(`Cleaned ${result.deleted} note${result.deleted !== 1 ? 's' : ''}`);
        if (deletionSnapshotPath) msgParts.push(`Snapshot: ${deletionSnapshotPath}`);
        if (result.safetySkipped > 0) msgParts.push(`${result.safetySkipped} skipped (unsafe)`);
        if (result.failed > 0) msgParts.push(`${result.failed} failed`);
        new Notice(msgParts.join(', ') || 'No changes made.');

        scheduleAuditRefresh(runAudit);
    };

    // ─── Reorder fields action ──────────────────────────────────────
    const handleReorderFields = async () => {
        if (!auditResult) return;

        const activeBeatSystemKey = resolveBeatAuditSystemKey();
        const notesWithDrift = auditResult.notes.filter(n =>
            n.orderDrift && n.safetyResult?.status !== 'dangerous'
        );
        if (notesWithDrift.length === 0) return;

        const canonicalOrder = computeCanonicalOrder(noteType, plugin.settings, activeBeatSystemKey);
        const isDynamic = getExcludeKeyPredicate(noteType, plugin.settings);

        // Build a before/after preview from the first affected file
        const previewNote = notesWithDrift[0];
        const reorderPreview = previewReorder(app, previewNote.file, canonicalOrder, isDynamic);

        const unsafeSkippedCount = auditResult.notes.filter(n =>
            n.orderDrift && n.safetyResult?.status === 'dangerous'
        ).length;

        // Confirmation modal
        const confirmed = await new Promise<boolean>((resolve) => {
            const modal = new Modal(app);
            modal.titleEl.setText('');
            modal.contentEl.empty();
            modal.modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal-shell--md');
            modal.contentEl.addClass('ert-modal-container', 'ert-stack');

            const header = modal.contentEl.createDiv({ cls: 'ert-modal-header' });
            header.createSpan({ cls: 'ert-modal-badge', text: 'YAML MANAGER' });
            header.createDiv({ cls: 'ert-modal-title', text: 'Reorder properties' });
            header.createDiv({
                cls: 'ert-modal-subtitle',
                text: `Reorder properties in ${notesWithDrift.length} ${noteType.toLowerCase()} note${notesWithDrift.length !== 1 ? 's' : ''} to match the canonical template order.`
            });

            if (unsafeSkippedCount > 0) {
                const banner = modal.contentEl.createDiv({ cls: 'ert-audit-safety-banner ert-audit-safety-banner--danger' });
                banner.createSpan({ text: `${unsafeSkippedCount} note${unsafeSkippedCount !== 1 ? 's' : ''} with unsafe frontmatter excluded from this operation.` });
            }

            const suspiciousCount = notesWithDrift.filter(n => n.safetyResult?.status === 'suspicious').length;
            if (suspiciousCount > 0) {
                const banner = modal.contentEl.createDiv({ cls: 'ert-audit-safety-banner ert-audit-safety-banner--warning' });
                banner.createSpan({ text: `${suspiciousCount} note${suspiciousCount !== 1 ? 's have' : ' has'} suspicious frontmatter — proceed with caution.` });
            }

            const body = modal.contentEl.createDiv({ cls: ['ert-panel', 'ert-panel--glass'] });
            body.createDiv({ text: `Scope: ${auditScopeSummary}`, cls: 'ert-modal-subtitle' });
            body.createDiv({ text: 'Only field order changes — all values are preserved exactly.' });

            // Show before/after preview
            if (reorderPreview) {
                body.createDiv({ text: `Preview (${previewNote.file.basename}):`, cls: 'ert-modal-subtitle' });
                const previewRow = body.createDiv({ cls: 'ert-reorder-preview' });

                const beforeCol = previewRow.createDiv({ cls: 'ert-reorder-preview-col' });
                beforeCol.createDiv({ text: 'Before:', cls: 'ert-reorder-preview-label' });
                const beforeList = beforeCol.createEl('ol');
                for (const key of reorderPreview.before) {
                    beforeList.createEl('li', { text: key });
                }

                const afterCol = previewRow.createDiv({ cls: 'ert-reorder-preview-col' });
                afterCol.createDiv({ text: 'After:', cls: 'ert-reorder-preview-label' });
                const afterList = afterCol.createEl('ol');
                for (const key of reorderPreview.after) {
                    const li = afterList.createEl('li', { text: key });
                    if (!reorderPreview.before.includes(key) || reorderPreview.before.indexOf(key) !== reorderPreview.after.indexOf(key)) {
                        li.classList.add('ert-reorder-preview-moved');
                    }
                }
            }

            // Typed confirmation
            const confirmEl = body.createDiv({ cls: 'ert-modal-confirm-type' });
            confirmEl.createDiv({ text: 'Type REORDER to confirm:', cls: 'ert-modal-subtitle' });
            const confirmInput = confirmEl.createEl('input', { type: 'text', attr: { placeholder: 'REORDER' } });

            const footer = modal.contentEl.createDiv({ cls: 'ert-modal-actions' });
            const reorderConfirmBtn = new ButtonComponent(footer)
                .setButtonText('Reorder')
                .setCta()
                .setDisabled(true)
                .onClick(() => {
                    if (confirmInput.value.trim() !== 'REORDER') {
                        confirmInput.classList.add('ert-input-error');
                        confirmInput.focus();
                        return;
                    }
                    resolve(true);
                    modal.close();
                });
            confirmInput.addEventListener('input', () => {
                reorderConfirmBtn.setDisabled(confirmInput.value.trim() !== 'REORDER');
                confirmInput.classList.remove('ert-input-error');
            });
            new ButtonComponent(footer).setButtonText('Cancel').onClick(() => { resolve(false); modal.close(); });

            modal.onClose = () => resolve(false);
            modal.open();
        });

        if (!confirmed) return;

        const result: ReorderResult = await runYamlReorder({
            app,
            files: notesWithDrift.map(n => n.file),
            canonicalOrder,
            isDynamic,
            safetyResults: auditResult.safetyResults,
        });

        const parts: string[] = [];
        if (result.reordered > 0) parts.push(`Reordered ${result.reordered} note${result.reordered !== 1 ? 's' : ''}`);
        if (result.safetySkipped > 0) parts.push(`${result.safetySkipped} skipped (unsafe)`);
        if (result.failed > 0) parts.push(`${result.failed} failed`);
        new Notice(parts.join(', ') || 'No changes made.');

        scheduleAuditRefresh(runAudit);
    };

    // Allow the YAML fields editor to refresh the fill plan when defaults change
    const refreshDefaults = () => {
        if (!auditResult) return;
        const activeBeatSystemKey = resolveBeatAuditSystemKey();
        const files = collectFilesForAudit(app, noteType, plugin.settings, activeBeatSystemKey);
        fillEmptyPlan = buildFillEmptyPlan(files, activeBeatSystemKey);
        if (fillEmptyPlan) {
            fillEmptyBtn?.classList.remove('ert-settings-hidden');
            fillEmptyBtn?.setAttribute(
                'aria-label',
                `Fill ${fillEmptyPlan.filledFields} empty value${fillEmptyPlan.filledFields !== 1 ? 's' : ''} in ${fillEmptyPlan.files.length} note${fillEmptyPlan.files.length !== 1 ? 's' : ''}`
            );
        } else {
            fillEmptyBtn?.classList.add('ert-settings-hidden');
        }
    };

    return { refreshPrimaryAction: updateAuditPrimaryAction, reset: clearAuditState, refreshDefaults, run: runAudit };
}
