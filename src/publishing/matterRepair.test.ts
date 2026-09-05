import { describe, expect, it } from 'vitest';
import { applyMatterRepairToFrontmatter, planMatterRepairForNote } from './matterRepair';

describe('planMatterRepairForNote', () => {
    it('ignores notes that carry no matter signal', () => {
        expect(planMatterRepairForNote({ Class: 'Scene', When: '2026-01-01' })).toBeNull();
        expect(planMatterRepairForNote({})).toBeNull();
    });

    it('leaves a well-formed front-matter note alone', () => {
        expect(planMatterRepairForNote({ Class: 'Frontmatter', Role: 'dedication', BodyMode: 'latex' })).toBeNull();
        expect(planMatterRepairForNote({ Class: 'Backmatter' })).toBeNull();
    });

    it('recovers the class from a legacy Matter side and flags the legacy key', () => {
        const change = planMatterRepairForNote({ Matter: { side: 'back' } });
        expect(change).toEqual({ reasons: ['missing-class', 'legacy-matter'], nextClass: 'Backmatter', clearRole: undefined, nextBodyMode: undefined });
    });

    it('accepts a plain legacy Matter string and a Side field', () => {
        expect(planMatterRepairForNote({ Matter: 'front' })?.nextClass).toBe('Frontmatter');
        expect(planMatterRepairForNote({ Side: 'Back matter', UseBookMeta: true })?.nextClass).toBe('Backmatter');
    });

    it('reports an unresolvable class as an issue with no repair', () => {
        const change = planMatterRepairForNote({ Role: 'copyright' });
        expect(change?.reasons).toEqual(['missing-class']);
        expect(change?.nextClass).toBeUndefined();
    });

    it('clears an unknown or non-string role and resets an unknown BodyMode to plain', () => {
        const change = planMatterRepairForNote({ Class: 'Frontmatter', Role: 'foreword', BodyMode: 'html' });
        expect(change?.reasons).toEqual(['invalid-role', 'invalid-bodymode']);
        expect(change?.clearRole).toBe(true);
        expect(change?.nextBodyMode).toBe('plain');
        expect(planMatterRepairForNote({ Class: 'Frontmatter', Role: 42 })?.clearRole).toBe(true);
    });

    it('treats role and BodyMode case-insensitively', () => {
        expect(planMatterRepairForNote({ Class: 'Frontmatter', Role: ' Title-Page ', BodyMode: 'LaTeX' })).toBeNull();
    });
});

describe('applyMatterRepairToFrontmatter', () => {
    it('rewrites Class, clears the role, resets BodyMode, and drops legacy keys in place', () => {
        const fm: Record<string, unknown> = { class: 'frontmatter', role: 'foreword', bodymode: 'html', Matter: { side: 'front' }, Title: 'Keep me' };
        const changed = applyMatterRepairToFrontmatter(fm, { reasons: ['legacy-matter', 'invalid-role', 'invalid-bodymode'], nextClass: 'Frontmatter', clearRole: true, nextBodyMode: 'plain' });
        expect(changed).toBe(true);
        expect(fm).toEqual({ Class: 'Frontmatter', BodyMode: 'plain', Title: 'Keep me' });
    });

    it('does nothing for a change with no target class', () => {
        const fm: Record<string, unknown> = { Role: 'copyright' };
        expect(applyMatterRepairToFrontmatter(fm, { reasons: ['missing-class'] })).toBe(false);
        expect(fm).toEqual({ Role: 'copyright' });
    });

    it('reports no change when the frontmatter already matches', () => {
        const fm: Record<string, unknown> = { Class: 'Backmatter' };
        expect(applyMatterRepairToFrontmatter(fm, { reasons: ['legacy-matter'], nextClass: 'Backmatter' })).toBe(false);
    });
});
