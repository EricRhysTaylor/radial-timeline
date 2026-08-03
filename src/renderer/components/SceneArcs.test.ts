import { describe, expect, it } from 'vitest';
import { sceneArcPath } from './SceneArcs';
import { buildArcPath } from '../../view/interactions/SceneTitleExpansion';

/** The two arc commands in a cell path, as [largeArcFlag, sweepFlag] pairs. */
function arcFlags(path: string): Array<[string, string]> {
    return [...path.matchAll(/A\s+[\d.-]+\s+[\d.-]+\s+0\s+(\d)\s+(\d)/g)]
        .map(match => [match[1], match[2]] as [string, string]);
}

describe('sceneArcPath', () => {
    const INNER = 400;
    const OUTER = 500;

    it('draws a normal cell the short way round', () => {
        expect(arcFlags(sceneArcPath(INNER, OUTER, 0, 1))).toEqual([['0', '1'], ['0', '0']]);
    });

    it('flags an arc wider than a half turn', () => {
        // A Sequence-aligned subplot ring voids every stretch it is absent
        // from; those spans routinely exceed 180°. Without the flag SVG draws
        // the short way round and the cell lands on the far side of the wheel.
        expect(arcFlags(sceneArcPath(INNER, OUTER, 0, Math.PI * 1.5))).toEqual([['1', '1'], ['1', '0']]);
    });

    it('switches at exactly a half turn', () => {
        expect(arcFlags(sceneArcPath(INNER, OUTER, 0, Math.PI))).toEqual([['0', '1'], ['0', '0']]);
        expect(arcFlags(sceneArcPath(INNER, OUTER, 0, Math.PI + 0.01))).toEqual([['1', '1'], ['1', '0']]);
    });

    it('still has its own full-circle form', () => {
        // Not the two-arc shape — a full ring is drawn as four half arcs.
        expect(arcFlags(sceneArcPath(INNER, OUTER, 0, Math.PI * 2))).toHaveLength(4);
    });
});

describe('buildArcPath', () => {
    it('derives the flag the same way, so hover cannot reshape a wide cell', () => {
        // Hover rewrites the same path element; a different rule here would
        // make a wide arc jump shape on mouse-over.
        expect(arcFlags(buildArcPath(400, 500, 0, 1)))
            .toEqual(arcFlags(sceneArcPath(400, 500, 0, 1)));
        expect(arcFlags(buildArcPath(400, 500, 0, Math.PI * 1.5)))
            .toEqual(arcFlags(sceneArcPath(400, 500, 0, Math.PI * 1.5)));
    });
});
