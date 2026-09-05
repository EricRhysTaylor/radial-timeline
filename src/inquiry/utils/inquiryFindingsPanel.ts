/**
 * Pure findings-panel render-data helpers extracted from InquiryView.
 *
 * Scope: data-shaping that feeds `updateFindingsPanel` — per-row labels,
 * role/selection predicates, role-validation computation. The actual
 * DOM construction (createSvgText, classList toggles) and all i18n
 * `t()` calls stay in InquiryView; this module is i18n-free so the
 * outputs are translation-neutral.
 *
 * No DOM, no timers, no plugin/state access, no vault I/O.
 */
import type { FindingRole, InquiryFinding, InquiryLens, InquiryResult, InquiryRoleValidation, InquirySelectionMode } from '../state';
import { normalizeInquiryHeadline } from './inquiryViewText';
import { formatBriefLabel } from './inquiryViewText';
import { getFindingRole } from './inquiryBriefModel';

/**
 * Selection mode resolved from a result. Defaults to `'discover'` for
 * any value other than the explicit `'focused'`.
 */
export function getResultSelectionMode(
    result: InquiryResult | null | undefined
): InquirySelectionMode {
    return result?.selectionMode === 'focused' ? 'focused' : 'discover';
}

/**
 * Role-validation resolved from a result. Defaults to `'ok'` for any
 * value other than the explicit `'missing-target-roles'`.
 */
export function getResultRoleValidation(
    result: InquiryResult | null | undefined
): InquiryRoleValidation {
    return result?.roleValidation === 'missing-target-roles' ? 'missing-target-roles' : 'ok';
}

/**
 * Compute role-validation for a fresh run: non-focused → `'ok'`;
 * focused + previously-persisted validation → trust it; focused with
 * no persisted value → derive from findings (any 'target' role → `'ok'`,
 * else `'missing-target-roles'`).
 */
export function computeRoleValidation(
    selectionMode: InquirySelectionMode,
    findings: InquiryFinding[],
    persisted?: InquiryRoleValidation
): InquiryRoleValidation {
    if (selectionMode !== 'focused') return 'ok';
    if (persisted === 'ok' || persisted === 'missing-target-roles') return persisted;
    return findings.some(finding => finding.role === 'target') ? 'ok' : 'missing-target-roles';
}

/**
 * Shape one findings-panel row from a finding. Pure — i18n bracket
 * labels (`'[Target]'` / `'[Context]'`) are role-keyed strings the
 * caller may keep or replace; headline is normalized; lens defaults
 * via `result.mode || 'flow'` when finding.lens is absent; bullets
 * filtered + sliced to top 2 (the panel limit).
 */
export function buildFindingRowData(
    finding: InquiryFinding,
    mode: InquiryLens | undefined
): {
    role: FindingRole;
    roleLabel: string;
    headline: string;
    lensLabel: string;
    bullets: string[];
} {
    const role = getFindingRole(finding);
    return {
        role,
        roleLabel: role === 'target' ? '[Target]' : '[Context]',
        headline: normalizeInquiryHeadline(finding.headline),
        lensLabel: finding.lens === 'both'
            ? 'Flow / Depth'
            : formatBriefLabel(finding.lens || mode || 'flow'),
        bullets: (finding.bullets || []).filter(Boolean).slice(0, 2)
    };
}

/**
 * Shape one row for an unverified-finding entry. Same bullet limit as
 * regular rows; headline normalized; the "cited as" descriptor falls
 * through `rawRefId` → `rawRefLabel` → `rawRefPath` → `'(missing ref)'`.
 */
export function buildUnverifiedFindingRowData(
    item: {
        headline: string;
        bullets?: string[];
        rawRefId?: string;
        rawRefLabel?: string;
        rawRefPath?: string;
    }
): {
    headline: string;
    citedAsDescriptor: string;
    bullets: string[];
} {
    return {
        headline: normalizeInquiryHeadline(item.headline),
        citedAsDescriptor: item.rawRefId || item.rawRefLabel || item.rawRefPath || '(missing ref)',
        bullets: (item.bullets || []).filter(Boolean).slice(0, 2)
    };
}
