import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Source-grep regression guard for the cross-cutting invariant:
 * "No key is a capability limit, not an error." Every alert/red surface in the
 * Inquiry view must EXCLUDE isInquiryApiKeyMissing() so a keyless (demo) vault
 * stays calm. See docs/engineering/standards/inquiry-critical-path-rules.md §12.
 *
 * These sites have different alert conditions by design and are intentionally
 * NOT unified into one presentation value (that would change behaviour or merely
 * relocate four conditions). This guard pins the one shared invariant instead.
 */
describe('Inquiry: no-key is calm, not an error (invariant guard)', () => {
    const raw = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
    // Strip comments (so docstring mentions don't trip the test), then collapse
    // whitespace so multi-line conditions match as single strings.
    const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/\s+/g, ' ');

    it('a displayed briefing wins over no-api-key (results resolved before no-api-key)', () => {
        const resultsIdx = code.indexOf("return 'results'");
        const noKeyIdx = code.indexOf("return 'no-api-key'");
        expect(resultsIdx).toBeGreaterThan(-1);
        expect(noKeyIdx).toBeGreaterThan(-1);
        expect(resultsIdx).toBeLessThan(noKeyIdx);
    });

    it('ring alert is misconfiguration-only, never run-disabled (which includes no key)', () => {
        expect(code).toContain("const ringAlert = this.guidanceState === 'not-configured' || this.guidanceState === 'no-scenes'");
        expect(code).not.toContain('ringOverrideColor = this.isInquiryRunDisabled()');
    });

    it('engine badge pulse excludes no-key', () => {
        expect(code).toMatch(/readiness\.state === 'blocked'\) && !this\.isInquiryApiKeyMissing\(\)/);
    });

    it('minimap flow gauge resets when no key', () => {
        expect(code).toContain('readinessUi.pending || this.isInquiryApiKeyMissing()');
    });

    it('engine readiness strip calm state is driven by no-key, not demo-only', () => {
        expect(code).toContain('readOnlyNoKey: this.isInquiryApiKeyMissing()');
    });
});
