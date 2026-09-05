import { describe, expect, it } from 'vitest';
import { buildOutputRulesText } from './outputRules';

describe('buildOutputRulesText', () => {
    it('formats canonical json output rules from a schema', () => {
        const result = buildOutputRulesText({
            returnType: 'json',
            responseSchema: { type: 'object', properties: { ok: { type: 'boolean' } } }
        });

        expect(result.startsWith('Return JSON only. Validate against this schema:\n')).toBe(true);
        expect(result.includes('"ok"')).toBe(true);
    });
});
