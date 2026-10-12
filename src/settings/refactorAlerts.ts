/*
 * Radial Timeline Plugin for Obsidian — Refactor Alerts System
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Centralized definitions for refactor alerts and field migrations.
 * Used by:
 * - Settings Core alert row
 * - Advanced YAML Editor inline migration UI
 * - Version Indicator in timeline view
 */

import type { HotfixHistoryEntry, RadialTimelineSettings } from '../types';
import { getActiveFrontmatterMappings } from '../utils/frontmatter';
import { t } from '../i18n';

// ============================================================================
// Types
// ============================================================================

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface FieldMigration {
    alertId: string;           // Links to parent RefactorAlert
    oldKey: string;            // e.g., "Revision"
    newKey: string;            // e.g., "Iteration"
    tooltip: string;           // Explanation shown on hover
}

export interface RefactorAlert {
    id: string;
    severity: AlertSeverity;
    icon: string;              // Lucide icon name
    title: string;
    description: string;
    migrations?: FieldMigration[];  // Field migrations associated with this alert
}

// ============================================================================
// Alert Definitions
// ============================================================================

// Base template fields - these should NOT appear in the advanced template
// Used to detect and clean up legacy "complete" advanced templates
export const BASE_BEAT_FIELDS = [
    'Class', 'Act', 'When', 'Duration', 'Synopsis', 'Summary', 'Pending Edits',
    'Subplot', 'Character', 'POV', 'Words', 'Runtime', 'Publish Stage',
    'Status', 'Due', 'Summary Update', 'Pulse Update'
];

// Alert wording (title/description) lives in the ui.refactorAlerts.* i18n keys. Settings notifications read from this list.
// Severity: info (blue), warning (orange), critical (red).
export const REFACTOR_ALERTS: RefactorAlert[] = [
    {
        id: 'ai-model-system-migration-v8',
        severity: 'info',
        icon: 'bot',
        get title() { return t('ui.refactorAlerts.aiModelSystemTitle'); },
        get description() { return t('ui.refactorAlerts.aiModelSystemDescription'); },
    },
    {
        id: 'base-advanced-template-separation-v7',
        severity: 'info',
        icon: 'file-check',
        get title() { return t('ui.refactorAlerts.yamlStructureTitle'); },
        get description() { return t('ui.refactorAlerts.yamlStructureDescription'); },
    },
    {
        id: 'yaml-revision-to-iteration-v6',
        severity: 'warning',
        icon: 'alert-triangle',
        get title() { return t('ui.refactorAlerts.revisionToIterationTitle'); },
        get description() { return t('ui.refactorAlerts.revisionToIterationDescription'); },
        migrations: [
            {
                alertId: 'yaml-revision-to-iteration-v6',
                oldKey: 'Revision',
                newKey: 'Iteration',
                get tooltip() { return t('ui.refactorAlerts.revisionToIterationTooltip'); },
            }
        ]
    },
    {
        id: 'change-type-pulse-update',
        severity: 'info',
        icon: 'info',
        get title() { return t('ui.refactorAlerts.pendingEditsTypeTitle'); },
        get description() { return t('ui.refactorAlerts.pendingEditsTypeDescription'); },
    },
    {
        id: 'radial-timeline-folder-structure',
        severity: 'info',
        icon: 'folder-plus',
        get title() { return t('ui.refactorAlerts.newFolderTitle'); },
        get description() { return t('ui.refactorAlerts.newFolderDescription'); },
    },
    {
        id: 'logs-folder-structure-v1',
        severity: 'info',
        icon: 'folder-tree',
        get title() { return t('ui.refactorAlerts.logFoldersTitle'); },
        get description() { return t('ui.refactorAlerts.logFoldersDescription'); },
    },
    {
        id: 'recovery-folder-relocation-v1',
        severity: 'warning',
        icon: 'archive-restore',
        get title() { return t('ui.refactorAlerts.recoveryFilesTitle'); },
        get description() { return t('ui.refactorAlerts.recoveryFilesDescription'); },
    },
    {
        id: 'inquiry-pro-button-design-v1',
        severity: 'info',
        icon: 'sparkles',
        get title() { return t('ui.refactorAlerts.inquiryProButtonsTitle'); },
        get description() { return t('ui.refactorAlerts.inquiryProButtonsDescription'); },
    }
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all field migrations from all alerts
 */
export function getAllFieldMigrations(): FieldMigration[] {
    return REFACTOR_ALERTS.flatMap(a => a.migrations ?? []);
}

/**
 * IDs of every statically-defined refactor alert. Snapshotted on a fresh
 * install (see `settings.installAlertBaseline`) so the existing upgrade backlog
 * is treated as pre-acknowledged for brand-new vaults.
 */
export function getAllRefactorAlertIds(): string[] {
    return REFACTOR_ALERTS.map(a => a.id);
}

/**
 * Check if a specific alert has any pending migrations in the user's template
 */
function alertHasPendingMigrations(alert: RefactorAlert, template: string): boolean {
    if (!alert.migrations?.length) return false;
    return alert.migrations.some(m => template.includes(`${m.oldKey}:`));
}

/**
 * Check for remapper conflicts - user has a mapping TO the old key
 */
function hasRemapperConflict(
    migration: FieldMigration,
    remappings: Record<string, string>
): boolean {
    return Object.values(remappings).includes(migration.oldKey);
}

/**
 * Check if the advanced template contains legacy base fields that should be removed.
 * Returns the list of base fields found in the template.
 */
export function getLegacyBaseFieldsInAdvanced(advancedTemplate: string): string[] {
    const found: string[] = [];
    for (const field of BASE_BEAT_FIELDS) {
        // Match field at start of line followed by colon
        const regex = new RegExp(`^${field}:`, 'm');
        if (regex.test(advancedTemplate)) {
            found.push(field);
        }
    }
    return found;
}

/**
 * Check if advanced template needs cleanup (has legacy base fields)
 */
export function advancedTemplateNeedsCleanup(advancedTemplate: string): boolean {
    return getLegacyBaseFieldsInAdvanced(advancedTemplate).length > 0;
}

/**
 * Remove legacy base fields from an advanced template.
 * This handles the migration from "complete" advanced templates to "extra fields only".
 */
export function cleanupAdvancedTemplate(advancedTemplate: string): string {
    const lines = advancedTemplate.split('\n');
    const result: string[] = [];
    let skipUntilNextField = false;
    
    for (const line of lines) {
        // Check if this line starts a field
        const fieldMatch = line.match(/^([A-Za-z][A-Za-z0-9 _'-]*):/);
        
        if (fieldMatch) {
            const fieldName = fieldMatch[1].trim();
            if (BASE_BEAT_FIELDS.includes(fieldName)) {
                // Skip this base field and any continuation lines
                skipUntilNextField = true;
                continue;
            } else {
                // This is an advanced-only field, keep it
                skipUntilNextField = false;
                result.push(line);
            }
        } else if (skipUntilNextField) {
            // Skip continuation lines (indented list items, placeholders)
            continue;
        } else if (line.trim()) {
            // Keep non-empty lines that aren't being skipped
            result.push(line);
        }
    }
    
    return result.join('\n').trim();
}

/**
 * Stable id for the synthetic "PDF templates and Book Pages examples updated" alert. The alert is
 * generated dynamically from `settings.templateHotfixHistory` rather than
 * stored in the static `REFACTOR_ALERTS` list, so it can re-appear after a
 * future hotfix without polluting `dismissedAlerts`.
 */
export const TEMPLATE_HOTFIX_ALERT_ID = 'templates-auto-updated-v1';

/**
 * Build the synthetic refactor alert from `templateHotfixHistory`. Returns
 * `null` when there are no unacknowledged entries (i.e. nothing to show).
 */
export function getTemplateHotfixAlert(settings: RadialTimelineSettings): RefactorAlert | null {
    const history: HotfixHistoryEntry[] = settings.templateHotfixHistory ?? [];
    const hasUnacknowledged = history.some(entry => !entry.acknowledged);
    if (!hasUnacknowledged) return null;
    return {
        id: TEMPLATE_HOTFIX_ALERT_ID,
        severity: 'info',
        icon: 'file-check',
        title: t('ui.refactorAlerts.templateHotfixTitle'),
        description: t('ui.refactorAlerts.templateHotfixDescription'),
    };
}

/**
 * Get active refactor alerts that need user attention
 * Filters out dismissed alerts and alerts with no pending migrations (for migration alerts).
 * Info alerts without migrations are shown until dismissed.
 * Appends a synthetic template and matter update alert when bundled-template
 * hotfixes have run and the user hasn't yet acknowledged them.
 */
export function getActiveRefactorAlerts(settings: RadialTimelineSettings): RefactorAlert[] {
    const dismissed = settings.dismissedAlerts ?? [];
    const installBaseline = settings.installAlertBaseline ?? [];
    const remappings = getActiveFrontmatterMappings(settings) ?? {};
    const template = settings.sceneYamlTemplates?.advanced ?? '';

    const staticActive = REFACTOR_ALERTS.filter(alert => {
        // Skip alerts that predate this vault's fresh install (nothing to migrate)
        if (installBaseline.includes(alert.id)) return false;

        // Skip if already dismissed
        if (dismissed.includes(alert.id)) return false;

        // For alerts with migrations, skip if no pending migrations in template
        if (alert.migrations?.length) {
            if (!alertHasPendingMigrations(alert, template)) return false;

            // Check for remapper conflicts (log warning but still show alert)
            for (const migration of alert.migrations) {
                if (hasRemapperConflict(migration, remappings)) {
                    console.warn(
                        `[RefactorAlerts] Remapper conflict detected: user has mapping to "${migration.oldKey}". ` +
                        `Consider updating the remapper after migrating.`
                    );
                }
            }
        }
        // Info alerts without migrations are always shown until dismissed

        return true;
    });

    const hotfixAlert = getTemplateHotfixAlert(settings);
    return hotfixAlert ? [...staticActive, hotfixAlert] : staticActive;
}

/**
 * Get active field migrations for the Advanced YAML Editor
 */
export function getActiveMigrations(settings: RadialTimelineSettings): FieldMigration[] {
    const dismissed = settings.dismissedAlerts ?? [];
    const installBaseline = settings.installAlertBaseline ?? [];
    return getAllFieldMigrations().filter(
        m => !dismissed.includes(m.alertId) && !installBaseline.includes(m.alertId)
    );
}

/**
 * Check if any active alerts exist (for Version Indicator)
 */
export function hasActiveAlerts(settings: RadialTimelineSettings): boolean {
    return getActiveRefactorAlerts(settings).length > 0;
}

/**
 * Get all notifications for history view (including dismissed ones)
 * Returns alerts sorted by severity (critical first, then warning, then info)
 */
export function getAllNotificationsForHistory(settings: RadialTimelineSettings): RefactorAlert[] {
    const dismissed = settings.dismissedAlerts ?? [];
    const installBaseline = settings.installAlertBaseline ?? [];
    const template = settings.sceneYamlTemplates?.advanced ?? '';

    // Filter alerts that have been dismissed OR have no pending migrations
    // (i.e., they've been processed or were non-migration notices)
    return REFACTOR_ALERTS.filter(alert => {
        // Alerts that predate this vault's fresh install never appear anywhere,
        // including the "notifications processed" history.
        if (installBaseline.includes(alert.id)) return false;

        // For alerts with migrations, only show in history if dismissed or migrations complete
        if (alert.migrations?.length) {
            return dismissed.includes(alert.id) || !alertHasPendingMigrations(alert, template);
        }
        // For info notices without migrations, show in history if dismissed
        return dismissed.includes(alert.id);
    }).sort((a, b) => {
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
    });
}

/**
 * Perform all migrations for a specific alert in the template
 * Returns the updated template string
 */
export function applyAlertMigrations(alert: RefactorAlert, template: string): string {
    let updated = template;
    for (const migration of alert.migrations ?? []) {
        // Replace key name (preserving any trailing content like comments)
        const regex = new RegExp(`^(${migration.oldKey}:)`, 'gm');
        updated = updated.replace(regex, `${migration.newKey}:`);
    }
    return updated;
}

/**
 * Check if all migrations for an alert are complete
 */
export function areAlertMigrationsComplete(alert: RefactorAlert, template: string): boolean {
    if (!alert.migrations?.length) return true;
    return !alert.migrations.some(m => template.includes(`${m.oldKey}:`));
}

/**
 * Maximum number of notifications to keep in history
 */
const MAX_HISTORY_SIZE = 10;

/**
 * Dismiss an alert and auto-purge old alerts if history exceeds MAX_HISTORY_SIZE.
 * Older alerts (at the start of the array) are removed first.
 */
export function dismissAlert(alertId: string, settings: RadialTimelineSettings): void {
    if (!settings.dismissedAlerts) {
        settings.dismissedAlerts = [];
    }
    
    // Don't add duplicates
    if (settings.dismissedAlerts.includes(alertId)) {
        return;
    }
    
    settings.dismissedAlerts.push(alertId);
    
    // Auto-purge oldest if over limit
    while (settings.dismissedAlerts.length > MAX_HISTORY_SIZE) {
        settings.dismissedAlerts.shift(); // Remove oldest (first in array)
    }
}
