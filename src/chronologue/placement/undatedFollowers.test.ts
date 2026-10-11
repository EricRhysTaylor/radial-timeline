import { describe, it, expect } from 'vitest';
import type { TimelineItem } from '../../types';
import { buildChronologueSceneSequence } from '../../utils/sceneHelpers';
import { findUndatedFollowers } from './undatedFollowers';

function scene(manuscriptNumber: number, iso: string | null): TimelineItem {
    const title = `${String(manuscriptNumber).padStart(2, '0')} Scene ${manuscriptNumber}`;
    return {
        path: `Book/${title}.md`,
        title,
        number: manuscriptNumber,
        date: iso ?? '',
        when: iso ? new Date(iso) : undefined,
        itemType: 'Scene'
    };
}

function followersOf(scenes: TimelineItem[], manuscriptNumber: number): number[] {
    const sequence = buildChronologueSceneSequence(scenes);
    const dragged = scenes.find(item => item.number === manuscriptNumber)!;
    return findUndatedFollowers(sequence, dragged.path!).map(follower => follower.scene.number!).sort((a, b) => a - b);
}

describe('findUndatedFollowers', () => {
    it('names the undated scenes that come after the dragged scene in the manuscript', () => {
        const scenes = [
            scene(1, '2024-03-01T09:00:00'),
            scene(2, null),
            scene(3, null),
            scene(4, '2024-03-05T09:00:00')
        ];
        expect(followersOf(scenes, 1)).toEqual([2, 3]);
    });

    it('stops at the next dated scene', () => {
        const scenes = [
            scene(1, '2024-03-01T09:00:00'),
            scene(2, '2024-03-02T09:00:00'),
            scene(3, null)
        ];
        expect(followersOf(scenes, 1)).toEqual([]);
        expect(followersOf(scenes, 2)).toEqual([3]);
    });

    it('carries the undated scenes that open the manuscript with the first dated scene', () => {
        // Nothing dated precedes them, so they are shown just before the first
        // dated scene — and travel with it.
        const scenes = [
            scene(1, null),
            scene(2, '2024-03-02T09:00:00'),
            scene(3, '2024-03-03T09:00:00')
        ];
        expect(followersOf(scenes, 2)).toEqual([1]);
    });

    it('judges the arrangement after the write, when an undated scene gains a date', () => {
        // Today 3 rides with 1. Placing 2 dates it, and 3 then rides with 2.
        const scenes = [
            scene(1, '2024-03-01T09:00:00'),
            scene(2, null),
            scene(3, null),
            scene(4, '2024-03-05T09:00:00')
        ];
        expect(followersOf(scenes, 2)).toEqual([3]);
    });

    it('lets an undated opening scene take over the leaders once it is dated', () => {
        const scenes = [
            scene(1, null),
            scene(2, null),
            scene(3, null),
            scene(4, '2024-03-04T09:00:00')
        ];
        expect(followersOf(scenes, 2)).toEqual([1, 3]);
    });

    it('keeps each follower at the time it is shown at now', () => {
        const scenes = [
            scene(1, '2024-03-01T09:00:00'),
            scene(2, null),
            scene(3, '2024-03-05T09:00:00')
        ];
        const [follower] = findUndatedFollowers(buildChronologueSceneSequence(scenes), scenes[0].path!);
        expect(follower.keepWhen?.storedWhen).toBe('2024-03-01 09:00');
    });

    it('keeps a new follower where it stands today, not beside the scene it will follow', () => {
        // 3 rides with 1 now; dating 2 hands it to 2. Kept in place, it stays at 1's time.
        const scenes = [
            scene(1, '2024-03-01T09:00:00'),
            scene(2, null),
            scene(3, null),
            scene(4, '2024-03-05T09:00:00')
        ];
        const [follower] = findUndatedFollowers(buildChronologueSceneSequence(scenes), scenes[1].path!);
        expect(follower.keepWhen?.storedWhen).toBe('2024-03-01 09:00');
    });

    it('refuses to keep a follower whose time cannot be stored exactly', () => {
        // Stored at minute precision, 09:00:30 would be pinned at 09:00.
        const scenes = [
            scene(1, '2024-03-01T09:00:30'),
            scene(2, null)
        ];
        const [follower] = findUndatedFollowers(buildChronologueSceneSequence(scenes), scenes[0].path!);
        expect(follower.keepWhen).toBeNull();
    });

    it('returns nothing for a scene that is not in the sequence', () => {
        const sequence = buildChronologueSceneSequence([scene(1, '2024-03-01T09:00:00'), scene(2, null)]);
        expect(findUndatedFollowers(sequence, 'Book/missing.md')).toEqual([]);
    });
});
