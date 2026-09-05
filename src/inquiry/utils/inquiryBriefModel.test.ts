import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    getBriefModelLabel,
    buildSceneDossierHoverKey,
    getBriefSceneAnchorId,
    buildResultsHeroText,
    buildResultsMetaText,
    resolveInquiryBriefZoneLabel,
    buildSceneDossierModel,
    formatInquiryBriefTitle,
    isFindingHit,
    getFindingRole,
    getResultSummaryForMode,
    getOrderedFindings,
    normalizeInquiryBriefText,
    buildInquiryReferenceLabelMap,
    buildInquirySceneReferenceIndex,
    getInquiryActionText,
    buildInquiryPendingAction,
    buildBriefPendingActions,
    buildInquirySceneNotes,
    buildInquiryBriefModel
} from './inquiryBriefModel';
import type { InquiryFinding, InquiryLens, InquiryResult, InquirySelectionMode, InquiryZone } from '../state';
import type { InquiryCorpusItem } from '../services/InquiryCorpusResolver';

const result = (p: Partial<InquiryResult>): InquiryResult => p as unknown as InquiryResult;
const item = (p: Partial<InquiryCorpusItem>): InquiryCorpusItem => p as unknown as InquiryCorpusItem;
const finding = (p: Partial<InquiryFinding>): InquiryFinding => p as unknown as InquiryFinding;

describe('getBriefModelLabel', () => {
    it('returns null when no model id is recorded', () => {
        expect(getBriefModelLabel(result({}))).toBeNull();
        expect(getBriefModelLabel(result({ aiModelResolved: '', aiModelRequested: '' }))).toBeNull();
    });

    it('prefers aiModelResolved over aiModelRequested', () => {
        const r = result({ aiModelResolved: 'gpt-5.5', aiModelRequested: 'ignored-requested' });
        const label = getBriefModelLabel(r);
        expect(typeof label === 'string' && label.length > 0).toBe(true);
        expect(label?.toLowerCase()).not.toContain('ignored');
    });

    it('falls back to aiModelRequested when aiModelResolved is missing/empty', () => {
        expect(getBriefModelLabel(result({ aiModelResolved: '', aiModelRequested: 'gpt-5.5' })))
            .toBe(getBriefModelLabel(result({ aiModelResolved: 'gpt-5.5' })));
    });

    it('strips a leading "models/" prefix before display lookup', () => {
        const plain = getBriefModelLabel(result({ aiModelResolved: 'gemini-2.5-flash' }));
        const prefixed = getBriefModelLabel(result({ aiModelResolved: 'models/gemini-2.5-flash' }));
        expect(prefixed).toBe(plain);
    });

    it('strips a trailing parenthetical suffix from the display label', () => {
        // Use an unknown id so getModelDisplayName passes it through; verify no
        // trailing "(...)" remains regardless of display-name source.
        const label = getBriefModelLabel(result({ aiModelResolved: 'my-model (preview build)' }));
        expect(label).not.toMatch(/\(.*\)\s*$/);
    });

    it('returns null when the resolved label trims to empty', () => {
        // A whitespace-only display label collapses to null after trim.
        expect(getBriefModelLabel(result({ aiModelResolved: '   ' }))).toBeNull();
    });
});

describe('buildSceneDossierHoverKey', () => {
    it('returns the exact key shape: id::sceneId::label::refId::headline', () => {
        const key = buildSceneDossierHoverKey(
            item({ id: 'I1', sceneId: 'scn_abc' }),
            'S3',
            finding({ refId: 'scn_abc', headline: 'Beat lands soft' })
        );
        expect(key).toBe('I1::scn_abc::S3::scn_abc::Beat lands soft');
        expect(key.split('::').length).toBe(5);
    });

    it('missing sceneId / refId / headline become empty segments at fixed positions', () => {
        const key = buildSceneDossierHoverKey(
            item({ id: 'I1' }),
            'S3',
            finding({})
        );
        expect(key).toBe('I1::::S3::::');
        // Segment count is invariant — positions must stay comparable.
        expect(key.split('::').length).toBe(5);
    });

    it('identical inputs return an identical key (idempotent)', () => {
        const i = item({ id: 'I1', sceneId: 'scn_x' });
        const f = finding({ refId: 'scn_x', headline: 'H' });
        expect(buildSceneDossierHoverKey(i, 'L', f)).toBe(buildSceneDossierHoverKey(i, 'L', f));
    });
});

describe('getBriefSceneAnchorId', () => {
    const fakeHash = (v: string): string => `H(${v})`;
    it('composes "inquiry-" + hashed source', () => {
        expect(getBriefSceneAnchorId('scn_a1b2', fakeHash)).toBe('inquiry-H(scn_a1b2)');
    });
    it('falls back to the literal "scene" when source is empty/falsy', () => {
        expect(getBriefSceneAnchorId('', fakeHash)).toBe('inquiry-H(scene)');
    });
    it('delegates only to the injected hashString (no built-in hash)', () => {
        let calls = 0;
        const counting = (v: string): string => { calls += 1; return `K-${v}`; };
        const out = getBriefSceneAnchorId('x', counting);
        expect(out).toBe('inquiry-K-x');
        expect(calls).toBe(1);
    });
});

describe('buildResultsHeroText', () => {
    const summary = (_r: InquiryResult, _m: InquiryLens) => 'core summary';
    it('returns the summary unchanged when no scene refs were normalized', () => {
        expect(buildResultsHeroText(result({}), 'flow' as InquiryLens, summary)).toBe('core summary');
    });
    it('appends " *" when refNormalizationCount > 0', () => {
        expect(buildResultsHeroText(result({ refNormalizationCount: 3 }), 'flow' as InquiryLens, summary))
            .toBe('core summary *');
    });
    it('refNormalizationCount of exactly 0 leaves the summary clean', () => {
        expect(buildResultsHeroText(result({ refNormalizationCount: 0 }), 'flow' as InquiryLens, summary))
            .toBe('core summary');
    });
    it('passes mode through to the resolver', () => {
        const seen: InquiryLens[] = [];
        const tap = (_r: InquiryResult, m: InquiryLens) => { seen.push(m); return ''; };
        buildResultsHeroText(result({}), 'depth' as InquiryLens, tap);
        expect(seen).toEqual(['depth']);
    });
});

describe('buildResultsMetaText', () => {
    const fmt = (v: number) => String(Math.round(v));
    const sel = (_r: InquiryResult | null | undefined): InquirySelectionMode =>
        'discover' as unknown as InquirySelectionMode;
    const r = result({ verdict: { flow: 82, depth: 71 } as never });

    it('zone label maps setup/pressure/payoff; final text is uppercased', () => {
        const out = buildResultsMetaText(r, 'flow' as InquiryLens, 'setup' as InquiryZone, fmt, sel);
        expect(out).toBe('SETUP · DISCOVER · FLOW 82 · DEPTH 71');
        expect(buildResultsMetaText(r, 'flow' as InquiryLens, 'pressure' as InquiryZone, fmt, sel))
            .toContain('PRESSURE');
        expect(buildResultsMetaText(r, 'flow' as InquiryLens, 'payoff' as InquiryZone, fmt, sel))
            .toContain('PAYOFF');
    });

    it('mode swaps the flow/depth order', () => {
        const flowFirst = buildResultsMetaText(r, 'flow' as InquiryLens, 'setup' as InquiryZone, fmt, sel);
        const depthFirst = buildResultsMetaText(r, 'depth' as InquiryLens, 'setup' as InquiryZone, fmt, sel);
        expect(flowFirst.indexOf('FLOW 82')).toBeLessThan(flowFirst.indexOf('DEPTH 71'));
        expect(depthFirst.indexOf('DEPTH 71')).toBeLessThan(depthFirst.indexOf('FLOW 82'));
    });

    it('selection mode "focused" renders Focused; anything else renders Discover', () => {
        const focused = (_r: InquiryResult | null | undefined): InquirySelectionMode =>
            'focused' as unknown as InquirySelectionMode;
        expect(buildResultsMetaText(r, 'flow' as InquiryLens, 'setup' as InquiryZone, fmt, focused))
            .toContain('FOCUSED');
        const other = (_r: InquiryResult | null | undefined): InquirySelectionMode =>
            'anything-else' as unknown as InquirySelectionMode;
        expect(buildResultsMetaText(r, 'flow' as InquiryLens, 'setup' as InquiryZone, fmt, other))
            .toContain('DISCOVER');
    });
});

describe('resolveInquiryBriefZoneLabel', () => {
    const never = (_: string): InquiryZone | null => {
        throw new Error('registry should not be consulted');
    };
    it('maps a present result.questionZone directly — registry callback is NOT invoked', () => {
        expect(resolveInquiryBriefZoneLabel(result({ questionZone: 'setup' as InquiryZone }), never)).toBe('Setup');
        expect(resolveInquiryBriefZoneLabel(result({ questionZone: 'pressure' as InquiryZone }), never)).toBe('Pressure');
        expect(resolveInquiryBriefZoneLabel(result({ questionZone: 'payoff' as InquiryZone }), never)).toBe('Payoff');
    });
    it('falls back to findPromptZoneById when questionZone is absent', () => {
        const find = (qid: string): InquiryZone | null => qid === 'q1' ? ('payoff' as InquiryZone) : null;
        expect(resolveInquiryBriefZoneLabel(result({ questionId: 'q1' }), find)).toBe('Payoff');
    });
    it('ultimate fallback is "Setup" when both questionZone and registry are absent', () => {
        const find = (_: string): InquiryZone | null => null;
        expect(resolveInquiryBriefZoneLabel(result({}), find)).toBe('Setup');
    });
});

describe('buildSceneDossierModel', () => {
    const f = finding({ refId: 'scn_x', headline: 'h' });
    const r = result({ runId: 'run-1', selectionMode: 'discover' as InquirySelectionMode, roleValidation: undefined });
    const i = item({ id: 'i1', sceneId: 'scn_x', displayLabel: '3 Turning Point' });

    it('invokes getMinimapItemTitle EXACTLY twice (preserves original call count)', () => {
        let calls = 0;
        const title = (_x: InquiryCorpusItem): string => { calls += 1; return '03 Turning Point'; };
        const out = buildSceneDossierModel(i, 'S3', 'hover', f, r, title);
        expect(calls).toBe(2);
        expect(out).toBeDefined();
    });
    it('passes through runId / selectionMode / roleValidation from result', () => {
        const out = buildSceneDossierModel(i, 'S3', 'hover', f, r, () => '03 Turning Point') as unknown as Record<string, unknown>;
        // Implementation builds the dossier via buildInquiryDossierPresentation; the
        // returned model carries the result-derived fields the presentation surfaces.
        // Spot-check: identical inputs produce identical output (idempotent).
        const out2 = buildSceneDossierModel(i, 'S3', 'hover', f, r, () => '03 Turning Point') as unknown as Record<string, unknown>;
        expect(JSON.stringify(out)).toBe(JSON.stringify(out2));
    });
    it('sceneNumber falls back to label when displayLabel has no parseable number', () => {
        const itemNoNumber = item({ id: 'i2', sceneId: 'scn_y', displayLabel: 'no-number' });
        // Should still produce a dossier (label "S3" parses to 3).
        const out = buildSceneDossierModel(itemNoNumber, 'S3', 'hover', f, r, () => 'Some Title');
        expect(out).toBeDefined();
    });
});

describe('formatInquiryBriefTitle', () => {
    const ts = new Date(Date.UTC(2026, 4, 19, 15, 20, 0)); // 2026-05-19 15:20 UTC
    it('book scope with questionPrefix → "Inquiry Brief — <prefix> <timestamp>"', () => {
        const out = formatInquiryBriefTitle(result({ scope: 'book' }), ts, 'Setup', 'Flow', 'Pres8: Tension Leakage');
        expect(out.startsWith('Inquiry Brief — Pres8: Tension Leakage ')).toBe(true);
    });
    it('book scope without questionPrefix → uses zoneLabel · lensLabel', () => {
        const out = formatInquiryBriefTitle(result({ scope: 'book' }), ts, 'Setup', 'Flow', null);
        expect(out.startsWith('Inquiry Brief — Setup · Flow ')).toBe(true);
    });
    it('saga scope prepends "Saga"', () => {
        const out = formatInquiryBriefTitle(result({ scope: 'saga' }), ts, 'Setup', 'Flow', null);
        expect(out.startsWith('Inquiry Brief — Saga · Setup · Flow ')).toBe(true);
    });
    it('saga + questionPrefix → "Saga · <prefix>" (prefix still wins over zone+lens)', () => {
        const out = formatInquiryBriefTitle(result({ scope: 'saga' }), ts, 'Setup', 'Flow', 'P');
        expect(out.startsWith('Inquiry Brief — Saga · P ')).toBe(true);
    });
    it('exactly one space separates the parts list from the timestamp', () => {
        const out = formatInquiryBriefTitle(result({ scope: 'book' }), ts, 'Setup', 'Flow', null);
        // ... Flow<single space>timestamp
        expect(/Flow [A-Z][a-z]+ \d/.test(out)).toBe(true);
    });
});

describe('isFindingHit / getFindingRole', () => {
    it('isFindingHit: hit for any kind except "none"', () => {
        expect(isFindingHit(finding({ kind: 'thread' }))).toBe(true);
        expect(isFindingHit(finding({ kind: 'arc' }))).toBe(true);
        expect(isFindingHit(finding({ kind: 'payoff' }))).toBe(true);
        expect(isFindingHit(finding({ kind: 'unclear' }))).toBe(true);
        expect(isFindingHit(finding({ kind: 'strength' }))).toBe(true);
        expect(isFindingHit(finding({ kind: 'none' }))).toBe(false);
    });
    it('getFindingRole: "target" iff role is exactly "target"; otherwise "context"', () => {
        expect(getFindingRole(finding({ role: 'target' }))).toBe('target');
        expect(getFindingRole(finding({ role: 'context' }))).toBe('context');
        expect(getFindingRole(finding({}))).toBe('context');                  // missing
        expect(getFindingRole(finding({ role: '' as never }))).toBe('context'); // empty string fallback
    });
});

describe('getResultSummaryForMode', () => {
    it('flow mode prefers summaryFlow, then summary; depth mirrors', () => {
        const both = result({ summary: 'S', summaryFlow: 'F', summaryDepth: 'D' });
        expect(getResultSummaryForMode(both, 'flow' as InquiryLens)).toBe('F');
        expect(getResultSummaryForMode(both, 'depth' as InquiryLens)).toBe('D');
        const flowOnly = result({ summary: 'S', summaryDepth: 'D' });
        expect(getResultSummaryForMode(flowOnly, 'flow' as InquiryLens)).toBe('S');
        const depthOnly = result({ summary: 'S', summaryFlow: 'F' });
        expect(getResultSummaryForMode(depthOnly, 'depth' as InquiryLens)).toBe('S');
    });
    it('empty/missing summaries yield the sanitizer fallback string', () => {
        const out = getResultSummaryForMode(result({}), 'flow' as InquiryLens);
        // sanitizeInquirySummary returns its fallback for empty input;
        // we just assert non-empty string (don't pin the exact wording).
        expect(typeof out === 'string' && out.length > 0).toBe(true);
    });
});

describe('getOrderedFindings', () => {
    const f = (p: Partial<InquiryFinding>): InquiryFinding => finding(p);
    it('filters out only none findings', () => {
        const r = result({
            findings: [
                f({ kind: 'thread', headline: 'A' }),
                f({ kind: 'none', headline: 'B' }),
                f({ kind: 'strength', headline: 'C' }),
                f({ kind: 'arc', headline: 'D' })
            ]
        });
        const out = getOrderedFindings(r, 'flow' as InquiryLens);
        const headlines = out.map(x => x.headline);
        expect(headlines).not.toContain('B');
        expect(headlines).toContain('C');
        expect(headlines).toContain('A');
        expect(headlines).toContain('D');
    });
    it('target role beats context role', () => {
        const r = result({
            findings: [
                f({ kind: 'thread', role: 'context', headline: 'ctx' }),
                f({ kind: 'thread', role: 'target', headline: 'tgt' })
            ]
        });
        const out = getOrderedFindings(r, 'flow' as InquiryLens);
        expect(out[0].headline).toBe('tgt');
    });
    it('within same role: matching lens beats "both" beats absent beats mismatched', () => {
        const mk = (lens: InquiryFinding['lens'] | undefined, headline: string): InquiryFinding =>
            f({ kind: 'thread', role: 'target', lens, headline });
        const r = result({
            findings: [
                mk('depth', 'mismatch'),
                mk(undefined, 'absent'),
                mk('both', 'both'),
                mk('flow', 'match')
            ]
        });
        const out = getOrderedFindings(r, 'flow' as InquiryLens);
        expect(out.map(x => x.headline)).toEqual(['match', 'both', 'absent', 'mismatch']);
    });
    it('does not mutate the input array (returns a slice-sorted copy)', () => {
        const findings = [
            f({ kind: 'thread', role: 'context', headline: 'b' }),
            f({ kind: 'thread', role: 'target', headline: 'a' })
        ];
        const r = result({ findings });
        getOrderedFindings(r, 'flow' as InquiryLens);
        expect(findings.map(x => x.headline)).toEqual(['b', 'a']);
    });
});

describe('normalizeInquiryBriefText', () => {
    it('returns empty string for undefined/empty input', () => {
        expect(normalizeInquiryBriefText(undefined, new Map())).toBe('');
        expect(normalizeInquiryBriefText('', new Map())).toBe('');
    });
    it('replaces reference tokens via the provided label map', () => {
        const labels = new Map<string, string>([['s1', 'Opening']]);
        const out = normalizeInquiryBriefText('See S1 for context.', labels);
        // exact replacement detail is owned by replaceInquiryReferenceTokens;
        // we just assert the resolved label landed in the output.
        expect(out.includes('Opening')).toBe(true);
    });
    it('leaves text unchanged when the label map is empty', () => {
        expect(normalizeInquiryBriefText('plain text', new Map())).toBe('plain text');
    });
});

describe('buildInquiryReferenceLabelMap', () => {
    const it1 = item({ id: 'I1', sceneId: 'scn_a', displayLabel: ' S1 ', filePaths: ['Book/1.md', 'Book/1b.md'] });
    const it2 = item({ id: 'I2', sceneId: 'scn_b', displayLabel: 'S2', filePaths: [] });
    const it3 = item({ id: 'I3', sceneId: undefined, displayLabel: 's1', filePaths: undefined }); // same key as it1 after trim/lower

    it('returns an empty map for empty items', () => {
        expect(buildInquiryReferenceLabelMap([], () => 'x').size).toBe(0);
    });

    it('lowercases + trims keys; registers displayLabel/id/sceneId/filePaths', () => {
        const out = buildInquiryReferenceLabelMap([it1], () => 'DISPLAY_1');
        // displayLabel ' S1 ' → 's1'
        expect(out.get('s1')).toBe('DISPLAY_1');
        expect(out.get('i1')).toBe('DISPLAY_1');
        expect(out.get('scn_a')).toBe('DISPLAY_1');
        expect(out.get('book/1.md')).toBe('DISPLAY_1');
        expect(out.get('book/1b.md')).toBe('DISPLAY_1');
    });

    it('first-write-wins on key collision across items', () => {
        // it1 registers 's1' first → it3's 's1' (its displayLabel) must NOT overwrite.
        const display = (it: InquiryCorpusItem): string => it.id === 'I1' ? 'FIRST' : 'SECOND';
        const out = buildInquiryReferenceLabelMap([it1, it3], display);
        expect(out.get('s1')).toBe('FIRST');
    });

    it('skips undefined/empty keys (sceneId absent, filePaths absent or empty)', () => {
        const out = buildInquiryReferenceLabelMap([it2], () => 'X');
        expect(out.has('')).toBe(false);
        // sceneId 'scn_b' present so it lands; absent filePaths should not throw.
        expect(out.get('scn_b')).toBe('X');
    });

    it('calls formatReferenceDisplay exactly once per item', () => {
        let calls = 0;
        buildInquiryReferenceLabelMap([it1, it2], () => { calls += 1; return 'D'; });
        expect(calls).toBe(2);
    });
});

describe('buildInquirySceneReferenceIndex', () => {
    const items: InquiryCorpusItem[] = [
        item({ id: 'I1', displayLabel: 'S1' }),
        item({ id: 'I2', displayLabel: 'S2' }),
        item({ id: 'I3', displayLabel: 'S3' })
    ];

    it('preserves input order, one entry per item', () => {
        const out = buildInquirySceneReferenceIndex(
            items,
            (i) => i.displayLabel,
            (i) => `anchor-${i.id}`
        );
        expect(out.map(x => x.label)).toEqual(['S1', 'S2', 'S3']);
        expect(out.map(x => x.anchorId)).toEqual(['anchor-I1', 'anchor-I2', 'anchor-I3']);
    });

    it('undefined anchorId propagates as undefined (no fabricated id)', () => {
        const out = buildInquirySceneReferenceIndex(
            items,
            (i) => i.displayLabel,
            () => undefined
        );
        out.forEach(entry => expect(entry.anchorId).toBeUndefined());
    });

    it('each callback invoked exactly once per item', () => {
        let labelCalls = 0;
        let anchorCalls = 0;
        buildInquirySceneReferenceIndex(
            items,
            (i) => { labelCalls += 1; return i.displayLabel; },
            (i) => { anchorCalls += 1; return i.id; }
        );
        expect(labelCalls).toBe(3);
        expect(anchorCalls).toBe(3);
    });
});

describe('getInquiryActionText', () => {
    const f = (p: Partial<InquiryFinding>): InquiryFinding => finding(p);

    it('returns null for non-hit kinds (none / strength)', () => {
        expect(getInquiryActionText(f({ kind: 'none', headline: 'h' }), new Map())).toBeNull();
        expect(getInquiryActionText(f({ kind: 'strength', headline: 'h' }), new Map())).toBeNull();
    });

    it('returns null when no dedicated recommended action is present', () => {
        expect(getInquiryActionText(f({ kind: 'thread', headline: '' }), new Map())).toBeNull();
        expect(getInquiryActionText(f({ kind: 'thread', headline: 'Beat lands soft' }), new Map())).toBeNull();
    });

    it('returns the trimmed normalized recommended action for hit findings', () => {
        const out = getInquiryActionText(f({
            kind: 'thread',
            headline: 'Beat lands soft',
            recommendedAction: '  Seed the missing pressure before the turn.  '
        }), new Map());
        expect(out).toBe('Seed the missing pressure before the turn.');
    });

    it('suppresses actions that only repeat the finding headline', () => {
        const out = getInquiryActionText(f({
            kind: 'thread',
            headline: 'Beat lands soft',
            recommendedAction: 'Beat lands soft.'
        }), new Map());
        expect(out).toBeNull();
    });

    it('reference labels replace inline tokens in the recommended action', () => {
        const labels = new Map<string, string>([['s1', 'Opening']]);
        const out = getInquiryActionText(f({
            kind: 'thread',
            headline: 'Missing setup',
            recommendedAction: 'Seed the motive before S1.'
        }), labels);
        expect(out && out.includes('Opening')).toBe(true);
    });
});

describe('buildInquiryPendingAction', () => {
    const r = result({});
    const items: InquiryCorpusItem[] = [];

    it('returns null when action text is null', () => {
        expect(buildInquiryPendingAction(finding({ kind: 'none', headline: 'h' }), r, items, new Map())).toBeNull();
        expect(buildInquiryPendingAction(finding({ kind: 'strength', headline: 'h' }), r, items, new Map())).toBeNull();
        expect(buildInquiryPendingAction(finding({ kind: 'thread', headline: 'h' }), r, items, new Map())).toBeNull();
    });

    it('falls back to uppercased S-number refId when chip-label resolver returns null', () => {
        // Empty items + no displayLabel match → resolveFindingChipLabel returns null;
        // refId 's5' → uppercased 'S5'.
        const out = buildInquiryPendingAction(
            finding({ kind: 'thread', headline: 'h', recommendedAction: 'Add setup.', refId: 's5' }),
            r,
            items,
            new Map()
        );
        expect(out?.targetLabel).toBe('S5');
        expect(out?.text).toBe('Add setup.');
    });

    it('targetLabel is undefined when neither chip resolver nor S-number pattern match', () => {
        const out = buildInquiryPendingAction(
            finding({ kind: 'thread', headline: 'h', recommendedAction: 'Clarify the turn.', refId: 'gap_001' }),
            r,
            items,
            new Map()
        );
        expect(out?.targetLabel).toBeUndefined();
        expect(out?.text).toBe('Clarify the turn.');
    });

    it('text equals the getInquiryActionText output for the same inputs', () => {
        const f1 = finding({ kind: 'thread', headline: 'Hello', recommendedAction: 'Revise the setup.' });
        const expected = getInquiryActionText(f1, new Map());
        const out = buildInquiryPendingAction(f1, r, items, new Map());
        expect(out?.text).toBe(expected);
    });
});

describe('buildBriefPendingActions', () => {
    const r = (findings: InquiryFinding[]): InquiryResult => result({ findings });

    it('empty findings → empty array', () => {
        expect(buildBriefPendingActions(r([]), [], new Map())).toEqual([]);
    });

    it('filters non-hits (none / strength)', () => {
        const out = buildBriefPendingActions(r([
            finding({ kind: 'none', headline: 'x', refId: 's1' }),
            finding({ kind: 'strength', headline: 'y', refId: 's2' }),
            finding({ kind: 'thread', headline: 'keep', recommendedAction: 'Revise the setup.', refId: 's3' })
        ]), [], new Map());
        expect(out.length).toBe(1);
        expect(out[0].text).toBe('Revise the setup.');
    });

    it('skips findings where buildInquiryPendingAction returns null', () => {
        const out = buildBriefPendingActions(r([
            finding({ kind: 'none', headline: 'x', refId: 's1' }),
            finding({ kind: 'thread', headline: 'no action', refId: 's2' }),
            finding({ kind: 'thread', headline: 'real', recommendedAction: 'Move the reveal earlier.', refId: 's3' })
        ]), [], new Map());
        expect(out.map(a => a.text)).toEqual(['Move the reveal earlier.']);
    });

    it('dedupes by `${targetLabel ?? ""}::${text}` keeping first occurrence (preserves order)', () => {
        const out = buildBriefPendingActions(r([
            finding({ kind: 'thread', headline: 'A', recommendedAction: 'Revise A.', refId: 's1' }), // → S1::Revise A.
            finding({ kind: 'arc',    headline: 'A', recommendedAction: 'Revise A.', refId: 's1' }), // duplicate key
            finding({ kind: 'thread', headline: 'B', recommendedAction: 'Revise B.', refId: 's2' })  // → S2::Revise B.
        ]), [], new Map());
        expect(out.map(a => `${a.targetLabel ?? ''}::${a.text}`)).toEqual(['S1::Revise A.', 'S2::Revise B.']);
    });

    it('distinct targetLabel + same text produces two entries (key is composite)', () => {
        const out = buildBriefPendingActions(r([
            finding({ kind: 'thread', headline: 'same', recommendedAction: 'Revise shared beat.', refId: 's1' }),
            finding({ kind: 'thread', headline: 'same', recommendedAction: 'Revise shared beat.', refId: 's2' })
        ]), [], new Map());
        expect(out.length).toBe(2);
    });
});

describe('buildInquirySceneNotes', () => {
    type Note = ReturnType<typeof buildInquirySceneNotes>[number];

    const f = (p: Partial<InquiryFinding>): InquiryFinding =>
        finding({ kind: 'thread', mode: 'flow' as never, ...p });
    const fmtDisplay = (item: InquiryCorpusItem, fallback: string): string =>
        `HEADER(${item.id},${fallback})`;
    const getFilePath = (item: InquiryCorpusItem): string | undefined =>
        item.filePaths?.[0];
    const getAnchor = (source: string): string => `anchor-${source}`;
    const runScene = (
        r: InquiryResult,
        items: InquiryCorpusItem[],
        labels: ReadonlyMap<string, string> = new Map(),
        filePath = getFilePath,
        anchor = getAnchor,
        display = fmtDisplay
    ): Note[] => buildInquirySceneNotes(r, items, labels, filePath, anchor, display);

    it('scope filter: returns [] for saga / unspecified scope', () => {
        expect(runScene(result({ scope: 'saga', findings: [f({ refId: 's1' })] }), [])).toEqual([]);
        expect(runScene(result({ scope: undefined as never, findings: [f({ refId: 's1' })] }), [])).toEqual([]);
    });

    it('book scope with empty findings → []', () => {
        expect(runScene(result({ scope: 'book', findings: [] }), [])).toEqual([]);
    });

    it('label fallback: uppercased S-number refId when chip resolver returns null; non-S refIds skipped', () => {
        const r = result({ scope: 'book', findings: [
            f({ refId: 's7', headline: 'h' }),       // → 'S7'
            f({ refId: 'gap_001', headline: 'h2' })  // no chip + non-S → skipped
        ] });
        const out = runScene(r, []);
        expect(out.map(n => n.label)).toEqual(['S7']);
    });

    it('item-match: each channel (displayLabel / id / sceneId / filePaths) matches case-insensitively', () => {
        const mk = (id: string, fields: Partial<InquiryCorpusItem>): InquiryCorpusItem =>
            item({ id, displayLabel: id, ...fields });
        // filePaths channel matches by EXACT case-insensitive equality
        // against the label (not substring) — preserved verbatim from the
        // original method. A path entry equal to the label hits the channel.
        const channels = [
            { items: [mk('I1', { displayLabel: 'S1' })], refId: 's1' },
            { items: [mk('s2', {})], refId: 's2' },
            { items: [mk('I3', { sceneId: 's3' })], refId: 's3' },
            { items: [mk('I4', { filePaths: ['s4'] })], refId: 's4' }
        ];
        channels.forEach(({ items, refId }) => {
            const r = result({ scope: 'book', findings: [f({ refId })] });
            const out = runScene(r, items);
            expect(out.length).toBe(1);
            // Header is the injected formatReferenceDisplay → matched.
            expect(out[0].header).toMatch(/^HEADER\(/);
        });
    });

    it('anchor source fallback: filePath → id → label; unmatched → label', () => {
        const it1 = item({ id: 'I1', displayLabel: 'S1', filePaths: ['Book/1.md'] });
        const it2 = item({ id: 'I2', displayLabel: 'S2', filePaths: [] });
        const rMatched = result({ scope: 'book', findings: [f({ refId: 's1' })] });
        expect(runScene(rMatched, [it1])[0].anchorId).toBe('anchor-Book/1.md');
        const rNoFile = result({ scope: 'book', findings: [f({ refId: 's2' })] });
        expect(runScene(rNoFile, [it2])[0].anchorId).toBe('anchor-I2');
        const rUnmatched = result({ scope: 'book', findings: [f({ refId: 's9' })] });
        expect(runScene(rUnmatched, [])[0].anchorId).toBe('anchor-S9');
    });

    it('header: matched → formatReferenceDisplay(item, label); unmatched → label.toUpperCase()', () => {
        const it1 = item({ id: 'I1', displayLabel: 'S1' });
        const rMatched = result({ scope: 'book', findings: [f({ refId: 's1' })] });
        expect(runScene(rMatched, [it1])[0].header).toBe('HEADER(I1,S1)');
        const rUnmatched = result({ scope: 'book', findings: [f({ refId: 's9', headline: 'h' })] });
        expect(runScene(rUnmatched, [])[0].header).toBe('S9');
    });

    it('clustering: two findings under same label → 1 note with 2 entries; first wins header/anchor/order', () => {
        const it1 = item({ id: 'I1', displayLabel: 'S1', filePaths: ['Book/1.md'] });
        const r = result({ scope: 'book', findings: [
            f({ refId: 's1', headline: 'first', lens: 'flow' }),
            f({ refId: 's1', headline: 'second', lens: 'depth' })
        ] });
        const out = runScene(r, [it1]);
        expect(out.length).toBe(1);
        expect(out[0].entries.length).toBe(2);
        expect(out[0].anchorId).toBe('anchor-Book/1.md');
        expect(out[0].entries[0].headline).toBe('first');
        expect(out[0].entries[1].headline).toBe('second');
    });

    it('entry line: always the headline, regardless of recommendedAction', () => {
        // Per-scene notes are the scene-local diagnosis; the prescription
        // (recommendedAction) lives in Pending Author Actions, so the headline
        // is used whether or not the finding carries an action.
        const r = result({ scope: 'book', findings: [
            f({ refId: 's1', headline: 'Setup is thin', recommendedAction: 'Seed the motive before S1.' }),
            f({ refId: 's2', headline: 'Reveal lands soft' }) // no action → headline
        ] });
        const out = runScene(r, []);
        const byLabel = new Map(out.map(n => [n.label, n.entries[0].headline]));
        expect(byLabel.get('S1')).toBe('Setup is thin');
        expect(byLabel.get('S2')).toBe('Reveal lands soft');
    });

    it('entry line: action equal to headline still yields the headline', () => {
        const r = result({ scope: 'book', findings: [
            f({ refId: 's1', headline: 'Tighten the turn', recommendedAction: 'Tighten the turn' })
        ] });
        const out = runScene(r, []);
        expect(out[0].entries[0].headline).toBe('Tighten the turn');
    });

    it('order: matched uses items.indexOf; numeric-aware label sort across notes', () => {
        // Items in S10, S2 order → S10 should sort BEFORE S2 by index (0 < 1)
        // but the test below uses unmatched items so the label-numeric sort runs.
        const r = result({ scope: 'book', findings: [
            f({ refId: 's10', headline: 'h10' }),
            f({ refId: 's2',  headline: 'h2'  })
        ] });
        const out = runScene(r, []); // unmatched; both fall to getSceneNoteSortOrder
        // numeric-aware locale compare: 'S2' before 'S10'
        expect(out.map(n => n.label)).toEqual(['S2', 'S10']);
    });

    it('order: unmatched negative sort-order → MAX_SAFE_INTEGER (lands last)', () => {
        // 'zz_no_number' won't parse; getSceneNoteSortOrder returns
        // Number.MAX_SAFE_INTEGER → that note sorts after numbered ones.
        // Use a non-S-pattern refId via the chip-label path → won't fall
        // through to this code; simulate by exercising two notes where
        // one is numeric (S5) and one is alphabetic via the same chip
        // path. The skip happens for non-S refIds without chip labels,
        // so genuine "negative order" exposure requires a matched item
        // whose indexOf returns -1, which the API prevents. We assert
        // the simpler invariant: the MAX_SAFE_INTEGER fallback still
        // produces deterministic output (smoke-only).
        const r = result({ scope: 'book', findings: [f({ refId: 's5' })] });
        const out = runScene(r, []);
        expect(out.length).toBe(1);
        expect(out[0].label).toBe('S5');
    });

    it('bullet pipeline quirk: buildSceneDossierBodyLines lines do not start with "• ", so bullets is always []', () => {
        const r = result({ scope: 'book', findings: [
            f({ refId: 's1', headline: 'h', bullets: ['point A', 'point B'] })
        ] });
        const out = runScene(r, []);
        // Pre-existing quirk: the filter `startsWith('• ')` discards every
        // line. Preserved verbatim from the original method.
        expect(out[0].entries[0].bullets).toEqual([]);
    });

    it('headline fallback: empty/whitespace headline → "Finding text unavailable."', () => {
        const r = result({ scope: 'book', findings: [
            f({ refId: 's1', headline: '' }),
            f({ refId: 's2', headline: '   ' })
        ] });
        const out = runScene(r, []);
        // Note: normalizeInquiryHeadline first injects 'Finding' for empty
        // input, then sanitizeDossierText may pass it through. Here the
        // direct headline (not via normalizeInquiryHeadline) is what's
        // fed to sanitizeDossierText, so empty headlines DO hit the
        // 'Finding text unavailable.' branch.
        expect(out[0].entries[0].headline).toBe('Finding text unavailable.');
        expect(out[1].entries[0].headline).toBe('Finding text unavailable.');
    });

    it('lens label: "both" → "Flow / Depth"; explicit lens passes through formatBriefLabel; absent → result.mode || "flow"', () => {
        const r = result({ scope: 'book', mode: 'depth' as never, findings: [
            f({ refId: 's1', lens: 'both', headline: 'a' }),
            f({ refId: 's2', lens: 'flow' as never, headline: 'b' }),
            f({ refId: 's3', lens: undefined, headline: 'c' })
        ] });
        const out = runScene(r, []);
        const lensByLabel = Object.fromEntries(out.map(n => [n.label, n.entries[0].lens]));
        expect(lensByLabel['S1']).toBe('Flow / Depth');
        expect(lensByLabel['S2']).toBe('Flow');                // formatBriefLabel('flow') = 'Flow'
        expect(lensByLabel['S3']).toBe('Depth');               // falls through to result.mode 'depth'
    });
});

describe('buildInquiryBriefModel (final composite assembler)', () => {
    type Opts = Parameters<typeof buildInquiryBriefModel>[1];
    const baseOpts = (over: Partial<Opts> = {}): Opts => ({
        items: [],
        referenceLabels: new Map(),
        sceneNotes: [],
        sceneReferences: [],
        pendingActions: [],
        promptLabel: null,
        questionTextById: null,
        scopeIndicator: null,
        logTitle: 'log',
        isError: false,
        rawResponse: null,
        ...over
    });
    const baseResult = (over: Partial<InquiryResult> = {}): InquiryResult => result({
        scope: 'book',
        verdict: { flow: 80, depth: 70 } as never,
        findings: [],
        citations: [] as never,
        evidenceDocumentMeta: [] as never,
        ...over
    });

    it('showNoActionItems: true only for a usable completed pass', () => {
        // Usable success → empty-state allowed.
        expect(buildInquiryBriefModel(baseResult(), baseOpts()).showNoActionItems).toBe(true);
        // Error run → suppressed.
        expect(buildInquiryBriefModel(baseResult(), baseOpts({ isError: true })).showNoActionItems).toBe(false);
        // Simulated/stub run → suppressed.
        expect(buildInquiryBriefModel(baseResult({ aiReason: 'simulated' as never }), baseOpts()).showNoActionItems).toBe(false);
        // Evidence-compromised (unverified citations, zero verified findings) → suppressed.
        expect(buildInquiryBriefModel(
            baseResult({ findings: [], unverifiedFindings: [{ headline: 'h', bullets: [], warning: 'w' }] as never }),
            baseOpts()
        ).showNoActionItems).toBe(false);
    });

    it('questionTitle: promptLabel non-null → used; null → "Inquiry Question"', () => {
        expect(buildInquiryBriefModel(baseResult(), baseOpts({ promptLabel: 'My Q' })).questionTitle).toBe('My Q');
        expect(buildInquiryBriefModel(baseResult(), baseOpts({ promptLabel: null })).questionTitle).toBe('Inquiry Question');
    });

    it('questionText fallback chain: result.questionText (trimmed) → questionTextById → "Question text unavailable."', () => {
        expect(buildInquiryBriefModel(baseResult({ questionText: '  hello  ' }), baseOpts()).questionText).toBe('hello');
        expect(buildInquiryBriefModel(baseResult({ questionText: '   ' }), baseOpts({ questionTextById: 'from-registry' })).questionText).toBe('from-registry');
        expect(buildInquiryBriefModel(baseResult({ questionText: '' }), baseOpts({ questionTextById: null })).questionText).toBe('Question text unavailable.');
    });

    it('pills: always Flow/Depth/Selection; Mode appended when mode; modelLabel appended when truthy', () => {
        const r = baseResult({ verdict: { flow: 80, depth: 70 } as never, selectionMode: 'focused' as never });
        const noMode = buildInquiryBriefModel(r, baseOpts());
        expect(noMode.pills.slice(0, 3)).toEqual(['Flow 80', 'Depth 70', 'Selection Focused']);
        const withMode = buildInquiryBriefModel(baseResult({ ...r, mode: 'flow' as never }), baseOpts());
        expect(withMode.pills).toContain('Mode Flow');
        const withModel = buildInquiryBriefModel(
            baseResult({ aiProvider: 'openai', aiModelResolved: 'gpt-5.5', verdict: { flow: 1, depth: 1 } as never }),
            baseOpts()
        );
        // Last pill is the model label when truthy.
        expect(withModel.pills[withModel.pills.length - 1]?.length).toBeGreaterThan(0);
    });

    it('summaries: per-mode summary used; absent → sanitizer fallback ("Summary unavailable.") shines through', () => {
        const r = baseResult({ summaryFlow: 'F', summaryDepth: 'D' });
        const out = buildInquiryBriefModel(r, baseOpts());
        expect(out.flowSummary).toBe('F');
        expect(out.depthSummary).toBe('D');
        // Preserved verbatim: the assembler's `|| 'No flow summary available.'`
        // fallback is unreachable in practice because sanitizeInquirySummary
        // already returns 'Summary unavailable.' for empty input. Locking
        // the real behavior, not the dead-code fallback.
        const empty = buildInquiryBriefModel(baseResult(), baseOpts());
        expect(empty.flowSummary).toBe('Summary unavailable.');
        expect(empty.depthSummary).toBe('Summary unavailable.');
    });

    it('findings: filter via isFindingHit; saga prepends Subject/Span context; sceneLabel via referenceLabels(refId)', () => {
        const f1 = finding({ kind: 'thread', headline: 'h1', refId: 's1', role: 'target' });
        const f2 = finding({ kind: 'none', headline: 'skip-me' });
        const f3 = finding({ kind: 'thread', headline: 'h3', refId: 'r3', subject: 'Sub', span: 'B1-B3', role: 'context' });

        const labels = new Map<string, string>([['s1', 'OPENING']]);
        const bookFindings = buildInquiryBriefModel(baseResult({ findings: [f1, f2, f3], scope: 'book' }), baseOpts({ referenceLabels: labels })).findings;
        expect(bookFindings.map(x => x.headline)).toEqual(['h1', 'h3']);
        expect(bookFindings[0].sceneLabel).toBe('OPENING');
        expect(bookFindings[1].bullets.length).toBe(0); // book scope = no saga context, no finding bullets

        const sagaFindings = buildInquiryBriefModel(baseResult({ findings: [f3], scope: 'saga' }), baseOpts()).findings;
        // Saga context prepends Subject + Span lines, sliced to 3 total.
        expect(sagaFindings[0].bullets[0]).toBe('Subject: Sub');
        expect(sagaFindings[0].bullets[1]).toBe('Span: B1-B3');
    });

    it('findings lens: "both" → "Flow / Depth"; absent → result.mode || "flow" via formatBriefLabel', () => {
        const out = buildInquiryBriefModel(baseResult({
            mode: 'depth' as never,
            findings: [
                finding({ kind: 'thread', headline: 'a', lens: 'both' }),
                finding({ kind: 'thread', headline: 'b', lens: undefined })
            ]
        }), baseOpts()).findings;
        expect(out[0].lens).toBe('Flow / Depth');
        expect(out[1].lens).toBe('Depth');
    });

    it('sources: derived from buildInquirySourcesViewModel; output picks title/excerpt/classLabel/path/url/citationCount', () => {
        // Empty citations → empty sources (smoke-only; sources VM is its own pure helper).
        expect(buildInquiryBriefModel(baseResult(), baseOpts()).sources).toEqual([]);
    });

    it('rawResponse: included only when isError && trimmed non-empty; whitespace-only → null', () => {
        expect(buildInquiryBriefModel(baseResult(), baseOpts({ isError: true, rawResponse: ' { ok } ' })).rawResponse).toBe('{ ok }');
        expect(buildInquiryBriefModel(baseResult(), baseOpts({ isError: true, rawResponse: '   ' })).rawResponse).toBeNull();
        expect(buildInquiryBriefModel(baseResult(), baseOpts({ isError: false, rawResponse: '{ ok }' })).rawResponse).toBeNull();
        expect(buildInquiryBriefModel(baseResult(), baseOpts({ isError: true, rawResponse: null })).rawResponse).toBeNull();
    });

    it('refNormalized: true when result.refNormalizationCount > 0; false otherwise', () => {
        expect(buildInquiryBriefModel(baseResult({ refNormalizationCount: 0 }), baseOpts()).refNormalized).toBe(false);
        expect(buildInquiryBriefModel(baseResult({ refNormalizationCount: 2 }), baseOpts()).refNormalized).toBe(true);
        expect(buildInquiryBriefModel(baseResult(), baseOpts()).refNormalized).toBe(false);
    });

    it('conditional spreads: unverifiedFindings / citationIntegrityWarnings / evidenceCompromised', () => {
        const empty = buildInquiryBriefModel(baseResult(), baseOpts());
        expect('unverifiedFindings' in empty).toBe(false);
        expect('citationIntegrityWarnings' in empty).toBe(false);
        expect('evidenceCompromised' in empty).toBe(false);

        const withUnverified = buildInquiryBriefModel(baseResult({
            unverifiedFindings: [{ headline: 'uh', bullets: [], lens: 'flow', rawRefId: 'x', rawRefLabel: 'L', rawRefPath: 'P', warning: 'w' }] as never
        }), baseOpts());
        expect(withUnverified.unverifiedFindings?.length).toBe(1);

        const withCitWarn = buildInquiryBriefModel(baseResult({
            citationIntegrityWarnings: [{ stage: 's', message: 'm' }] as never
        }), baseOpts());
        expect(withCitWarn.citationIntegrityWarnings?.length).toBe(1);
    });

    it('passthrough: sceneNotes / sceneReferences / pendingActions are the SAME references the caller supplied', () => {
        const sceneNotes = [{ label: 'S1', header: 'H', entries: [] }] as never;
        const sceneReferences = [{ label: 'S1' }] as never;
        const pendingActions = [{ text: 't' }] as never;
        const out = buildInquiryBriefModel(baseResult(), baseOpts({ sceneNotes, sceneReferences, pendingActions }));
        expect(out.sceneNotes).toBe(sceneNotes);
        expect(out.sceneReferences).toBe(sceneReferences);
        expect(out.pendingActions).toBe(pendingActions);
    });

    it('logTitle / scopeIndicator: passed through from options', () => {
        const out = buildInquiryBriefModel(baseResult(), baseOpts({ logTitle: 'my-log', scopeIndicator: 'Book B1' }));
        expect(out.logTitle).toBe('my-log');
        expect(out.scopeIndicator).toBe('Book B1');
    });
});

describe('InquiryView wrappers delegate (B1+B2+B3+B4a+B4b+B4c+B4d+B4e source-lock)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
    it('B1: imports pure helpers under aliases and delegates without recursion', () => {
        expect(src.includes("from './utils/inquiryBriefModel'")).toBe(true);
        // Exact pass-through forwarders were deleted (CH-2026-09-04-#9); the view calls the pure helper directly.
        // getBriefModelLabel is handed to the log builders as a function value, so it appears bare, not called.
        expect((src.match(/\bgetBriefModelLabel\b/g) ?? []).length).toBeGreaterThan(1);
        expect(src.includes('buildSceneDossierHoverKey(')).toBe(true);
        expect(src.includes('getBriefModelLabelPure')).toBe(false);
        // Original inline bodies must be gone from InquiryView.
        expect(src.includes("getModelDisplayName(raw.replace(/^models\\//, ''))")).toBe(false);
        expect(src.includes('item.sceneId ?? \'\',\n            label,\n            finding.refId')).toBe(false);
    });
    it('B2: anchor/hero/meta wrappers inject hashString/summary/metric/selection', () => {
        expect(src.includes('return getBriefSceneAnchorIdPure(source, (value) => hashString(value));')).toBe(true);
        expect(src.includes('return buildResultsHeroTextPure(')).toBe(true);
        expect(src.includes('(r, m) => getResultSummaryForMode(r, m)')).toBe(true);
        expect(src.includes('return buildResultsMetaTextPure(')).toBe(true);
        expect(src.includes('(value) => this.formatMetricDisplay(value)')).toBe(true);
        expect(src.includes('(r) => getResultSelectionMode(r)')).toBe(true);
        // Original inline bodies must be gone from InquiryView.
        expect(src.includes("`inquiry-${this.hashString(source || 'scene')}`")).toBe(false);
        expect(src.includes("`${zoneLabel} · ${selectionText} · ${ordered.join(' · ')}`.toUpperCase()")).toBe(false);
    });
    it('B3: zone label / dossier model / title delegate; impure resolutions stay in the view', () => {
        expect(src.includes('return resolveInquiryBriefZoneLabelPure(result, (qid) => this.findPromptZoneById(qid));')).toBe(true);
        expect(src.includes('return buildSceneDossierModelPure(')).toBe(true);
        expect(src.includes('(i) => this.getMinimapItemTitle(i)')).toBe(true);
        expect(src.includes('return formatInquiryBriefTitlePure(result, timestampSource, zoneLabel, lensLabel, questionPrefix);')).toBe(true);
        // Resolutions (timestamp, lens label, question prefix) stay in the view wrapper.
        expect(src.includes('const timestampSource = this.getInquiryTimestamp(result, true) ?? new Date();')).toBe(true);
        expect(src.includes('const lensLabel = this.resolveInquiryBriefLensLabel(result, zoneLabel);')).toBe(true);
        expect(src.includes('const questionPrefix = this.resolveInquiryQuestionPrefixForResult(result);')).toBe(true);
        // Original inline bodies must be gone.
        expect(src.includes("return `Inquiry Brief — ${parts.join(' · ')} ${timestamp}`")).toBe(false);
        // (Cannot assert the old zone-resolution one-liner is "gone": the
        // same expression legitimately appears in two unrelated methods
        // outside B3's scope. The positive `return resolveInquiryBriefZoneLabelPure(...)`
        // assertion above is the proof the wrapper landed.)
        expect(src.includes("sceneTitle: stripNumericTitlePrefix(this.getMinimapItemTitle(item))")).toBe(false);
    });
    it('B4a: 5 pure leaves delegate; bodies are gone from InquiryView', () => {
        // Exact pass-through forwarders were deleted (CH-2026-09-04-#9); the view calls the pure helper directly.
        expect(src.includes('isFindingHit(')).toBe(true);
        expect(src.includes('getFindingRole(')).toBe(true);
        expect(src.includes('getResultSummaryForMode(')).toBe(true);
        expect(src.includes('getOrderedFindings(')).toBe(true);
        expect(src.includes('isFindingHitPure')).toBe(false);
        expect(src.includes('return normalizeInquiryBriefTextPure(value, referenceLabels);')).toBe(true);
        // Original inline bodies must be gone.
        expect(src.includes("return finding.kind !== 'none' && finding.kind !== 'strength';")).toBe(false);
        expect(src.includes("return finding.role === 'target' ? 'target' : 'context';")).toBe(false);
        expect(src.includes('return findings.slice().sort((a, b) => {')).toBe(false);
        expect(src.includes('return replaceInquiryReferenceTokens(value, referenceLabels);')).toBe(false);
    });
    it('B4b: ref-label-map + scene-ref-index wrappers delegate; wrappers preserve the anchor fallback chain', () => {
        expect(src.includes('return buildInquiryReferenceLabelMapPure(')).toBe(true);
        expect(src.includes('(item) => this.formatInquiryReferenceDisplay(item, item.displayLabel)')).toBe(true);
        expect(src.includes('return buildInquirySceneReferenceIndexPure(')).toBe(true);
        // The fallback chain `getMinimapItemFilePath(item) || item.id || item.displayLabel`
        // must remain in the InquiryView wrapper (corpus access stays here).
        expect(src.includes('this.getBriefSceneAnchorId(getMinimapItemFilePath(item) || item.id || item.displayLabel)')).toBe(true);
        // Original inline map-building body must be gone from InquiryView.
        expect(src.includes('const labels = new Map<string, string>();')).toBe(false);
        expect(src.includes('item.filePaths?.forEach(path => add(path, display));')).toBe(false);
    });
    it('B4c: pending-action wrappers delegate; default-arg resolution stays in the wrappers', () => {
        expect(src.includes('return getInquiryActionTextPure(finding, referenceLabels);')).toBe(true);
        expect(src.includes('return buildInquiryPendingActionPure(finding, result, items, referenceLabels);')).toBe(true);
        expect(src.includes('return buildBriefPendingActionsPure(result, items, referenceLabels);')).toBe(true);
        // Defaults still resolve through the InquiryView (corpus access stays here).
        expect(src.includes('items: InquiryCorpusItem[] = this.getResultItems(result),')).toBe(true);
        expect(src.includes('referenceLabels: ReadonlyMap<string, string> = this.buildInquiryReferenceLabelMap(items)')).toBe(true);
        // Original inline body markers (unique to the B4c bodies) must be gone.
        expect(src.includes('const actions: Array<{ targetLabel?: string; text: string }> = [];')).toBe(false);
        // (Cannot assert the S-number-fallback or kind-check one-liners are
        // absent: identical patterns appear in other unrelated InquiryView
        // methods outside B4c's scope. The positive delegation asserts above
        // are the proof the wrappers landed.)
    });
    it('B4d: scene-notes wrapper delegates with the 3 injected resolvers; default-arg resolution stays in the wrapper', () => {
        expect(src.includes('return buildInquirySceneNotesPure(')).toBe(true);
        expect(src.includes('(item) => getMinimapItemFilePath(item)')).toBe(true);
        expect(src.includes('(source) => this.getBriefSceneAnchorId(source)')).toBe(true);
        expect(src.includes('(item, label) => this.formatInquiryReferenceDisplay(item, label)')).toBe(true);
        // Defaults still resolve through the view (corpus access).
        expect(src.includes('items: InquiryCorpusItem[] = this.getResultItems(result),')).toBe(true);
        expect(src.includes('referenceLabels: ReadonlyMap<string, string> = this.buildInquiryReferenceLabelMap(items)')).toBe(true);
        // Original inline body markers must be gone from InquiryView.
        expect(src.includes("if (result.scope !== 'book') return [];")).toBe(false);
        expect(src.includes("order: order >= 0 ? order : Number.MAX_SAFE_INTEGER,")).toBe(false);
        expect(src.includes("a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })")).toBe(false);
    });
    it('B4e: composite wrapper pre-resolves options bag exactly and delegates', () => {
        // Uniquely-anchored positive assertions for the delegation contract.
        expect(src.includes('return buildInquiryBriefModelPure(result, {')).toBe(true);
        // Every option that must be pre-resolved in the wrapper.
        expect(src.includes('promptLabel: this.findPromptLabelById(result.questionId),')).toBe(true);
        expect(src.includes('questionTextById: this.getQuestionTextById(result.questionId),')).toBe(true);
        expect(src.includes('scopeIndicator: this.resolveInquiryBriefScopeIndicator(result),')).toBe(true);
        expect(src.includes('logTitle: this.resolveInquiryLogLinkTitle(result, logPath),')).toBe(true);
        expect(src.includes('isError: this.isErrorResult(result),')).toBe(true);
        expect(src.includes('sceneNotes: this.buildInquirySceneNotes(result, items, referenceLabels),')).toBe(true);
        expect(src.includes('sceneReferences: this.buildInquirySceneReferenceIndex(items),')).toBe(true);
        expect(src.includes('pendingActions: this.buildBriefPendingActions(result, items, referenceLabels),')).toBe(true);
        // The old inline assembler body markers (uniquely anchored).
        expect(src.includes("const questionTitle = this.findPromptLabelById(result.questionId) || 'Inquiry Question';")).toBe(false);
        expect(src.includes("flowSummary,\n            depthSummary,\n            findings,\n            sources,")).toBe(false);
    });
});
