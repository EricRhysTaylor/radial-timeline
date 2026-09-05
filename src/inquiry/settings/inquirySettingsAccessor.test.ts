import { describe, it, expect } from 'vitest';
import { InquirySettingsAccessor, type InquirySettingsShape } from './inquirySettingsAccessor';

// The accessor is intentionally trivial — pass-through reads with no
// defaulting and no normalization. Tests verify (1) each getter reads
// the right field, (2) undefined fields propagate as undefined (callers
// keep their `?? fallback` semantics), and (3) the closure always reads
// the current settings object (so plugin.loadData() reassignments are
// observable).

function makeAccessor(settings: InquirySettingsShape): InquirySettingsAccessor {
    return new InquirySettingsAccessor(() => settings);
}

describe('InquirySettingsAccessor', () => {
    it('getSources returns the raw inquirySources field', () => {
        const sources = { preset: 'default' } as InquirySettingsShape['inquirySources'];
        const a = makeAccessor({ inquirySources: sources });
        expect(a.getSources()).toBe(sources);
    });

    it('getActionNotesAutoPopulate returns the raw boolean (no defaulting)', () => {
        expect(makeAccessor({ inquiryActionNotesAutoPopulate: true }).getActionNotesAutoPopulate()).toBe(true);
        expect(makeAccessor({ inquiryActionNotesAutoPopulate: false }).getActionNotesAutoPopulate()).toBe(false);
        // No fallback applied — caller keeps its own `?? false`.
        expect(makeAccessor({}).getActionNotesAutoPopulate()).toBeUndefined();
    });

    it('getPromptConfig returns the raw config (no normalization)', () => {
        const cfg = { setup: [], pressure: [], payoff: [] } as unknown as InquirySettingsShape['inquiryPromptConfig'];
        const a = makeAccessor({ inquiryPromptConfig: cfg });
        expect(a.getPromptConfig()).toBe(cfg);
    });

    it('getTargetCache returns the raw cache', () => {
        const cache = { lastBookId: 'b1', lastTargetSceneIdsByBookId: { b1: ['s1'] } };
        expect(makeAccessor({ inquiryTargetCache: cache }).getTargetCache()).toBe(cache);
    });

    it('getOmnibusProgress returns the raw progress state', () => {
        const progress = { activeQuestionId: 'q1' } as InquirySettingsShape['inquiryOmnibusProgress'];
        expect(makeAccessor({ inquiryOmnibusProgress: progress }).getOmnibusProgress()).toBe(progress);
    });

    it('getTimingHistory returns the raw record', () => {
        const history = { 'engine:openai-gpt-4': { observed: [] } } as unknown as InquirySettingsShape['inquiryTimingHistory'];
        expect(makeAccessor({ inquiryTimingHistory: history }).getTimingHistory()).toBe(history);
    });

    it('getCorpusThresholds returns the raw thresholds', () => {
        const thresholds = { emptyMax: 10, sketchyMin: 50 };
        expect(makeAccessor({ inquiryCorpusThresholds: thresholds }).getCorpusThresholds()).toBe(thresholds);
    });

    it('all getters return undefined when no settings have been set', () => {
        const a = makeAccessor({});
        expect(a.getSources()).toBeUndefined();
        expect(a.getActionNotesAutoPopulate()).toBeUndefined();
        expect(a.getPromptConfig()).toBeUndefined();
        expect(a.getTargetCache()).toBeUndefined();
        expect(a.getOmnibusProgress()).toBeUndefined();
        expect(a.getTimingHistory()).toBeUndefined();
        expect(a.getCorpusThresholds()).toBeUndefined();
    });

    it('reads through the closure on every call (sees post-construction mutations)', () => {
        // Critical: plugin.loadData() may reassign the settings object
        // after the accessor is constructed. Capturing a reference at
        // construction would freeze a stale view. Closure-based reads
        // always see the current object.
        let backing: InquirySettingsShape = { inquiryActionNotesAutoPopulate: false };
        const a = new InquirySettingsAccessor(() => backing);

        expect(a.getActionNotesAutoPopulate()).toBe(false);

        backing = { inquiryActionNotesAutoPopulate: true };
        expect(a.getActionNotesAutoPopulate()).toBe(true);
    });

    it('exposes no write methods (read-only facade — Slice 3 contract)', () => {
        // Reflective surface check. Any future `set*` method is scope
        // creep into a slice the user explicitly deferred ("no writes,
        // no behavior changes").
        const a = makeAccessor({});
        const proto = Object.getPrototypeOf(a) as Record<string, unknown>;
        const methods = Object.getOwnPropertyNames(proto).filter(n => n !== 'constructor');

        const writes = methods.filter(n => /^(set|write|update|clear|delete|remove)/i.test(n));
        expect(writes).toEqual([]);
    });

    it('public method surface is exactly the 7 documented read methods', () => {
        const a = makeAccessor({});
        const proto = Object.getPrototypeOf(a) as Record<string, unknown>;
        const methods = Object.getOwnPropertyNames(proto)
            .filter(n => n !== 'constructor' && typeof (a as unknown as Record<string, unknown>)[n] === 'function');

        expect(methods.sort()).toEqual([
            'getActionNotesAutoPopulate',
            'getCorpusThresholds',
            'getOmnibusProgress',
            'getPromptConfig',
            'getSources',
            'getTargetCache',
            'getTimingHistory',
        ]);
    });
});
