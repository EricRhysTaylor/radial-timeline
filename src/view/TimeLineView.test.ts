import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs'; // SAFE: test-only source guard reads TimeLineView for layer-order regression coverage.
import { resolve } from 'path'; // SAFE: test-only source guard resolves a repo-local file path.

describe('RadialTimelineView search lifecycle', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/view/TimeLineView.ts'), 'utf8');
    const onClose = source.match(/async onClose\(\): Promise<void> \{[\s\S]+?\n    \}/)?.[0] ?? '';

    it('only clears search when the last timeline closes', () => {
        // Search state is global. Closing one timeline while another is open
        // used to wipe the surviving view's results, leaving it with
        // highlighted squares and a term in the box that the state no longer
        // agreed with.
        expect(onClose).toContain('const otherTimelineViews = this.plugin.getTimelineViews().filter(view => view !== this);');
        expect(onClose).toContain('if (otherTimelineViews.length === 0) {');
        expect(onClose).toContain('this.plugin.abandonSearch();');
    });

    it('routes view-close clearing through the service, never the state object', () => {
        // Only the service can invalidate the in-flight run token; resetting
        // searchState here would let a search still in flight commit into the
        // state that was just cleared.
        expect(onClose).not.toContain('searchState.active = false');
        expect(onClose).not.toContain('searchState.hits =');
        expect(onClose).not.toContain('searchState.term =');
    });

    it('filters the render pipeline with the same predicate search uses', () => {
        // Two derivations of "what the timeline draws" would drift, and a
        // search match with nowhere to show itself reads as a broken search.
        expect(source).toContain('sceneData.filter(item => isRenderedOnTimeline(item))');
        expect(source).not.toContain('sceneData.filter(item => !isMatterNote(item))');
    });
});

describe('RadialTimelineView layer ordering', () => {
    it('keeps the writing-session ring behind Gossamer score text and hover meta text', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/view/TimeLineView.ts'), 'utf8');
        const fn = source.match(/private updateWritingSessionRing\([\s\S]+?\n    public focusTimelineSearchInput/)?.[0] ?? '';
        expect(source).toContain("console.warn('[WritingSession] Failed to render session ring overlay.'");
        expect(fn).toContain("this.currentMode === 'gossamer'");
        expect(fn).toContain('const firstAnchor = this.resolveWritingSessionRingAnchor(timelineRoot);');
        expect(fn).toContain("['.rt-gossamer-layer', '.rt-scene-info']");
        expect(fn).toContain('timelineRoot.querySelector(selector)');
        expect(fn).toContain('anchor.parentElement !== timelineRoot');
        expect(fn).toContain('timelineRoot.insertBefore(imported, firstAnchor);');
        expect(fn).not.toContain('Node.DOCUMENT_POSITION');
        expect(fn.indexOf('const firstAnchor = this.resolveWritingSessionRingAnchor(timelineRoot);')).toBeLessThan(
            fn.indexOf('timelineRoot.insertBefore(imported, firstAnchor);')
        );
        expect(fn.indexOf('timelineRoot.insertBefore(imported, firstAnchor);')).toBeLessThan(
            fn.indexOf('timelineRoot.appendChild(imported);')
        );
    });
});
