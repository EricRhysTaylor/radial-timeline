import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_ENVELOPE_WRAPPER_KEYS,
    unwrapStructuredEnvelope
} from './structuredResponseUnwrap';

const CANONICAL = ['beats', 'overallAssessment'] as const;

function gossamerLike() {
    return {
        beats: [{ beatName: 'Opening Image', signal: 'activity', score: 65, justification: 'x' }],
        overallAssessment: { summary: 'x', strengths: [], improvements: [] }
    };
}

describe('unwrapStructuredEnvelope — happy path', () => {
    it('unwraps each known wrapper key when inner has all canonical keys', () => {
        for (const wrapper of DEFAULT_ENVELOPE_WRAPPER_KEYS) {
            const inner = gossamerLike();
            const wrapped = { [wrapper]: inner };
            const result = unwrapStructuredEnvelope(wrapped, CANONICAL);
            expect(result.unwrappedKey, `wrapper="${wrapper}"`).toBe(wrapper);
            expect(result.value).toBe(inner);
        }
    });

    it('fires onUnwrap callback exactly once with the wrapper key name', () => {
        const cb = vi.fn();
        const wrapped = { input: gossamerLike() };
        unwrapStructuredEnvelope(wrapped, CANONICAL, { onUnwrap: cb });
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith('input');
    });

    it('does NOT fire onUnwrap when no unwrap occurs', () => {
        const cb = vi.fn();
        unwrapStructuredEnvelope(gossamerLike(), CANONICAL, { onUnwrap: cb });
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('unwrapStructuredEnvelope — rejects shapes that are not single-key envelopes', () => {
    it('returns input unchanged when parsed is null', () => {
        const result = unwrapStructuredEnvelope(null, CANONICAL);
        expect(result.unwrappedKey).toBeNull();
        expect(result.value).toBeNull();
    });

    it('returns input unchanged when parsed is a string', () => {
        const result = unwrapStructuredEnvelope('hello', CANONICAL);
        expect(result.unwrappedKey).toBeNull();
        expect(result.value).toBe('hello');
    });

    it('returns input unchanged when parsed is an array', () => {
        const arr = [gossamerLike()];
        const result = unwrapStructuredEnvelope(arr, CANONICAL);
        expect(result.unwrappedKey).toBeNull();
        expect(result.value).toBe(arr);
    });

    it('returns input unchanged when root has more than one key', () => {
        const multi = { input: gossamerLike(), extra: 1 };
        const result = unwrapStructuredEnvelope(multi, CANONICAL);
        expect(result.unwrappedKey).toBeNull();
        expect(result.value).toBe(multi);
    });

    it('returns input unchanged when root has zero keys', () => {
        const empty = {};
        const result = unwrapStructuredEnvelope(empty, CANONICAL);
        expect(result.unwrappedKey).toBeNull();
        expect(result.value).toBe(empty);
    });
});

describe('unwrapStructuredEnvelope — rejects unsafe inner shapes', () => {
    it('does NOT unwrap when the inner value is an array', () => {
        const wrapped = { input: [gossamerLike()] };
        const result = unwrapStructuredEnvelope(wrapped, CANONICAL);
        expect(result.unwrappedKey).toBeNull();
        expect(result.value).toBe(wrapped);
    });

    it('does NOT unwrap when the inner value is a scalar', () => {
        const wrapped = { input: 'just a string' };
        const result = unwrapStructuredEnvelope(wrapped, CANONICAL);
        expect(result.unwrappedKey).toBeNull();
    });

    it('does NOT unwrap when the inner object is missing a canonical key', () => {
        const wrapped = { input: { beats: [] } };
        const result = unwrapStructuredEnvelope(wrapped, CANONICAL);
        expect(result.unwrappedKey).toBeNull();
        expect(result.value).toBe(wrapped);
    });

    it('does NOT unwrap when inner has unrelated keys but no canonical keys', () => {
        const wrapped = { input: { foo: 1, bar: 2 } };
        const result = unwrapStructuredEnvelope(wrapped, CANONICAL);
        expect(result.unwrappedKey).toBeNull();
    });
});

describe('unwrapStructuredEnvelope — rejects unknown wrapper keys', () => {
    it('does NOT unwrap when the single key is not in the allow-list', () => {
        const wrapped = { payload: gossamerLike() };
        const result = unwrapStructuredEnvelope(wrapped, CANONICAL);
        expect(result.unwrappedKey).toBeNull();
        expect(result.value).toBe(wrapped);
    });

    it('respects a caller-provided allowedWrapperKeys override', () => {
        const wrapped = { payload: gossamerLike() };
        const result = unwrapStructuredEnvelope(wrapped, CANONICAL, {
            allowedWrapperKeys: ['payload']
        });
        expect(result.unwrappedKey).toBe('payload');
    });

    it('does NOT unwrap when caller restricts the allow-list to exclude the wrapper key', () => {
        const wrapped = { input: gossamerLike() };
        const result = unwrapStructuredEnvelope(wrapped, CANONICAL, {
            allowedWrapperKeys: ['output']
        });
        expect(result.unwrappedKey).toBeNull();
    });
});

describe('unwrapStructuredEnvelope — never recurses', () => {
    it('removes exactly one envelope, even if the wrapped value is itself wrapped', () => {
        const inner = gossamerLike();
        const doublyWrapped = { input: { input: inner } };
        const result = unwrapStructuredEnvelope(doublyWrapped, CANONICAL);
        // First-level unwrap finds inner = { input: gossamerLike() } which
        // does NOT have canonical keys (only "input"), so the whole call
        // returns unchanged — recursion is never attempted.
        expect(result.unwrappedKey).toBeNull();
        expect(result.value).toBe(doublyWrapped);
    });
});

describe('unwrapStructuredEnvelope — root-collision guard', () => {
    it('does NOT unwrap when the root already contains a canonical key (paranoia guard)', () => {
        // This shape cannot actually occur given the single-key constraint,
        // but the guard exists in case a future caller adds a canonical
        // key to the allow-list. Constructing the test via a custom
        // allow-list that overlaps with canonical keys forces the case.
        const wrapped = { beats: gossamerLike() };
        const result = unwrapStructuredEnvelope(wrapped, CANONICAL, {
            allowedWrapperKeys: ['beats']
        });
        expect(result.unwrappedKey).toBeNull();
        expect(result.value).toBe(wrapped);
    });
});

describe('unwrapStructuredEnvelope — DEFAULT_ENVELOPE_WRAPPER_KEYS', () => {
    it('includes both observed Anthropic envelope keys from production', () => {
        // input: observed 2026-05-23 evening (this commit's trigger)
        // $PARAMETER_NAME: observed 2026-05-23 morning (the first envelope-wrap)
        expect((DEFAULT_ENVELOPE_WRAPPER_KEYS as readonly string[])).toContain('input');
        expect((DEFAULT_ENVELOPE_WRAPPER_KEYS as readonly string[])).toContain('$PARAMETER_NAME');
    });

    it('does not list any of the Gossamer canonical keys (no overlap risk)', () => {
        expect((DEFAULT_ENVELOPE_WRAPPER_KEYS as readonly string[])).not.toContain('beats');
        expect((DEFAULT_ENVELOPE_WRAPPER_KEYS as readonly string[])).not.toContain('overallAssessment');
    });
});
