import { describe, expect, it } from 'vitest';
import { TFile, TFolder, normalizePath } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import {
    buildUsageCostBreakdown,
    countContentLogFiles,
    formatActualUsageCost,
    formatCacheStatusLine,
    formatSummaryLogContent,
    formatTokenUsageLine,
    formatUsageCostBreakdownLines,
    resolveContentLogRoots,
    resolveContentLogsRoot,
    resolveLogsRoot,
    resolveRecoverSnapshotsRoot
} from './log';

function makeFolder(path: string, children: Array<TFile | TFolder> = []): TFolder {
    const folder = new TFolder(path) as TFolder & { children: Array<TFile | TFolder> };
    folder.children = children;
    return folder;
}

function makePluginWithVaultFiles(roots: Array<TFile | TFolder>): RadialTimelinePlugin {
    const byPath = new Map<string, TFile | TFolder>();
    const visit = (file: TFile | TFolder): void => {
        byPath.set(normalizePath(file.path), file);
        if (file instanceof TFolder) {
            for (const child of (file as TFolder & { children?: Array<TFile | TFolder> }).children ?? []) {
                visit(child);
            }
        }
    };
    roots.forEach(visit);
    return {
        app: {
            vault: {
                getAbstractFileByPath: (path: string) => byPath.get(normalizePath(path)) ?? null
            }
        }
    } as unknown as RadialTimelinePlugin;
}

describe('log roots', () => {
    it('resolves the shared concise log root', () => {
        expect(resolveLogsRoot()).toBe('Radial Timeline/Logs');
    });

    it('resolves the shared content log root', () => {
        expect(resolveContentLogsRoot()).toBe('Radial Timeline/Logs/Content');
    });

    it('resolves all content log roots shown by the settings aggregate', () => {
        expect(resolveContentLogRoots()).toEqual([
            'Radial Timeline/Logs/Content',
            'Radial Timeline/Logs/Inquiry/Content',
            'Radial Timeline/Logs/Gossamer/Content',
            'Radial Timeline/Logs/Pulse/Content'
        ]);
    });

    // Renamed from resolveSnapshotsLogsRoot (folder-taxonomy cleanup, Tier 1
    // P1): the resolved path is byte-identical to the pre-rename value —
    // Snapshots lives under Recover, never under Logs.
    it('resolves the recover snapshots root, unchanged by the rename', () => {
        expect(resolveRecoverSnapshotsRoot()).toBe('Radial Timeline/Recover/Snapshots');
    });
});

describe('countContentLogFiles', () => {
    it('counts markdown files recursively in the legacy shared content folder', () => {
        const legacyRoot = makeFolder('Radial Timeline/Logs/Content', [
            new TFile('Radial Timeline/Logs/Content/root.md'),
            new TFile('Radial Timeline/Logs/Content/ignore.json'),
            makeFolder('Radial Timeline/Logs/Content/Nested', [
                new TFile('Radial Timeline/Logs/Content/Nested/nested.md')
            ])
        ]);

        expect(countContentLogFiles(makePluginWithVaultFiles([legacyRoot]))).toBe(2);
    });

    it('aggregates current feature content folders', () => {
        const inquiryRoot = makeFolder('Radial Timeline/Logs/Inquiry/Content', [
            new TFile('Radial Timeline/Logs/Inquiry/Content/inquiry.md')
        ]);
        const gossamerRoot = makeFolder('Radial Timeline/Logs/Gossamer/Content', [
            new TFile('Radial Timeline/Logs/Gossamer/Content/gossamer.md')
        ]);
        const pulseRoot = makeFolder('Radial Timeline/Logs/Pulse/Content', [
            new TFile('Radial Timeline/Logs/Pulse/Content/pulse.md')
        ]);

        expect(countContentLogFiles(makePluginWithVaultFiles([inquiryRoot, gossamerRoot, pulseRoot]))).toBe(3);
    });
});

describe('buildUsageCostBreakdown', () => {
    it('builds a cache-aware Anthropic cost breakdown from aggregated usage', () => {
        const breakdown = buildUsageCostBreakdown('anthropic', 'claude-opus-4-8', {
            inputTokens: 185_581,
            outputTokens: 18_523,
            rawInputTokens: 53_581,
            cacheReadInputTokens: 120_000,
            cacheCreationInputTokens: 12_000,
            cacheCreation5mInputTokens: 10_000,
            cacheCreation1hInputTokens: 2_000
        });

        // Token tallies pass through unchanged.
        expect(breakdown?.inputTokens).toBe(185_581);
        expect(breakdown?.outputTokens).toBe(18_523);
        expect(breakdown?.rawInputTokens).toBe(53_581);
        expect(breakdown?.cacheReadInputTokens).toBe(120_000);
        expect(breakdown?.cacheCreationInputTokens).toBe(12_000);
        expect(breakdown?.cacheCreation5mInputTokens).toBe(10_000);
        expect(breakdown?.cacheCreation1hInputTokens).toBe(2_000);

        // Cost shape (pricing-table independent): every component is
        // non-negative and the total covers input + output.
        expect(breakdown?.rawInputCostUSD).toBeGreaterThan(0);
        expect(breakdown?.cacheReadCostUSD).toBeGreaterThan(0);
        expect(breakdown?.cacheCreationCostUSD).toBeGreaterThan(0);
        expect(breakdown?.inputCostUSD).toBeGreaterThanOrEqual(
            (breakdown?.rawInputCostUSD ?? 0) + (breakdown?.cacheReadCostUSD ?? 0)
        );
        expect(breakdown?.outputCostUSD).toBeGreaterThan(0);
        expect(breakdown?.totalCostUSD).toBeCloseTo(
            (breakdown?.inputCostUSD ?? 0) + (breakdown?.outputCostUSD ?? 0),
            6
        );
    });

    it('formats readable cost breakdown log lines', () => {
        const lines = formatUsageCostBreakdownLines('anthropic', 'claude-opus-4-8', {
            inputTokens: 185_581,
            outputTokens: 18_523,
            rawInputTokens: 53_581,
            cacheReadInputTokens: 120_000,
            cacheCreationInputTokens: 12_000,
            cacheCreation5mInputTokens: 10_000,
            cacheCreation1hInputTokens: 2_000
        }, {
            executionInputTokens: 185_581,
            expectedOutputTokens: 18_523,
            expectedPasses: 1
        });

        // Token-shape lines are deterministic regardless of pricing.
        expect(lines).toContain('## Cost Breakdown');
        expect(lines).toContain('- Billed input total: ~185,581 tokens');
        expect(lines).toContain('- Raw input: ~53,581 tokens');
        expect(lines).toContain('- Cache read: ~120,000 tokens');
        expect(lines).toContain('- Cache write: ~12,000 tokens');
        expect(lines).toContain('- Output: ~18,523 tokens');

        // Dollar lines exist with a dollar prefix; exact values are
        // pricing-table driven and intentionally not pinned.
        expect(lines.some(l => /^- Estimated fresh: \$\d+(\.\d+)?$/.test(l))).toBe(true);
        expect(lines.some(l => /^- Estimated cached: \$\d+(\.\d+)?$/.test(l))).toBe(true);
        expect(lines.some(l => /^- Actual usage cost: \$\d+(\.\d+)?$/.test(l))).toBe(true);
        expect(lines).toContain('## Cost Accuracy');
        expect(lines.some(l => /^- Delta: -?\d+(\.\d+)?%$/.test(l))).toBe(true);
    });

    it('uses the fresh estimate for cost accuracy when Anthropic created cache but did not hit it', () => {
        const lines = formatUsageCostBreakdownLines('anthropic', 'claude-opus-4-8', {
            inputTokens: 307_895,
            outputTokens: 3_165,
            rawInputTokens: 26,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 307_869
        }, {
            executionInputTokens: 307_895,
            expectedOutputTokens: 3_165,
            expectedPasses: 1
        });

        const estimatedFreshLine = lines.find(line => line.startsWith('- Estimated fresh: '));
        const estimatedCachedLine = lines.find(line => line.startsWith('- Estimated cached: '));
        const estimatedLine = lines.find(line => line.startsWith('- Estimated: '));
        expect(estimatedFreshLine).toBeTruthy();
        expect(estimatedCachedLine).toBeTruthy();
        expect(estimatedLine).toBe(estimatedFreshLine?.replace('- Estimated fresh: ', '- Estimated: '));
        expect(lines.some(line => line.startsWith('- Actual usage cost: $'))).toBe(true);
    });

    it('surfaces the separately-billed Gemini cache storage charge when a TTL is supplied', () => {
        const ttlSeconds = 900; // 15m window
        const storedTokens = 140_000;
        const lines = formatUsageCostBreakdownLines('google', 'gemini-3.5-flash', {
            inputTokens: 140_000,
            outputTokens: 7_000,
            rawInputTokens: 0,
            cacheReadInputTokens: storedTokens
        }, {
            executionInputTokens: 140_000,
            expectedOutputTokens: 7_000,
            expectedPasses: 1
        }, 'created', ttlSeconds);

        const storageLine = lines.find(line => line.startsWith('- Cache storage (billed separately): '));
        expect(storageLine).toBeTruthy();
        // 140k tokens × $1.00/1M/hr × 0.25h = $0.035 (rounded by formatExactUsdCost).
        expect(storageLine).toContain('$0.035');
        expect(storageLine).toContain('held for 15m');
        expect(storageLine).toContain('$1.00/1M/hr');
        expect(lines.some(line => line.includes('NOT included in "Actual usage cost"'))).toBe(true);
    });

    it('omits the cache storage line when no TTL is supplied', () => {
        const lines = formatUsageCostBreakdownLines('google', 'gemini-3.5-flash', {
            inputTokens: 140_000,
            outputTokens: 7_000,
            cacheReadInputTokens: 140_000
        }, {
            executionInputTokens: 140_000,
            expectedOutputTokens: 7_000,
            expectedPasses: 1
        }, 'created');

        expect(lines.some(line => line.startsWith('- Cache storage'))).toBe(false);
    });

    it('omits cost accuracy when actual cost is unavailable', () => {
        const lines = formatUsageCostBreakdownLines('anthropic', 'claude-opus-4-8', {
            outputTokens: 10_000
        }, {
            executionInputTokens: 100_000,
            expectedOutputTokens: 10_000,
            expectedPasses: 1
        });

        expect(lines).toContain('## Cost Breakdown');
        expect(lines).toContain('- Billed input total: unavailable');
        expect(lines).toContain('- Raw input: unavailable');
        expect(lines).toContain('- Actual usage cost: unavailable');
        expect(lines).not.toContain('## Cost Accuracy');
    });

    it('returns no log lines when pricing is unavailable', () => {
        const lines = formatUsageCostBreakdownLines('openai', 'missing-model', {
            inputTokens: 100_000,
            outputTokens: 10_000
        }, {
            executionInputTokens: 100_000,
            expectedOutputTokens: 10_000,
            expectedPasses: 1
        });

        expect(lines).toEqual([]);
    });

    it('formats actual usage cost for run summaries without estimate data', () => {
        const cost = formatActualUsageCost('google', 'gemini-3.1-pro-preview', {
            inputTokens: 264_612,
            outputTokens: 3_402,
            totalTokens: 268_014,
            cacheReadInputTokens: 264_584
        });

        // Format is `$N.NNN` (3 decimals). Exact value depends on pricing.
        expect(cost).toMatch(/^\$\d+(\.\d{1,3})?$/);
    });

    it('includes actual usage cost in concise summary logs', () => {
        const content = formatSummaryLogContent({
            title: 'Inquiry Summary',
            feature: 'Inquiry',
            scopeTarget: 'Saga · Σ',
            provider: 'Google',
            modelRequested: 'gemini-3.1-pro-preview',
            modelResolved: 'gemini-3.1-pro-preview',
            submittedAt: new Date('2026-05-05T15:00:00.000Z'),
            returnedAt: new Date('2026-05-05T15:00:38.000Z'),
            durationMs: 38_000,
            status: 'success',
            tokenUsage: {
                inputTokens: 264_612,
                outputTokens: 3_402,
                totalTokens: 268_014,
                cacheReadInputTokens: 264_584
            },
            retryAttempts: 0,
            resultSummary: 'Completed successfully.',
            contentLogWritten: true
        });

        expect(content).toMatch(/- Actual usage cost: \$\d+(\.\d{1,3})?/);
    });
});

describe('cache provenance log lines', () => {
    it('appends cache read/write to the token usage line only when present', () => {
        expect(formatTokenUsageLine({ inputTokens: 1000, outputTokens: 50, totalTokens: 1050 }))
            .toBe('input=1000, output=50, total=1050');
        expect(formatTokenUsageLine({
            inputTokens: 239854, outputTokens: 1449, totalTokens: 241303,
            cacheReadInputTokens: 238400, rawInputTokens: 1454
        })).toBe('input=239854, output=1449, total=241303, cache read=238400');
        expect(formatTokenUsageLine(null)).toBe('not available');
    });

    it('reports HIT with the reused-input percentage', () => {
        const line = formatCacheStatusLine({
            inputTokens: 239854, cacheReadInputTokens: 238400
        });
        expect(line).toContain('HIT');
        expect(line).toContain('99%');
    });

    it('reports CREATED on a cache-write run (falling back to the 5m/1h split)', () => {
        expect(formatCacheStatusLine({ inputTokens: 239874, cacheCreation5mInputTokens: 238000 }))
            .toContain('CREATED');
    });

    it('reports none when the provider neither read nor wrote a cache', () => {
        expect(formatCacheStatusLine({ inputTokens: 1000, outputTokens: 50 }))
            .toContain('none');
    });
});
