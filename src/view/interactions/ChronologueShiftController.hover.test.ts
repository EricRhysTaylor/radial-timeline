import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * With the planet calendar (Alt) on, hovering a scene lights its number
 * square and shows its normal synopsis, which carries the planetary date and
 * time. Shift mode keeps the hover to itself so scenes light for measuring;
 * clicking two scenes measures in both modes.
 */
describe('Chronologue hover with the planet calendar on', () => {
    const controller = readFileSync(resolve(process.cwd(), 'src/view/interactions/ChronologueShiftController.ts'), 'utf8');
    const mode = readFileSync(resolve(process.cwd(), 'src/view/modes/ChronologueMode.ts'), 'utf8');
    const handler = (source: string, event: string) => {
        const start = source.indexOf(`registerDomEvent(svg as unknown as HTMLElement, '${event}'`);
        // The handler's opening lines, through its first early return.
        return source.slice(start, source.indexOf('return', start) + 'return'.length + 2);
    };
    /** A capture handler's body, up to the next registered handler. */
    const body = (event: string) => {
        const start = controller.indexOf(`registerDomEvent(svg as unknown as HTMLElement, '${event}'`);
        return controller.slice(start, controller.indexOf('}, { capture: true });', start));
    };

    it('lights the number square in Alt and lets the hover through; only Shift stops it', () => {
        for (const [event, active] of [['pointerover', 'true'], ['pointerout', 'false']] as const) {
            const block = body(event);
            expect(block).toContain('if (!mode.shift && !mode.alien) return;');
            const alt = block.indexOf('if (!mode.shift) {');
            const stop = block.indexOf('e.stopImmediatePropagation();');
            expect(alt).toBeGreaterThan(-1);
            // Alt returns before the propagation stop, which only Shift reaches.
            expect(block.slice(alt, stop)).toContain(`lightAltNumberSquare(g, ${active});\n                return;`);
            expect(stop).toBeGreaterThan(alt);
        }
        expect(controller).toMatch(/const lightAltNumberSquare = \(g: Element, active: boolean\) => \{[\s\S]*?selectedPathsSet\.has\(scenePathEncoded\)\) return;\s*setNumberSquareActive\(getSceneIdFromGroup\(g\), active, numberLookup\);/);
        const synopsisHover = handler(mode, 'pointerover');
        expect(synopsisHover).toContain('if (view.chronologueState.shift || isSubplotDragActive()) {');
    });

    it('still measures between two clicked scenes in Alt', () => {
        expect(controller).toContain('view.handleShiftModeClick = (e: MouseEvent, sceneGroup: Element) => {\n        if (!mode.shift && !mode.alien) return false;');
        expect(mode).toContain('if (view.chronologueState.shift || view.chronologueState.alien) {\n            const handled = view.handleShiftModeClick?.(e, g);');
    });
});
