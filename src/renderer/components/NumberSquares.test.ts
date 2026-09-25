import { describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '../../types';
import type { PluginRendererFacade } from '../../utils/sceneHelpers';
import { renderInnerRingsNumberSquaresAllScenes } from './NumberSquares';

// Square sizing measures glyphs in a live Obsidian document.
vi.mock('../../utils/text', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/text')>()),
    getNumberSquareSize: () => ({ width: 20, height: 18 })
}));

function makePlugin(): PluginRendererFacade {
    return {
        settings: { actCount: 1, currentMode: 'narrative', enableAiSceneAnalysis: false },
        openScenePaths: new Set<string>(),
        searchState: { active: false, hits: new Set<string>() }
    } as unknown as PluginRendererFacade;
}

function scene(number: number, subplot: string): TimelineItem {
    return {
        title: `${number} Scene ${number}`,
        number,
        subplot,
        actNumber: 1,
        path: `Book/${subplot}-${number}.md`,
        itemType: 'Scene'
    } as unknown as TimelineItem;
}

function render(masterSubplotOrder: string[], scenes: TimelineItem[]): string {
    const scenesByActAndSubplot: Record<number, Record<string, TimelineItem[]>> = { 0: {} };
    scenes.forEach(s => {
        const bucket = scenesByActAndSubplot[0][s.subplot as string] ?? [];
        bucket.push(s);
        scenesByActAndSubplot[0][s.subplot as string] = bucket;
    });
    return renderInnerRingsNumberSquaresAllScenes({
        plugin: makePlugin(),
        NUM_RINGS: masterSubplotOrder.length,
        masterSubplotOrder,
        ringStartRadii: [200, 300],
        ringWidths: [100, 100],
        scenesByActAndSubplot,
        scenes,
        sceneGrades: new Map()
    });
}

const squareCount = (svg: string) => (svg.match(/class="[^"]*rt-number-square/g) ?? []).length;

describe('renderInnerRingsNumberSquaresAllScenes', () => {
    it('draws no squares for the subplot whose ring the all-scenes outer ring replaces', () => {
        const svg = render(['Main Plot', 'Ghosts'], [scene(1, 'Main Plot'), scene(2, 'Ghosts')]);
        expect(squareCount(svg)).toBe(1);
        expect(svg).toMatch(/scene-path-0-0-/);
    });

    it('skips the leading subplot even when the book has no Main Plot', () => {
        const svg = render(['Odysseus', 'Telemachus'], [scene(1, 'Odysseus'), scene(2, 'Telemachus')]);
        expect(squareCount(svg)).toBe(1);
        expect(svg).not.toMatch(/scene-path-0-1-/);
    });
});
