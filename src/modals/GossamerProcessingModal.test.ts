import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('GossamerProcessingModal progress UX', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modals/GossamerProcessingModal.ts'), 'utf8');

    it('uses one shared runtime and captures manuscript size when the request starts', () => {
        expect(source).toContain('this.plugin.settings.gossamerLastRunTiming');
        expect(source).toContain('this.apiCallManuscriptWords = this.manuscriptInfo?.totalWords');
        expect(source).toContain('estimateGossamerRunMs(');
        expect(source).not.toContain('gossamerLastRunMsBySignal');
    });

    it('allows the estimated bar to fill before the results are saved', () => {
        expect(source).toContain('startPercent: 0');
        expect(source).toContain('maxPercent: 100');
        expect(source).toContain('jitter: 0');
        expect(source).toContain('completeOnDuration: true');
        const received = source.slice(source.indexOf('public apiCallSuccess()'), source.indexOf('private async persistLastRunDuration'));
        expect(received).not.toContain('progressSimulator.complete()');
        expect(received).not.toContain("'100%'");
        const saved = source.slice(source.indexOf('public completeProcessing('), source.indexOf('public showRateLimitWarning('));
        expect(saved).toContain('progressSimulator.complete()');
    });

    it('does not use manuscript-size heuristics for the progress bar', () => {
        expect(source).not.toContain('tokenSeconds');
        expect(source).not.toContain('sceneSeconds');
        expect(source).not.toContain('beatSeconds');
    });
});

describe('GossamerProcessingModal error presentation', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modals/GossamerProcessingModal.ts'), 'utf8');

    it('renders errors as one icon-led paragraph instead of separate lines', () => {
        expect(source).toContain('setIcon(icon, \'alert-triangle\')');
        expect(source).toContain('ert-gossamer-proc-error-summary');
        expect(source).toContain('ert-gossamer-proc-error-copy');
        expect(source).toContain('this.errorMessages');
        expect(source).not.toContain('ert-gossamer-proc-error-item');
    });
});

describe('GossamerProcessingModal corpus tokens stat — TokenEstimate contract', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modals/GossamerProcessingModal.ts'), 'utf8');

    it('routes the Corpus Tokens stat through formatTokenShorthand (no raw .toLocaleString fallback)', () => {
        expect(source).toContain("formatTokenShorthand(info.estimatedTokens)");
        // The old raw render path is gone — it would have rendered ~0
        // when an upstream change produced 0 or unavailable.
        expect(source).not.toContain('`~${info.estimatedTokens.toLocaleString()}`');
    });

    it('declares ManuscriptInfo.estimatedTokens as the canonical TokenEstimate union', () => {
        expect(source).toContain("estimatedTokens: TokenEstimate;");
        expect(source).toContain("import { formatTokenShorthand, type TokenEstimate } from '../ai/estimates'");
    });
});

describe('formatTokenShorthand — invariant when surfacing as Corpus Tokens', () => {
    // Behavioral guard: the canonical formatter must never render a fake
    // number when the source is unavailable/pending. Re-asserted here at
    // the modal layer so a regression in the formatter would surface as
    // a Gossamer-modal test failure too.
    it('renders em-dash (not ~0) for unavailable', async () => {
        const { formatTokenShorthand } = await import('../ai/estimates');
        const rendered = formatTokenShorthand({ source: 'unavailable' });
        expect(rendered).toBe('—');
        expect(rendered).not.toBe('~0');
        expect(rendered).not.toBe('~0k');
    });

    it('renders em-dash (not ~0) for pending', async () => {
        const { formatTokenShorthand } = await import('../ai/estimates');
        const rendered = formatTokenShorthand({ source: 'pending' });
        expect(rendered).toBe('—');
        expect(rendered).not.toBe('~0');
        expect(rendered).not.toBe('~0k');
    });
});
