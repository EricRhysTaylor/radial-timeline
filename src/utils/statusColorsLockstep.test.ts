import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_HEX } from './constants';

// constants.ts says STATUS_HEX must stay in lockstep with variables.css. This
// is the check that sentence never had.
describe('STATUS_HEX lockstep with variables.css', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/variables.css'), 'utf8');
    const cssVar = (name: string): string => {
        const m = css.match(new RegExp(`--rt-color-${name}:\\s*(#[0-9a-fA-F]{6})`));
        if (!m) throw new Error(`--rt-color-${name} is not defined in variables.css`);
        return m[1].toLowerCase();
    };

    // Complete has no --rt-color-* variable: its hex is used directly by the
    // completion glyph and is not part of the theme token set.
    it.each([
        ['Working', 'working'],
        ['Todo', 'todo'],
        ['Empty', 'empty'],
        ['Due', 'due']
    ] as const)('%s matches --rt-color-%s', (key, name) => {
        expect(STATUS_HEX[key].toLowerCase()).toBe(cssVar(name));
    });
});
