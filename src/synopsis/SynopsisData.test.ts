import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectSavedPulseBlocks } from './SynopsisData';

describe('saved pulse in the scene hover', () => {
    const scene = {
        previousSceneAnalysis: '7 Mr Collins Proposes + / Sets up the refusal',
        currentSceneAnalysis: 'A / Netherfield dinner lands',
        nextSceneAnalysis: '9 Mrs Bennet Visits ? / Pays off the dinner'
    };

    it('shows the full saved triplet in reading order', () => {
        expect(selectSavedPulseBlocks(scene, true).map(block => block.key))
            .toEqual(['previousSceneAnalysis', 'currentSceneAnalysis', 'nextSceneAnalysis']);
    });

    it('shows only the scene itself when the full triplet is off', () => {
        expect(selectSavedPulseBlocks(scene, false)).toEqual([{ key: 'currentSceneAnalysis', text: scene.currentSceneAnalysis }]);
    });

    it('skips blocks the scene has no saved pulse for', () => {
        expect(selectSavedPulseBlocks({ currentSceneAnalysis: scene.currentSceneAnalysis }, true).map(block => block.key))
            .toEqual(['currentSceneAnalysis']);
        expect(selectSavedPulseBlocks({}, true)).toEqual([]);
    });

    it('draws saved pulse without reading the AI switch', () => {
        // Saved results are the writer's data; only a new analysis needs AI.
        const source = readFileSync(resolve(process.cwd(), 'src/SynopsisManager.ts'), 'utf8');
        expect(source).toContain('selectSavedPulseBlocks(scene, showTripletNeighbors)');
        expect(source).not.toContain('enableAiSceneAnalysis');
    });
});
