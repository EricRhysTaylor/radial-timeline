import { describe, expect, it } from 'vitest';
import { measureFunctions, dynamicClassPatterns } from '../scripts/audit/source-analysis.mjs';

describe('audit source analysis', () => {
    it('measures multiline destructured signatures and nested closures exactly', () => {
        const source = ['export function render({', '  option', '}: { option: boolean }) {',
            '  const nested = () => {', '    return "}";', '  };', '  return nested();', '}'].join('\n');
        expect(measureFunctions(source)).toEqual([
            { name: 'render', start: 1, end: 8, lines: 8 },
            { name: 'nested', start: 4, end: 6, lines: 3 }
        ]);
    });
    it('excludes overload declarations and includes class methods and constructors', () => {
        const rows = measureFunctions('class A {\nconstructor() {}\nf(x: string): void;\nf(x: string) { }\n}');
        expect(rows.map(row => row.name)).toEqual(['constructor', 'f']);
    });
    it('recognizes dynamic prefixes, suffixes and multiple interpolations', () => {
        const patterns = dynamicClassPatterns('const a = `${prefix}-summary`; const b = `ert-state-${state}`; const c = `${prefix}-${kind}-label`;');
        for (const name of ['ert-desc-summary', 'ert-state-active', 'ert-desc-field-label']) {
            expect(patterns.some(pattern => pattern.test(name))).toBe(true);
        }
        expect(patterns.some(pattern => pattern.test('unrelated-class'))).toBe(false);
    });
    it('recognizes class tokens inside SVG markup and multi-class strings', () => {
        const patterns = dynamicClassPatterns('const a = `<g class="ert-row ert-state-${state}">`; const b = `${prefix}-body ert-muted`;');
        expect(patterns.some(pattern => pattern.test('ert-state-active'))).toBe(true);
        expect(patterns.some(pattern => pattern.test('ert-desc-body'))).toBe(true);
    });
    it('does not infer producers from comments, prose, or pure interpolation', () => {
        expect(dynamicClassPatterns('// `${prefix}-summary`\nconst a = `hello ${name}!`; const b = `${name}`; const c = `${a}-${b}`; const d = `${count}s`;')).toEqual([]);
    });
});
