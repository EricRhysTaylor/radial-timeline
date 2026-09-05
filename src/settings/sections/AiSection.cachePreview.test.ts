import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('AI settings cache preview signals', () => {
    it('renders provider-cache preview pills and cache-ready certificate copy as active signals', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        expect(source.includes("/^Reuse\\s*·\\s*Provider cache$/i.test(label)")).toBe(true);
        expect(source.includes("extraCls: 'ert-ai-pill--active'")).toBe(true);
        expect(source.includes("extraPills.push({ text: 'Cache · Ready', extraCls: 'ert-ai-pill--active' });")).toBe(false);
        expect(source.includes("extraPills.push({ text: 'Cache · Warm hit', extraCls: 'ert-ai-pill--active' });")).toBe(false);
        // DOCTRINE: only payload-proven 'warm' may show success/TTL copy.
        // 'Cache ready …' (derived from an unproven cacheWindowExpiresAt) is
        // a fabrication and must not exist in the source.
        expect(source.includes('Warm cache confirmed for current corpus')).toBe(true);
        expect(source.includes('Cache ready for current corpus')).toBe(false);
        expect(source.includes('Cache ready on last Inquiry corpus')).toBe(false);
        expect(source.includes("cacheSession?.cacheReuseState === 'warm'")).toBe(true);
        // formatPreviewCacheObservedLabel template literal moved into aiSettingsPreview.ts.
        const previewSource = readFileSync(resolve(process.cwd(), 'src/settings/sections/aiSettingsPreview.ts'), 'utf8');
        expect(previewSource.includes('Observed cache hit ·')).toBe(true);
    });

    it('renders a distinct "Cache armed" branch when the cache was created (not reused) — matches the AI Engine popover', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/AiSection.ts'), 'utf8');
        // Pin: the armed branch sits between warm-confirmed and the
        // default "completed" state. Triggered by providerCacheStatus
        // === 'created' (cache-manager truth, NOT inferred from payload
        // alone) with a still-open TTL.
        expect(source.includes("cacheSession?.providerCacheStatus === 'created'")).toBe(true);
        // Pin: the status text uses "Cache armed" wording (matches the
        // AI Engine popover). The remaining-time label is appended only when
        // the cache is payload-proven (see proof gate below).
        expect(source.includes('Cache armed for next run on current corpus')).toBe(true);
        expect(source.includes('Cache armed on last Inquiry corpus')).toBe(true);
        // Pin: the armed/warm branches flag `cacheArmed: true`; the assembler
        // turns that into exactly ONE cache pill labelled "Cache armed",
        // otherwise "Provider cache supported". No per-branch pill injection.
        expect(source.includes('cacheArmed: true')).toBe(true);
        expect(source.includes("certificate.cacheArmed ? 'Cache armed' : CACHE_ARMED_PILL_TEXT")).toBe(true);
        // Doctrine: the armed branch is NOT a fabrication — it's
        // gated on providerCacheStatus from the cache manager, not on
        // cacheWindowExpiresAt alone.
        expect(/Cache armed[\s\S]+?providerCacheStatus === 'created'|providerCacheStatus === 'created'[\s\S]+?Cache armed/.test(source)).toBe(true);
        // HONEST COUNTDOWN: a numeric remaining-time is only appended when the
        // provider payload proves a cache exists (cache_read/cache_creation
        // tokens > 0). OpenAI never reports cache-creation tokens, so a primed
        // run with cached_tokens=0 shows the armed state with NO countdown.
        expect(source.includes('const cacheProven = !!cacheUsage')).toBe(true);
        expect(source.includes('const provenCacheRemainingLabel = cacheProven ? cacheRemainingLabel : null;')).toBe(true);
        expect(source.includes('const armedTimeSuffix = provenCacheRemainingLabel ? ` • ${provenCacheRemainingLabel}` : \'\';')).toBe(true);
    });
});
