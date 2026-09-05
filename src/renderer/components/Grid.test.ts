import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { STAGES_FOR_GRID, STATUSES_FOR_GRID } from '../../utils/constants';
import { computeGridData } from '../utils/GridData';
import { renderCenterGrid } from './Grid';

const COLORS = {
    Zero: '#8b5cf6',
    Author: '#5b8def',
    House: '#f97316',
    Press: '#22c55e',
};

function scene(path: string, stage: string, status: string): TimelineItem {
    return {
        path,
        itemType: 'Scene',
        date: '',
        'Publish Stage': stage,
        status,
    };
}

function renderGrid(scenes: TimelineItem[]): string {
    const data = computeGridData(scenes);
    return renderCenterGrid({
        statusesForGrid: [...STATUSES_FOR_GRID],
        stagesForGrid: [...STAGES_FOR_GRID],
        gridCounts: data.gridCounts,
        gridSceneNames: data.gridSceneNames,
        gridStageStates: data.gridStageStates,
        isBookComplete: data.isBookComplete,
        PUBLISH_STAGE_COLORS: COLORS,
        currentYearLabel: '2026',
        estimatedTotalScenes: data.estimatedTotalScenes,
        totalRuntimeSeconds: 0,
        startXGrid: 0,
        startYGrid: 0,
        cellWidth: 20,
        cellHeight: 20,
        cellGapX: 2,
        cellGapY: 2,
        headerY: -10,
        stageTooltips: {},
        statusTooltips: {},
    });
}

describe('renderCenterGrid', () => {
    it('does not show stage-complete or book-complete icons when one Press scene skips ahead', () => {
        const svg = renderGrid([
            scene('1.md', 'Zero', 'Todo'),
            scene('2.md', 'Author', 'Complete'),
            scene('3.md', 'Press', 'Complete'),
        ]);

        expect(svg).not.toContain('Book Complete');
        expect(svg).not.toContain('icon-smile');
        expect(svg).not.toContain('rt-grid-cell-complete');
    });

    it('fills a completed row with that row color before final book completion', () => {
        const svg = renderGrid([
            scene('1.md', 'Zero', 'Complete'),
            scene('2.md', 'Author', 'Todo'),
        ]);

        expect(svg).toContain('Zero stage complete');
        expect(svg).toContain('icon-bookmark-check');
        expect(svg).toContain(`fill="${COLORS.Zero}"`);
        expect(svg).not.toContain('Book Complete');
        expect(svg).not.toContain('icon-smile');
    });

    it('uses Press smile completion only when every scene is Press complete', () => {
        const svg = renderGrid([
            scene('1.md', 'Press', 'Complete'),
            scene('2.md', 'Press', 'Complete'),
        ]);

        expect(svg).toContain('Book Complete');
        expect(svg).toContain('icon-smile');
        expect(svg).toContain(`fill="${COLORS.Press}"`);
    });
});
