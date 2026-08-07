import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { computeCacheableValues } from './Precompute';
import { createSearchState } from '../../services/searchState';

describe('computeCacheableValues', () => {
    it('uses the project most-advanced publish stage color in Gossamer mode', () => {
        const plugin = {
            settings: {
                currentMode: 'gossamer',
                publishStageColors: {
                    Zero: '#9900ff',
                    Author: '#3366ff',
                    House: '#33aa44',
                    Press: '#ffaa00',
                },
                subplotColors: ['#eeeeee'],
                enableAiSceneAnalysis: false,
                actCount: 3,
            },
            searchState: createSearchState(),
            openScenePaths: new Set<string>(),
            desaturateColor: (hex: string) => hex,
            calculateCompletionEstimate: () => null,
            synopsisManager: {
                generateElement: () => document.createElementNS('http://www.w3.org/2000/svg', 'g'),
            },
        };
        const scenes: TimelineItem[] = [
            {
                title: '1 Opening',
                path: 'Book/1 Opening.md',
                date: '',
                subplot: 'Main Plot',
                actNumber: 1,
                'Publish Stage': 'Author',
            },
            {
                title: '1 Catalyst',
                path: 'Beats/1 Catalyst.md',
                date: '',
                itemType: 'Beat',
                subplot: 'Main Plot',
                actNumber: 1,
                'Publish Stage': 'Zero',
            },
        ];

        const values = computeCacheableValues(plugin as never, scenes);

        expect(values.maxStageColor).toBe('#3366ff');
    });

    it('clamps an out-of-range actNumber to the last quadrant instead of wrapping to Act 1', () => {
        // Regression test for GH #31: a scene whose actNumber exceeds the
        // currently configured actCount (e.g. cached from before the user
        // lowered actCount) must land in the last valid quadrant, not
        // silently collapse into Act 1's quadrant.
        const plugin = {
            settings: {
                currentMode: 'narrative',
                publishStageColors: {
                    Zero: '#9900ff',
                    Author: '#3366ff',
                    House: '#33aa44',
                    Press: '#ffaa00',
                },
                subplotColors: ['#eeeeee'],
                enableAiSceneAnalysis: false,
                actCount: 3,
            },
            searchState: createSearchState(),
            openScenePaths: new Set<string>(),
            desaturateColor: (hex: string) => hex,
            calculateCompletionEstimate: () => null,
            synopsisManager: {
                generateElement: () => document.createElementNS('http://www.w3.org/2000/svg', 'g'),
            },
        };
        const scenes: TimelineItem[] = [
            {
                title: '1 Stale Act Four Scene',
                path: 'Book/1 Stale.md',
                date: '',
                subplot: 'Main Plot',
                actNumber: 4,
            },
        ];

        const values = computeCacheableValues(plugin as never, scenes);

        expect(values.scenesByActAndSubplot[2]['Main Plot']).toHaveLength(1);
        expect(values.scenesByActAndSubplot[0]['Main Plot'] ?? []).toHaveLength(0);
    });
});
