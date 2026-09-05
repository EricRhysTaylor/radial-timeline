import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Chronologue planetary default render safety', () => {
    it('defers planetary calendar auto-activation until after base timeline render', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/view/interactions/ChronologueShiftController.ts'), 'utf8');
        const setupBody = source.match(/export function setupChronologueShiftController\([\s\S]+?\n}\n\n\/\*\*/)?.[0] ?? '';

        expect(setupBody).toContain('schedulePlanetaryDefaultActivation');
        expect(setupBody).toContain('window.setTimeout');
        expect(setupBody).toContain("console.warn('[Chronologue] Failed to activate default planetary calendar view after render.'");
        expect(setupBody).toContain('schedulePlanetaryLabelUpdate();');
        expect(setupBody).not.toContain('} else if (shouldStartInPlanetaryCalendar()) {\n        toggleAlienMode();');
    });
});
