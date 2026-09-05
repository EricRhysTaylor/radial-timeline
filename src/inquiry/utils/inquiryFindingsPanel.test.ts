import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    getResultSelectionMode,
    getResultRoleValidation,
    computeRoleValidation,
    buildFindingRowData,
    buildUnverifiedFindingRowData
} from './inquiryFindingsPanel';
import type { InquiryFinding, InquiryLens, InquiryResult, InquiryRoleValidation, InquirySelectionMode } from '../state';

const result = (p: Partial<InquiryResult>): InquiryResult => p as unknown as InquiryResult;
const finding = (p: Partial<InquiryFinding>): InquiryFinding =>
    ({ kind: 'thread', ...p }) as unknown as InquiryFinding;

describe('getResultSelectionMode', () => {
    it('returns "focused" only for explicit "focused"; everything else → "discover"', () => {
        expect(getResultSelectionMode(result({ selectionMode: 'focused' as never }))).toBe('focused');
        expect(getResultSelectionMode(result({ selectionMode: 'discover' as never }))).toBe('discover');
        expect(getResultSelectionMode(result({}))).toBe('discover');
        expect(getResultSelectionMode(null)).toBe('discover');
        expect(getResultSelectionMode(undefined)).toBe('discover');
    });
});

describe('getResultRoleValidation', () => {
    it('returns "missing-target-roles" only for that exact value; everything else → "ok"', () => {
        expect(getResultRoleValidation(result({ roleValidation: 'missing-target-roles' as never }))).toBe('missing-target-roles');
        expect(getResultRoleValidation(result({ roleValidation: 'ok' as never }))).toBe('ok');
        expect(getResultRoleValidation(result({}))).toBe('ok');
        expect(getResultRoleValidation(null)).toBe('ok');
    });
});

describe('computeRoleValidation', () => {
    it('non-focused selection → always "ok" regardless of findings/persisted', () => {
        expect(computeRoleValidation('discover' as InquirySelectionMode, [])).toBe('ok');
        expect(computeRoleValidation('discover' as InquirySelectionMode, [finding({ role: 'target' })], 'missing-target-roles')).toBe('ok');
    });
    it('focused + persisted "ok" → trusts persisted', () => {
        expect(computeRoleValidation('focused' as InquirySelectionMode, [], 'ok')).toBe('ok');
    });
    it('focused + persisted "missing-target-roles" → trusts persisted', () => {
        expect(computeRoleValidation('focused' as InquirySelectionMode, [finding({ role: 'target' })], 'missing-target-roles' as InquiryRoleValidation)).toBe('missing-target-roles');
    });
    it('focused without persisted → "ok" iff some finding has role "target"', () => {
        expect(computeRoleValidation('focused' as InquirySelectionMode, [finding({ role: 'target' }), finding({ role: 'context' })])).toBe('ok');
        expect(computeRoleValidation('focused' as InquirySelectionMode, [finding({ role: 'context' })])).toBe('missing-target-roles');
        expect(computeRoleValidation('focused' as InquirySelectionMode, [])).toBe('missing-target-roles');
    });
});

describe('buildFindingRowData', () => {
    it('role → "target"|"context"; roleLabel mirrors with brackets', () => {
        const t = buildFindingRowData(finding({ role: 'target', headline: 'h' }), 'flow' as InquiryLens);
        expect(t.role).toBe('target');
        expect(t.roleLabel).toBe('[Target]');
        const c = buildFindingRowData(finding({ role: 'context', headline: 'h' }), 'flow' as InquiryLens);
        expect(c.role).toBe('context');
        expect(c.roleLabel).toBe('[Context]');
        const missing = buildFindingRowData(finding({ headline: 'h' }), 'flow' as InquiryLens);
        expect(missing.role).toBe('context');
        expect(missing.roleLabel).toBe('[Context]');
    });

    it('headline goes through normalizeInquiryHeadline (empty → "Finding" fallback)', () => {
        expect(buildFindingRowData(finding({ headline: '' }), 'flow' as InquiryLens).headline).toBe('Finding');
        expect(buildFindingRowData(finding({ headline: '  trim me  ' }), 'flow' as InquiryLens).headline).toBe('trim me');
    });

    it('lens "both" → "Flow / Depth"; explicit lens → capitalized; absent → mode || "flow"', () => {
        expect(buildFindingRowData(finding({ lens: 'both' }), 'flow' as InquiryLens).lensLabel).toBe('Flow / Depth');
        expect(buildFindingRowData(finding({ lens: 'flow' as never }), 'depth' as InquiryLens).lensLabel).toBe('Flow');
        expect(buildFindingRowData(finding({}), 'depth' as InquiryLens).lensLabel).toBe('Depth');
        expect(buildFindingRowData(finding({}), undefined).lensLabel).toBe('Flow');
    });

    it('bullets filtered + sliced to top 2 (panel limit)', () => {
        const out = buildFindingRowData(finding({ headline: 'h', bullets: ['a', '', 'b', 'c'] }), 'flow' as InquiryLens);
        expect(out.bullets).toEqual(['a', 'b']);
        expect(buildFindingRowData(finding({ headline: 'h' }), 'flow' as InquiryLens).bullets).toEqual([]);
    });
});

describe('buildUnverifiedFindingRowData', () => {
    it('headline normalized; cited-as fallback chain rawRefId → rawRefLabel → rawRefPath → "(missing ref)"', () => {
        expect(buildUnverifiedFindingRowData({ headline: 'h', rawRefId: 'r1' }).citedAsDescriptor).toBe('r1');
        expect(buildUnverifiedFindingRowData({ headline: 'h', rawRefLabel: 'L1' }).citedAsDescriptor).toBe('L1');
        expect(buildUnverifiedFindingRowData({ headline: 'h', rawRefPath: 'P1' }).citedAsDescriptor).toBe('P1');
        expect(buildUnverifiedFindingRowData({ headline: 'h' }).citedAsDescriptor).toBe('(missing ref)');
        expect(buildUnverifiedFindingRowData({ headline: '' }).headline).toBe('Finding');
    });

    it('bullets filtered + sliced to 2', () => {
        expect(buildUnverifiedFindingRowData({ headline: 'h', bullets: ['x', '', 'y', 'z'] }).bullets).toEqual(['x', 'y']);
        expect(buildUnverifiedFindingRowData({ headline: 'h' }).bullets).toEqual([]);
    });
});

describe('InquiryView wrappers delegate (findings-panel source-lock)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
    it('imports the pure helpers and delegates without recursion', () => {
        expect(src.includes("from './utils/inquiryFindingsPanel'")).toBe(true);
        // Exact pass-through forwarders were deleted (CH-2026-09-04-#9); the view calls the pure helper directly.
        expect(src.includes('getResultSelectionMode(result)')).toBe(true);
        expect(src.includes('getResultRoleValidation(result)')).toBe(true);
        expect(src.includes('getResultSelectionModePure')).toBe(false);
        expect(src.includes('return computeRoleValidationPure(selectionMode, findings, persisted);')).toBe(true);
    });

    it('updateFindingsPanel render loops consume the row-data shapers (preserved behavior)', () => {
        // Hit and unverified loops both delegate per-row data shape to the
        // pure module; the SVG construction stays in InquiryView.
        expect(src.includes('const row = buildFindingRowDataPure(finding, result.mode);')).toBe(true);
        expect(src.includes('const row = buildUnverifiedFindingRowDataPure(item);')).toBe(true);
        // Old inline forms must be gone from the hit/unverified loops.
        expect(src.includes("const role = this.getFindingRole(finding);")).toBe(false);
        expect(src.includes("const rawDescriptor = item.rawRefId || item.rawRefLabel || item.rawRefPath || '(missing ref)';")).toBe(false);
    });
});
