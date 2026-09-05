import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { buildProgressSnapshot } from './progressSnapshot';

function scene(path: string, stage: string, status: string): TimelineItem {
    return {
        path,
        title: path.replace(/\.md$/, ''),
        itemType: 'Scene',
        date: '',
        'Publish Stage': stage,
        status,
    };
}

describe('progressSnapshot', () => {
    it('does not complete any row when scenes remain incomplete in lower stages', () => {
        const snapshot = buildProgressSnapshot([
            scene('1.md', 'Zero', 'Todo'),
            scene('2.md', 'Author', 'Complete'),
            scene('3.md', 'Press', 'Complete'),
        ]);

        expect(snapshot.stageStates.Zero.isComplete).toBe(false);
        expect(snapshot.stageStates.Author.isComplete).toBe(false);
        expect(snapshot.stageStates.House.isComplete).toBe(false);
        expect(snapshot.stageStates.Press.isComplete).toBe(false);
        expect(snapshot.bookComplete).toBe(false);
    });

    it('marks a row complete when every scene has cleared that stage', () => {
        const snapshot = buildProgressSnapshot([
            scene('1.md', 'Zero', 'Complete'),
            scene('2.md', 'Author', 'Todo'),
            scene('3.md', 'House', 'Working'),
        ]);

        expect(snapshot.stageStates.Zero.isComplete).toBe(true);
        expect(snapshot.stageStates.Author.isComplete).toBe(false);
        expect(snapshot.highestCompletedStage).toBe('Zero');
    });

    it('treats later-stage scenes as having cleared earlier rows regardless of current status', () => {
        const snapshot = buildProgressSnapshot([
            scene('1.md', 'Author', 'Complete'),
            scene('2.md', 'House', 'Todo'),
            scene('3.md', 'Press', 'Working'),
        ]);

        expect(snapshot.stageStates.Zero.isComplete).toBe(true);
        expect(snapshot.stageStates.Author.isComplete).toBe(true);
        expect(snapshot.stageStates.House.isComplete).toBe(false);
        expect(snapshot.bookComplete).toBe(false);
    });

    it('marks book complete only when every unique scene is complete at Press', () => {
        const snapshot = buildProgressSnapshot([
            scene('1.md', 'Press', 'Complete'),
            scene('2.md', 'Press', 'Complete'),
        ]);

        expect(snapshot.stageStates.Zero.isComplete).toBe(true);
        expect(snapshot.stageStates.Author.isComplete).toBe(true);
        expect(snapshot.stageStates.House.isComplete).toBe(true);
        expect(snapshot.stageStates.Press.isComplete).toBe(true);
        expect(snapshot.highestCompletedStage).toBe('Press');
        expect(snapshot.bookComplete).toBe(true);
    });
});
