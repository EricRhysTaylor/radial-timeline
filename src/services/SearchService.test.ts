import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import type { RadialTimelineSettings } from '../types/settings';
import { buildTimelineSearchTextFields, timelineSceneMatchesSearch } from './SearchService';

const field = (key: string, enabled = true) => ({ key, label: key, icon: '', enabled });

const settingsWith = (overrides: Partial<RadialTimelineSettings>): RadialTimelineSettings =>
    ({ ...overrides } as RadialTimelineSettings);

/** No custom hover fields configured — only the curated set is searchable. */
const bareSettings = settingsWith({});

const sceneWith = (overrides: Partial<TimelineItem>): TimelineItem =>
    ({ path: 'scene.md', title: 'Arrival', rawFrontmatter: {}, ...overrides } as TimelineItem);

describe('buildTimelineSearchTextFields', () => {
    it('covers the curated fields the timeline renders', () => {
        const scene = sceneWith({
            title: 'Arrival',
            synopsis: 'She reaches the coast.',
            subplot: 'Homecoming',
            Character: ['Ada']
        });
        expect(buildTimelineSearchTextFields(scene, { settings: bareSettings })).toEqual(
            expect.arrayContaining(['Arrival', 'She reaches the coast.', 'Homecoming', 'Ada'])
        );
    });

    it('includes custom hover fields the author enabled', () => {
        // The searchable set must equal the visible set: enabling a field in
        // hover metadata makes it searchable in the same action.
        const settings = settingsWith({ hoverMetadataFields: [field('Place')] });
        const scene = sceneWith({ rawFrontmatter: { Place: '[[Place/Diego]]' } });
        expect(buildTimelineSearchTextFields(scene, { settings })).toContain('Diego');
    });

    it('omits custom fields the author disabled', () => {
        const settings = settingsWith({ hoverMetadataFields: [field('Place', false)] });
        const scene = sceneWith({ rawFrontmatter: { Place: 'Diego' } });
        expect(buildTimelineSearchTextFields(scene, { settings })).not.toContain('Diego');
    });
});

describe('AI Pulse analysis is not searchable', () => {
    // It is commentary *about* a scene — a grade and editorial notes — not
    // something the scene contains, and not reliably about that scene in
    // particular. Matching it would light a scene up because a critique of it
    // mentioned a meal.
    const scene = sceneWith({
        synopsis: 'She reaches the coast.',
        currentSceneAnalysis: 'B / Compelling lore expansion, but tighten the family dialogue'
    } as Partial<TimelineItem>);

    it('is absent from the searchable fields', () => {
        const fields = buildTimelineSearchTextFields(scene, { settings: bareSettings });
        expect(fields.join(' ')).not.toContain('Compelling lore expansion');
    });

    it('does not produce a match', () => {
        expect(timelineSceneMatchesSearch(scene, 'lore expansion', { settings: bareSettings })).toBe(false);
        // The scene's own text still matches, so this is a narrowing of the
        // corpus rather than a broken search.
        expect(timelineSceneMatchesSearch(scene, 'coast', { settings: bareSettings })).toBe(true);
    });
});

describe('timelineSceneMatchesSearch', () => {
    it('matches a custom hover field once it is enabled, and not before', () => {
        const scene = sceneWith({ rawFrontmatter: { Place: 'Diego' } });

        const disabled = settingsWith({ hoverMetadataFields: [field('Place', false)] });
        expect(timelineSceneMatchesSearch(scene, 'Diego', { settings: disabled })).toBe(false);

        const enabled = settingsWith({ hoverMetadataFields: [field('Place')] });
        expect(timelineSceneMatchesSearch(scene, 'Diego', { settings: enabled })).toBe(true);
    });

    it('matches the displayed string, not the raw wikilink path', () => {
        // Matching the raw value would let `Place/` light up a scene with
        // nothing highlighted on hover to explain why.
        const settings = settingsWith({ hoverMetadataFields: [field('Place')] });
        const scene = sceneWith({ rawFrontmatter: { Place: '[[Place/Diego]]' } });

        expect(timelineSceneMatchesSearch(scene, 'Diego', { settings })).toBe(true);
        expect(timelineSceneMatchesSearch(scene, 'Place/', { settings })).toBe(false);
    });

    it('is case-insensitive and matches substrings', () => {
        const scene = sceneWith({ synopsis: 'She reaches the coast.' });
        expect(timelineSceneMatchesSearch(scene, 'REACHES', { settings: bareSettings })).toBe(true);
        expect(timelineSceneMatchesSearch(scene, 'coast', { settings: bareSettings })).toBe(true);
    });

    it('matches the visible date string', () => {
        const scene = sceneWith({ when: new Date(1812, 7, 1, 8, 0) });
        expect(timelineSceneMatchesSearch(scene, 'Aug 1, 1812', { settings: bareSettings })).toBe(true);
    });

    it('survives a malformed When rather than aborting the run', () => {
        // formatDateForDisplay is strict by design; search sees whatever the
        // vault holds, so one bad date must not throw out the whole search.
        const scene = sceneWith({ synopsis: 'coast', when: new Date('nonsense') });
        expect(() => timelineSceneMatchesSearch(scene, 'coast', { settings: bareSettings })).not.toThrow();
        expect(timelineSceneMatchesSearch(scene, 'coast', { settings: bareSettings })).toBe(true);
    });

    it('does not match an unrelated phrase', () => {
        expect(timelineSceneMatchesSearch(sceneWith({ synopsis: 'coast' }), 'mountain', { settings: bareSettings })).toBe(false);
    });
});
