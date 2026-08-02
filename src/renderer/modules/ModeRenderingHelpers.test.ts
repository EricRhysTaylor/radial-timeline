import { describe, expect, it } from 'vitest';
import { modeHasAllScenesOuterRing, usesSequenceAlignment } from './ModeRenderingHelpers';
import { TimelineMode } from '../../modes/ModeDefinition';
import type { PluginRendererFacade } from '../../utils/sceneHelpers';

function facade(currentMode: string, subplotAlignment?: 'fill' | 'sequence'): PluginRendererFacade {
    return { settings: { currentMode, subplotAlignment } } as unknown as PluginRendererFacade;
}

describe('usesSequenceAlignment', () => {
    it('is off unless the setting asks for it', () => {
        expect(usesSequenceAlignment(facade('narrative'))).toBe(false);
        expect(usesSequenceAlignment(facade('narrative', 'fill'))).toBe(false);
        expect(usesSequenceAlignment(facade('narrative', 'sequence'))).toBe(true);
    });

    it('stays off in Progress mode, which has no all-scenes ring to align to', () => {
        expect(usesSequenceAlignment(facade('progress', 'sequence'))).toBe(false);
    });

    it('applies wherever there is an all-scenes outer ring', () => {
        // The gate is structural, not a mode allowlist — Chronologue and
        // Gossamer both draw one, so alignment means the same thing there.
        expect(usesSequenceAlignment(facade('chronologue', 'sequence'))).toBe(true);
        expect(usesSequenceAlignment(facade('gossamer', 'sequence'))).toBe(true);
    });
});

describe('modeHasAllScenesOuterRing', () => {
    it('separates the one mode whose outer ring is Main Plot only', () => {
        expect(modeHasAllScenesOuterRing(TimelineMode.NARRATIVE)).toBe(true);
        expect(modeHasAllScenesOuterRing(TimelineMode.CHRONOLOGUE)).toBe(true);
        expect(modeHasAllScenesOuterRing(TimelineMode.GOSSAMER)).toBe(true);
        expect(modeHasAllScenesOuterRing(TimelineMode.PROGRESS)).toBe(false);
    });
});
