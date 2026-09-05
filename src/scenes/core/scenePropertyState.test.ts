import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import {
    getAdvancedMode,
    getScenePropertyState,
    shouldEnableRemoveAdvanced,
} from './scenePropertyState';

function buildSettings(advancedEnabled: boolean) {
    return {
        ...DEFAULT_SETTINGS,
        sceneAdvancedPropertiesEnabled: advancedEnabled,
        sceneYamlTemplates: {
            base: 'Class: Scene\nAct: 1\nWhen: 2026-01-01\nPulse Update:\nSummary Update:',
            advanced: 'Place: Somewhere\nQuestions:\nReader Emotion:',
        },
    };
}

describe('scenePropertyState', () => {
    it('returns enabled mode when advanced properties are enabled', () => {
        expect(getAdvancedMode(buildSettings(true))).toBe('enabled');
    });

    it('returns disabled mode when advanced properties are disabled', () => {
        expect(getAdvancedMode(buildSettings(false))).toBe('disabled');
    });

    it('splits core and advanced fields from scene frontmatter', () => {
        const state = getScenePropertyState({
            settings: buildSettings(false),
            frontmatter: {
                ID: 'scn_1',
                Class: 'Scene',
                Act: 1,
                Place: 'Paris',
                Questions: ['Who'],
            },
        });

        expect(state.coreFields).toEqual({
            ID: 'scn_1',
            Class: 'Scene',
            Act: 1,
        });
        expect(state.advancedFields).toEqual({
            Place: 'Paris',
            Questions: ['Who'],
        });
        expect(state.hasAdvanced).toBe(true);
    });

    it('disables remove-advanced when advanced mode is enabled', () => {
        expect(shouldEnableRemoveAdvanced({
            settings: buildSettings(true),
            scenes: [{ Class: 'Scene', Place: 'Paris' }],
        })).toBe(false);
    });

    it('enables remove-advanced only when advanced mode is disabled and a scene contains advanced fields', () => {
        expect(shouldEnableRemoveAdvanced({
            settings: buildSettings(false),
            scenes: [{ Class: 'Scene', Place: 'Paris' }],
        })).toBe(true);

        expect(shouldEnableRemoveAdvanced({
            settings: buildSettings(false),
            scenes: [{ Class: 'Scene', Act: 1 }],
        })).toBe(false);
    });
});
