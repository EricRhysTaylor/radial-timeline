import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import type { RadialTimelineSettings } from '../types/settings';
import {
    collectHoverMetadataText,
    formatDateForDisplay,
    formatHoverMetadataValue,
    readFrontmatterFieldValue,
    resolveHoverMetadataFields
} from './hoverMetadata';

const field = (key: string, enabled = true) => ({ key, label: key, icon: '', enabled });

const settingsWith = (overrides: Partial<RadialTimelineSettings>): RadialTimelineSettings =>
    ({ ...overrides } as RadialTimelineSettings);

const sceneWith = (frontmatter: Record<string, unknown>, extra: Partial<TimelineItem> = {}): TimelineItem =>
    ({ path: 'scene.md', title: 'Scene', rawFrontmatter: frontmatter, ...extra } as TimelineItem);

describe('readFrontmatterFieldValue', () => {
    it('reads an exact key', () => {
        expect(readFrontmatterFieldValue({ Place: 'Diego' }, 'Place')).toBe('Diego');
    });

    it('tolerates casing and punctuation drift in hand-written YAML', () => {
        const fm = { 'point-of-view': 'Ada' };
        expect(readFrontmatterFieldValue(fm, 'Point of View')).toBe('Ada');
        expect(readFrontmatterFieldValue(fm, 'point_of_view')).toBe('Ada');
    });

    it('returns undefined for a missing key or absent frontmatter', () => {
        expect(readFrontmatterFieldValue({ Place: 'Diego' }, 'Mood')).toBeUndefined();
        expect(readFrontmatterFieldValue(undefined, 'Place')).toBeUndefined();
    });
});

describe('formatHoverMetadataValue', () => {
    it('strips wikilinks to the display name the author actually reads', () => {
        expect(formatHoverMetadataValue('[[Place/Diego]]')).toBe('Diego');
        expect(formatHoverMetadataValue('[[Place/Diego|Home]]')).toBe('Diego');
    });

    it('joins arrays the way the hover line renders them', () => {
        expect(formatHoverMetadataValue(['[[Earth]]', '[[Place/Diego]]'])).toBe('Earth, Diego');
    });

    it('renders a valid Date in the timeline date format', () => {
        expect(formatHoverMetadataValue(new Date(1812, 7, 1, 8, 0))).toBe('Aug 1, 1812 @ 8AM');
    });

    it('coerces scalars and empties', () => {
        expect(formatHoverMetadataValue(42)).toBe('42');
        expect(formatHoverMetadataValue(true)).toBe('true');
        expect(formatHoverMetadataValue(null)).toBe('');
        expect(formatHoverMetadataValue(undefined)).toBe('');
    });
});

describe('formatDateForDisplay', () => {
    it('names midnight and noon rather than printing 12', () => {
        expect(formatDateForDisplay(new Date(1812, 3, 6, 0, 0))).toBe('Apr 6, 1812 @ Midnight');
        expect(formatDateForDisplay(new Date(1812, 3, 6, 12, 0))).toBe('Apr 6, 1812 @ Noon');
    });

    it('includes minutes only when they are non-zero', () => {
        expect(formatDateForDisplay(new Date(1812, 3, 6, 14, 0))).toBe('Apr 6, 1812 @ 2PM');
        expect(formatDateForDisplay(new Date(1812, 3, 6, 14, 5))).toBe('Apr 6, 1812 @ 2:05PM');
    });

    it('is strict about invalid dates instead of rendering an empty line', () => {
        expect(formatDateForDisplay(undefined)).toBe('');
        expect(() => formatDateForDisplay(new Date('nonsense'))).toThrow();
    });
});

describe('resolveHoverMetadataFields', () => {
    it('returns only enabled scene fields', () => {
        const settings = settingsWith({ hoverMetadataFields: [field('Place'), field('Mood', false)] });
        const keys = resolveHoverMetadataFields(settings, sceneWith({})).map(f => f.key);
        expect(keys).toEqual(['Place']);
    });

    it('uses the backdrop list for backdrop items', () => {
        const settings = settingsWith({
            hoverMetadataFields: [field('Place')],
            backdropHoverMetadataFields: [field('Era')]
        });
        const keys = resolveHoverMetadataFields(settings, sceneWith({}, { itemType: 'Backdrop' })).map(f => f.key);
        expect(keys).toEqual(['Era']);
    });

    it('uses the per-model beat list for beat items', () => {
        const settings = settingsWith({
            hoverMetadataFields: [field('Place')],
            beatSystemConfigs: {
                'Save the Cat': { beatHoverMetadataFields: [field('Beat Function')] }
            }
        } as Partial<RadialTimelineSettings>);
        const scene = sceneWith({ 'Beat Model': 'Save the Cat' }, { itemType: 'Beat' });
        const keys = resolveHoverMetadataFields(settings, scene).map(f => f.key);
        expect(keys).toEqual(['Beat Function']);
    });
});

describe('collectHoverMetadataText', () => {
    it('returns the displayed strings for enabled fields only', () => {
        const settings = settingsWith({ hoverMetadataFields: [field('Place'), field('Mood', false)] });
        const scene = sceneWith({ Place: '[[Place/Diego]]', Mood: 'Tense' });
        expect(collectHoverMetadataText(settings, scene)).toEqual(['Diego']);
    });

    it('omits empty values, matching the hover synopsis skipping them', () => {
        const settings = settingsWith({
            hoverMetadataFields: [field('Place'), field('Mood'), field('Cast')]
        });
        const scene = sceneWith({ Place: 'Diego', Mood: '', Cast: [] });
        expect(collectHoverMetadataText(settings, scene)).toEqual(['Diego']);
    });
});
