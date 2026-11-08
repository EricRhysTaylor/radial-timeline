import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * With the planet calendar (Alt) on, the rim carries the planet's dates and a
 * hover only lights the scene, as a measurable one: no synopsis shows. Shift
 * does the same. Turning Alt or Shift off brings back the normal hover, whose
 * synopsis always carries the planet date. Clicking two scenes measures in
 * both modes, in the planet's time when Alt is on.
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

    it('keeps the hover in Alt as in Shift: the scene lights and the hover stops there', () => {
        for (const event of ['pointerover', 'pointerout']) {
            const block = body(event);
            expect(block).toContain('if (!mode.shift && !mode.alien) return;');
            expect(block).toContain('e.stopImmediatePropagation();');
            // No Alt-only branch that lets the hover through to the synopsis.
            expect(block).not.toContain('if (!mode.shift) {');
        }
        expect(controller).not.toContain('lightAltNumberSquare');
        const synopsisHover = handler(mode, 'pointerover');
        expect(synopsisHover).toContain('if (view.chronologueState.shift || view.chronologueState.alien || isSubplotDragActive()) {');
    });

    it('still measures between two clicked scenes in Alt', () => {
        expect(controller).toContain('view.handleShiftModeClick = (e: MouseEvent, sceneGroup: Element) => {\n        if (!mode.shift && !mode.alien) return false;');
        expect(mode).toContain('if (view.chronologueState.shift || view.chronologueState.alien) {\n            const handled = view.handleShiftModeClick?.(e, g);');
    });
});

describe('Alt hover styles', () => {
    it('leaves the synopsis to its normal rules, so a hover never shows them all', () => {
        const styles = ['timeline.css', 'scenes.css', 'base.css', 'chronologue-alt.css', 'chronologue-base.css', 'chronologue-shift.css']
            .map(file => readFileSync(resolve(process.cwd(), 'src/styles', file), 'utf8'))
            .join('\n')
            .replace(/\/\*[\s\S]*?\*\//g, '');
        // Any selector that styles the synopsis by shift or Alt mode.
        const selectors = styles.split('{').map(chunk => chunk.slice(chunk.lastIndexOf('}') + 1).trim());
        expect(selectors.filter(selector => selector.includes('data-shift-mode') && selector.includes('rt-scene-info'))).toEqual([]);
    });
});
