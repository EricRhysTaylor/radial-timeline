import { describe, expect, it } from 'vitest';
import SynopsisManager from './SynopsisManager';
import type { TimelineItem } from './types';

function item(title: string, overrides: Partial<TimelineItem> = {}): TimelineItem {
    return { title, date: '', path: `Book/${title}.md`, status: 'Complete', ...overrides };
}

function message(scene: TimelineItem, context: TimelineItem[]): string | null {
    // SAFE: tooltip copy needs only plugin.lastSceneData; no DOM or modal lifecycle is exercised.
    const manager = Object.assign(Object.create(SynopsisManager.prototype), { plugin: { lastSceneData: context } }) as SynopsisManager;
    const tooltip = manager as unknown as { buildMissingWhenMessage(scene: TimelineItem): string | null };
    return tooltip.buildMissingWhenMessage(scene);
}

describe('undated scene hover explanation', () => {
    it('names the preceding anchor across several undated scenes without recommending its date', () => {
        const anchor = item('1 Arrival', { when: new Date(2026, 0, 20) });
        const gap = item('2 Transition', { missingWhen: true });
        const target = item('3 Discovery', { missingWhen: true });
        const text = message(target, [target, gap, anchor]);
        expect(text).toContain('follows 1 Arrival in narrative order');
        expect(text).toContain('No calendar date assumed');
        expect(text).not.toContain('Try');
    });

    it('explains placement before the first narrative anchor', () => {
        const target = item('1 Opening', { missingWhen: true });
        expect(message(target, [target, item('2 Arrival', { when: new Date(2026, 0, 20) })])).toContain('precedes 2 Arrival');
    });

    it('leaves an entirely undated book in narrative order and keeps Todo quiet', () => {
        const target = item('1 Opening', { missingWhen: true });
        expect(message(target, [target])).toContain('shown in narrative order');
        expect(message({ ...target, status: 'Todo' }, [target])).toBeNull();
    });

    it('distinguishes invalid date text from a valid blank date', () => {
        const target = item('1 Opening', { missingWhen: true, rawFrontmatter: { When: 'not a date' } });
        expect(message(target, [target])).toContain('Invalid When');
    });
});
