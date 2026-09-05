import { describe, expect, it } from 'vitest';
import { renderSubplotLabels } from './SubplotLabels';
import type { PluginRendererFacade } from '../../utils/sceneHelpers';

// SAFE: minimal test fixture; renderSubplotLabels only reads settings.currentMode via getSubplotLabelText
const plugin = { settings: { currentMode: 'narrative' } } as unknown as PluginRendererFacade;

function render(masterSubplotOrder: string[]): string {
    const NUM_RINGS = masterSubplotOrder.length;
    const colorIndexBySubplot = new Map<string, number>();
    masterSubplotOrder.forEach((subplot, idx) => colorIndexBySubplot.set(subplot, idx % 16));
    return renderSubplotLabels({
        NUM_RINGS,
        ringStartRadii: Array.from({ length: NUM_RINGS }, (_, i) => 100 + i * 40),
        ringWidths: Array.from({ length: NUM_RINGS }, () => 30),
        masterSubplotOrder,
        colorIndexBySubplot,
        plugin,
    });
}

describe('renderSubplotLabels', () => {
    it('stamps ring and color-index data used by the subplot ring key', () => {
        const svg = render(['Main Plot', 'Voyage Home', 'Suitors']);
        // Outer ring (offset 0) is the highest ring index; color follows subplot order.
        expect(svg).toContain('data-subplot-index="0" data-subplot-name="Main Plot" data-ring="2" data-color-index="0"');
        expect(svg).toContain('data-subplot-index="1" data-subplot-name="Voyage Home" data-ring="1" data-color-index="1"');
        expect(svg).toContain('data-subplot-index="2" data-subplot-name="Suitors" data-ring="0" data-color-index="2"');
    });

    it('skips virtual backdrop rings without shifting other rings\' color indices', () => {
        const svg = render(['Main Plot', 'Backdrop', 'Suitors']);
        expect(svg).not.toContain('data-subplot-name="Backdrop"');
        expect(svg).toContain('data-subplot-index="2" data-subplot-name="Suitors" data-ring="0" data-color-index="2"');
    });
});
