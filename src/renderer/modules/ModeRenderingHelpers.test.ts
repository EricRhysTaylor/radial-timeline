import { describe, expect, it } from 'vitest';
import { usesSequenceAlignment } from './ModeRenderingHelpers';
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

    it('stays off in Chronologue until its toggle ships', () => {
        // Chronologue does have an all-scenes outer ring, so this is a
        // deliberate hold, not a structural limit — see the helper's comment.
        expect(usesSequenceAlignment(facade('chronologue', 'sequence'))).toBe(false);
    });
});
