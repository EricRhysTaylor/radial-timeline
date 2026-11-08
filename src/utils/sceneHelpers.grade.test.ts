import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../types';
import { extractGradeFromScene, type PluginRendererFacade } from './sceneHelpers';

/*
 * Saved pulse grades are the writer's data: the number squares wear them
 * whether or not AI is on. Only running a new analysis needs AI.
 */
describe('saved pulse grades on the number squares', () => {
    it.each([false, true])('reads the saved grade with AI on: %s', enabled => {
        const plugin = { settings: { enableAiSceneAnalysis: enabled } } as unknown as PluginRendererFacade; // SAFE: grade extraction reads no other plugin state
        const grades = new Map<string, string>();
        extractGradeFromScene({ title: '8 Netherfield Dinner', currentSceneAnalysis: '8 A / Netherfield dinner lands' } as TimelineItem, 'scene-8', grades, plugin);
        expect(grades.get('scene-8')).toBe('A');
    });

    it('draws and keeps grade colors without reading the AI switch', () => {
        for (const file of ['src/renderer/components/NumberSquares.ts', 'src/renderer/renderers/NumberSquareRenderer.ts', 'src/renderer/dom/NumberSquareDOMUpdater.ts']) {
            expect(readFileSync(resolve(process.cwd(), file), 'utf8'), file).not.toContain('enableAiSceneAnalysis');
        }
        const helpers = readFileSync(resolve(process.cwd(), 'src/utils/sceneHelpers.ts'), 'utf8');
        const extract = helpers.slice(helpers.indexOf('export function extractGradeFromScene'), helpers.indexOf('const analysisText', helpers.indexOf('export function extractGradeFromScene')));
        expect(extract).not.toContain('enableAiSceneAnalysis');
    });
});
