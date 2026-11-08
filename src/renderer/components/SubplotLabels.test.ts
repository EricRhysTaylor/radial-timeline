import { describe, expect, it } from 'vitest';
import { renderSubplotLabels } from './SubplotLabels';
import type { PluginRendererFacade } from '../../utils/sceneHelpers';
import { assignSubplotColors, subplotColorCss } from '../utils/subplotColors';

// SAFE: minimal test fixture; renderSubplotLabels only reads settings.currentMode via getSubplotLabelText
const plugin = { settings: { currentMode: 'narrative' } } as unknown as PluginRendererFacade;

function render(masterSubplotOrder: string[], own: Map<string, string> = new Map()): string {
    const NUM_RINGS = masterSubplotOrder.length;
    const colors = assignSubplotColors(masterSubplotOrder.filter(name => name !== 'Backdrop'), own);
    return renderSubplotLabels({
        NUM_RINGS,
        ringStartRadii: Array.from({ length: NUM_RINGS }, (_, i) => 100 + i * 40),
        ringWidths: Array.from({ length: NUM_RINGS }, () => 30),
        masterSubplotOrder,
        subplotColorFor: name => subplotColorCss(colors.get(name)!),
        plugin,
    });
}

describe('renderSubplotLabels', () => {
    it('stamps each ring with the color it paints, for the subplot ring key', () => {
        const svg = render(['Main Plot', 'Voyage Home', 'Suitors']);
        // Outer ring (offset 0) is the highest ring index; palette slots follow subplot order.
        expect(svg).toContain('data-subplot-index="0" data-subplot-name="Main Plot" data-ring="2" data-subplot-color="var(--rt-subplot-colors-0)"');
        expect(svg).toContain('data-subplot-index="1" data-subplot-name="Voyage Home" data-ring="1" data-subplot-color="var(--rt-subplot-colors-1)"');
        expect(svg).toContain('data-subplot-index="2" data-subplot-name="Suitors" data-ring="0" data-subplot-color="var(--rt-subplot-colors-2)"');
    });

    it('stamps a subplot that has its own color with that color', () => {
        const svg = render(['Main Plot', 'Voyage Home', 'Suitors'], new Map([['Voyage Home', '#e93147']]));
        expect(svg).toContain('data-subplot-name="Voyage Home" data-ring="1" data-subplot-color="#e93147"');
        expect(svg).toContain('data-subplot-name="Suitors" data-ring="0" data-subplot-color="var(--rt-subplot-colors-1)"');
    });

    it('skips virtual backdrop rings without shifting other rings\' colors', () => {
        const svg = render(['Main Plot', 'Backdrop', 'Suitors']);
        expect(svg).not.toContain('data-subplot-name="Backdrop"');
        expect(svg).toContain('data-subplot-index="2" data-subplot-name="Suitors" data-ring="0" data-subplot-color="var(--rt-subplot-colors-1)"');
    });
});
