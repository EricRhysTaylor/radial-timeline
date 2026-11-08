import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * With the planet calendar (Alt) on, hovering a scene shows its normal
 * synopsis, which carries the planetary date and time. Shift mode keeps the
 * hover to itself so scenes light for measuring; clicking two scenes measures
 * in both modes.
 */
describe('Chronologue hover with the planet calendar on', () => {
    const controller = readFileSync(resolve(process.cwd(), 'src/view/interactions/ChronologueShiftController.ts'), 'utf8');
    const mode = readFileSync(resolve(process.cwd(), 'src/view/modes/ChronologueMode.ts'), 'utf8');
    const handler = (source: string, event: string) => {
        const start = source.indexOf(`registerDomEvent(svg as unknown as HTMLElement, '${event}'`);
        // The handler's opening lines, through its first early return.
        return source.slice(start, source.indexOf('return', start) + 'return'.length + 2);
    };

    it('lets the hover through to the synopsis in Alt, and only Shift stops it', () => {
        for (const event of ['pointerover', 'pointerout']) {
            const block = handler(controller, event);
            expect(block).toContain('if (!mode.shift) return;');
            expect(block).not.toContain('mode.alien');
        }
        const synopsisHover = handler(mode, 'pointerover');
        expect(synopsisHover).toContain('if (view.chronologueState.shift || isSubplotDragActive()) {');
    });

    it('still measures between two clicked scenes in Alt', () => {
        expect(controller).toContain('view.handleShiftModeClick = (e: MouseEvent, sceneGroup: Element) => {\n        if (!mode.shift && !mode.alien) return false;');
        expect(mode).toContain('if (view.chronologueState.shift || view.chronologueState.alien) {\n            const handled = view.handleShiftModeClick?.(e, g);');
    });
});
