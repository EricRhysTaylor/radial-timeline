import { describe, expect, it } from 'vitest';
import { BUILTIN_MODELS } from './builtinModels';
import { RETIRED_MODEL_SUCCESSORS, resolveRetiredAlias } from './retiredModels';

describe('RETIRED_MODEL_SUCCESSORS — same-lane contract', () => {
    for (const [retired, entry] of Object.entries(RETIRED_MODEL_SUCCESSORS)) {
        it(`${retired} is gone from the catalog`, () => {
            expect(BUILTIN_MODELS.some(model => model.alias === retired)).toBe(false);
        });

        it(`${retired} resolves to a catalog model on its own tier`, () => {
            const alias = resolveRetiredAlias(retired);
            const successor = BUILTIN_MODELS.find(model => model.alias === alias);
            expect(successor, `${retired} → ${String(alias)}`).toBeDefined();
            expect(successor?.tier).toBe(entry.tier);
        });
    }
});

describe('resolveRetiredAlias', () => {
    it('leaves live and unknown aliases to the caller', () => {
        expect(resolveRetiredAlias('claude-opus-5-5')).toBeUndefined();
        expect(resolveRetiredAlias('not-a-model')).toBeUndefined();
        expect(resolveRetiredAlias(undefined)).toBeUndefined();
    });

    it('maps a cost-chosen Haiku pin to the current Haiku, not to Opus', () => {
        expect(resolveRetiredAlias('claude-haiku-4-5')).toBe('claude-haiku-5-5');
    });
});
