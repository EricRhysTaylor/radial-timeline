import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import {
    resolveSceneExpectedKeys,
    resolveScenePropertyPolicy,
    splitSceneMissingKeys,
} from './scenePropertyPolicy';
import type { ScenePropertyDefinitions } from './types';

const definitions: ScenePropertyDefinitions = {
    core: [
        { key: 'Class', defaultValue: 'Scene', required: true, source: 'core', revealInHover: false },
        { key: 'Act', defaultValue: '1', required: true, source: 'core', revealInHover: false },
        { key: 'When', defaultValue: '', required: true, source: 'core', revealInHover: false },
        { key: 'Pulse Update', defaultValue: '', required: true, source: 'core', revealInHover: false },
        { key: 'Summary Update', defaultValue: '', required: true, source: 'core', revealInHover: false },
    ],
    advanced: [
        { key: 'Place', defaultValue: '', required: false, source: 'advanced', revealInHover: false },
        { key: 'Questions', defaultValue: '', required: false, source: 'advanced', revealInHover: false },
    ],
};

describe('scenePropertyPolicy', () => {
    it('treats undefined advanced toggle as enabled for compatibility', () => {
        expect(resolveScenePropertyPolicy(DEFAULT_SETTINGS).advancedEnabled).toBe(true);
    });

    it('computes expected scene keys from core only when advanced is disabled', () => {
        const expected = resolveSceneExpectedKeys(
            DEFAULT_SETTINGS,
            definitions,
            { advancedEnabled: false }
        );

        expect(expected.expectedKeys).toEqual([
            'Class',
            'Act',
            'When',
            'Pulse Update',
            'Summary Update',
        ]);
        expect(expected.toleratedInactiveKeys).toEqual(['Place', 'Questions']);
        expect(splitSceneMissingKeys(['Act', 'Place'], expected, { advancedEnabled: false })).toEqual({
            missingCoreKeys: ['Act'],
            missingAdvancedKeys: [],
        });
    });
});
