import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import {
    buildScenePropertyDefinitions,
    serializeAdvancedSceneProperties,
} from './scenePropertyAdapter';

describe('scenePropertyAdapter', () => {
    it('derives core and advanced scene properties from legacy settings', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            sceneYamlTemplates: {
                base: 'Class: Scene\nAct: 1\nWhen: 2026-01-01\nPulse Update:\nSummary Update:',
                advanced: 'Place: Somewhere\nQuestions:\nReader Emotion: Curious',
            },
            hoverMetadataFields: [
                { key: 'Place', label: 'Place', icon: 'map-pinned', enabled: true },
            ],
        };

        const definitions = buildScenePropertyDefinitions(settings);

        expect(definitions.core.map((definition) => definition.key)).toEqual([
            'Class',
            'Act',
            'When',
            'Pulse Update',
            'Summary Update',
        ]);
        expect(definitions.advanced.map((definition) => definition.key)).toEqual([
            'Place',
            'Questions',
            'Reader Emotion',
        ]);
        expect(definitions.advanced[0].revealInHover).toBe(true);
        expect(definitions.advanced[0].hoverIcon).toBe('map-pinned');
    });

    it('serializes advanced properties back into legacy template and preserves unmatched hover metadata', () => {
        const serialized = serializeAdvancedSceneProperties(
            [
                {
                    key: 'Place',
                    defaultValue: 'Somewhere',
                    required: false,
                    source: 'advanced',
                    revealInHover: true,
                    hoverIcon: 'map-pinned',
                    hoverLabel: 'Place',
                },
                {
                    key: 'Questions',
                    defaultValue: ['Who', 'Why'],
                    required: false,
                    source: 'advanced',
                    revealInHover: false,
                    hoverLabel: 'Questions',
                },
            ],
            [
                { key: 'Legacy', label: 'Legacy', icon: 'box', enabled: true },
                { key: 'Place', label: 'Place', icon: 'align-left', enabled: false },
            ]
        );

        expect(serialized.advancedTemplate).toBe(
            'Place: Somewhere\nQuestions:\n  - Who\n  - Why'
        );
        expect(serialized.hoverMetadataFields).toEqual([
            { key: 'Place', label: 'Place', icon: 'map-pinned', enabled: true },
            { key: 'Questions', label: 'Questions', icon: 'align-vertical-space-around', enabled: false },
            { key: 'Legacy', label: 'Legacy', icon: 'box', enabled: true },
        ]);
    });
});
