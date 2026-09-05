import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    getMinimapItemFilePath,
    getCorpusCcModeMeta,
    getCorpusCcHeaderLabel,
    getCorpusCcHeaderDisplayLabel,
    getCorpusCcHeaderTooltip
} from './inquiryCorpusStripMinimap';
import type { InquiryCorpusItem } from '../services/InquiryCorpusResolver';
import type { SceneInclusion } from '../../types/settings';

const item = (p: Partial<InquiryCorpusItem> & Record<string, unknown>): InquiryCorpusItem =>
    p as unknown as InquiryCorpusItem;

describe('getMinimapItemFilePath', () => {
    it('returns scene.filePath when present', () => {
        expect(getMinimapItemFilePath(item({ filePath: 'Book/1.md' }))).toBe('Book/1.md');
    });
    it('falls back to book.rootPath when no scene filePath', () => {
        expect(getMinimapItemFilePath(item({ rootPath: 'Book' }))).toBe('Book');
    });
    it('falls back to filePaths[0] when neither scene filePath nor rootPath', () => {
        expect(getMinimapItemFilePath(item({ filePaths: ['a.md', 'b.md'] }))).toBe('a.md');
    });
    it('returns undefined when nothing usable on the item', () => {
        expect(getMinimapItemFilePath(item({}))).toBeUndefined();
    });
    it('scene path wins over rootPath wins over filePaths[0]', () => {
        expect(getMinimapItemFilePath(item({ filePath: 's.md', rootPath: 'B', filePaths: ['fp.md'] }))).toBe('s.md');
        expect(getMinimapItemFilePath(item({ rootPath: 'B', filePaths: ['fp.md'] }))).toBe('B');
    });
});

describe('getCorpusCcModeMeta', () => {
    it('maps summary / full / excluded modes verbatim', () => {
        expect(getCorpusCcModeMeta('summary' as SceneInclusion)).toEqual({
            label: 'Summary', short: 'SUM', icon: 'circle-dot', isActive: true
        });
        expect(getCorpusCcModeMeta('full' as SceneInclusion)).toEqual({
            label: 'Full Scene', short: 'FULL', icon: 'disc', isActive: true
        });
        expect(getCorpusCcModeMeta('excluded' as SceneInclusion)).toEqual({
            label: 'Exclude', short: 'EXCL', icon: 'circle', isActive: false
        });
    });
    it('any non-summary/non-full mode → Exclude meta (isActive false)', () => {
        expect(getCorpusCcModeMeta('unknown' as unknown as SceneInclusion).label).toBe('Exclude');
        expect(getCorpusCcModeMeta('unknown' as unknown as SceneInclusion).isActive).toBe(false);
    });
});

describe('getCorpusCcHeaderLabel', () => {
    it('overrideLabel (after trim) wins when truthy', () => {
        expect(getCorpusCcHeaderLabel('scene', 5, '  CustomLabel  ')).toBe('CustomLabel');
    });
    it('empty / whitespace overrideLabel is ignored', () => {
        expect(getCorpusCcHeaderLabel('scene', 5, '')).toBe('S5');
        expect(getCorpusCcHeaderLabel('scene', 5, '   ')).toBe('S5');
        expect(getCorpusCcHeaderLabel('scene', 5, undefined)).toBe('S5');
    });
    it('outline-saga class uses the SIGMA glyph (no count)', () => {
        const label = getCorpusCcHeaderLabel('outline-saga', 7);
        expect(label.length).toBe(1);
        expect(label).not.toMatch(/\d/);
    });
    it('other classes use the class shorthand + count', () => {
        expect(getCorpusCcHeaderLabel('character', 3)).toBe('C3');
        expect(getCorpusCcHeaderLabel('outline', 2)).toBe('O2');
    });
});

describe('getCorpusCcHeaderDisplayLabel', () => {
    it('maps each known class to its display name', () => {
        expect(getCorpusCcHeaderDisplayLabel('outline-saga')).toBe('Saga Outline');
        expect(getCorpusCcHeaderDisplayLabel('character')).toBe('Character');
        expect(getCorpusCcHeaderDisplayLabel('scene')).toBe('Scene');
        expect(getCorpusCcHeaderDisplayLabel('outline')).toBe('Outline');
    });
    it('unknown class → "Class"', () => {
        expect(getCorpusCcHeaderDisplayLabel('mystery')).toBe('Class');
        expect(getCorpusCcHeaderDisplayLabel('')).toBe('Class');
    });
});

describe('getCorpusCcHeaderTooltip', () => {
    it('overrideLabel (trimmed, non-empty) wins over display label', () => {
        expect(getCorpusCcHeaderTooltip('scene', 'full' as SceneInclusion, 3, '  Custom  '))
            .toBe('Custom · Full Scene · 3');
    });
    it('falls back to display label when override is missing/empty', () => {
        expect(getCorpusCcHeaderTooltip('scene', 'full' as SceneInclusion, 3))
            .toBe('Scene · Full Scene · 3');
        expect(getCorpusCcHeaderTooltip('character', 'summary' as SceneInclusion, 2, ''))
            .toBe('Character · Summary · 2');
    });
    it('count joins only when mode is active OR count > 0', () => {
        // Excluded + count 0 → no count appended.
        expect(getCorpusCcHeaderTooltip('scene', 'excluded' as SceneInclusion, 0))
            .toBe('Scene · Exclude');
        // Excluded but count > 0 → count appended.
        expect(getCorpusCcHeaderTooltip('scene', 'excluded' as SceneInclusion, 4))
            .toBe('Scene · Exclude · 4');
        // Active + count 0 → count still appended (active wins).
        expect(getCorpusCcHeaderTooltip('scene', 'full' as SceneInclusion, 0))
            .toBe('Scene · Full Scene · 0');
    });
});

describe('InquiryView wrappers delegate (corpus-strip/minimap source-lock)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
    it('imports the pure helpers and delegates without recursion', () => {
        expect(src.includes("from './utils/inquiryCorpusStripMinimap'")).toBe(true);
        // Exact pass-through forwarders were deleted (CH-2026-09-04-#9); the view calls the pure helper directly.
        expect(src.includes('getMinimapItemFilePath(')).toBe(true);
        expect(src.includes('getMinimapItemFilePathPure')).toBe(false);
        expect(src.includes('return getCorpusCcModeMetaPure(mode);')).toBe(true);
        expect(src.includes('return getCorpusCcHeaderLabelPure(className, count, overrideLabel);')).toBe(true);
        expect(src.includes('return getCorpusCcHeaderTooltipPure(className, mode, count, overrideLabel);')).toBe(true);
        // getCorpusCcHeaderDisplayLabel has no caller left in the view; it stays exported from the pure module.
        expect(src.includes('getCorpusCcHeaderDisplayLabelPure')).toBe(false);
    });
});
