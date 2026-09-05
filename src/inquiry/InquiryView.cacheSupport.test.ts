import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('InquiryView OpenAI cache support', () => {
    it('persists OpenAI cache windows and exposes persisted eligible reuse context', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        // resolveCacheWindowExpiry is untouched (chunk 3b explicitly excludes it).
        expect(viewSource.includes("if (trace?.cacheReuseState !== 'eligible' && trace?.cacheReuseState !== 'warm') return null;")).toBe(true);
        // R1 chunk 3b: persisted-reuse mapping moved to the pure module;
        // InquiryView keeps engine + sessionStore lookup then delegates.
        // The provider-mismatch + reuseState derivation now live there and
        // are characterized by inquiryCacheStatus.test.ts.
        expect(viewSource.includes('return mapSessionToPersistedReuseContextPure(session, engine.provider, engine.modelLabel, Date.now());')).toBe(true);
        const statusSource = readFileSync(resolve(process.cwd(), 'src/inquiry/engine/inquiryCacheStatus.ts'), 'utf8');
        expect(statusSource.includes("session.result.aiProvider?.trim().toLowerCase() !== provider")).toBe(true);
        expect(statusSource.includes("const reuseState = session.cacheReuseState === 'warm'")).toBe(true);
        expect(statusSource.includes("? 'eligible'")).toBe(true);
    });

    it('renders the minimap cache overlay as a solid green indicator instead of the plaid hatch', () => {
        const minimapSource = readFileSync(resolve(process.cwd(), 'src/inquiry/minimap/InquiryMinimapRenderer.ts'), 'utf8');
        const cssSource = readFileSync(resolve(process.cwd(), 'src/styles/inquiry.css'), 'utf8');
        expect(minimapSource.includes('const CACHE_STUB_PX = 8;')).toBe(true);
        expect(cssSource.includes('fill: color-mix(in srgb, var(--ert-inquiry-ai-success) 92%, #dfffe7 8%);')).toBe(true);
        expect(cssSource.includes('fill: url(#ert-inquiry-minimap-cached-hatch);')).toBe(false);
    });
});
