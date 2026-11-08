import { describe, expect, it } from 'vitest';
import { renderActLabels } from './ActLabels';
import { renderMonthSpokesAndInnerLabels } from './MonthSpokes';
import { renderCenterGrid } from './Grid';

/*
 * The timeline is one SVG string parsed by DOMParser. One unescaped "&" or "<"
 * in a writer's text (a saga book titled "Pride & Prejudice") makes the whole
 * document fail to parse, and the view draws nothing. Every component that
 * writes a writer's text must escape it.
 */

const HOSTILE = `Pride & Prejudice <Vol. "One"> 'Two'`;

/** What DOMParser needs from this markup: no bare "&", and no "<" or unquoted text inside an attribute value. */
function wellFormedProblems(markup: string): string[] {
    const problems: string[] = [];
    const bareAmp = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g;
    if (bareAmp.test(markup)) problems.push('bare &');
    for (const attr of markup.matchAll(/=\s*"([^"]*)"/g)) {
        if (attr[1].includes('<')) problems.push(`< in attribute: ${attr[1]}`);
    }
    // Text between tags must not open a tag that is not markup ("<Vol.").
    for (const tag of markup.matchAll(/<([^\s/>!?]+)/g)) {
        if (!/^[a-zA-Z][\w:-]*$/.test(tag[1])) problems.push(`stray <${tag[1]}`);
    }
    return problems;
}

describe('writer text in the timeline SVG', () => {
    it('escapes a saga book title or act label with &, < and quotes', () => {
        const svg = renderActLabels({ numActs: 2, actLabels: [HOSTILE, 'Act Two'], outerMostOuterRadius: 790, actLabelOffset: 0, maxStageColor: 'currentColor' });
        expect(wellFormedProblems(svg)).toEqual([]);
        expect(svg).toContain('Pride &amp; Prejudice &lt;Vol. &quot;One&quot;&gt; &apos;Two&apos;</textPath>');
    });

    it('escapes month names and the scene names in their tooltips', () => {
        const months = Array.from({ length: 12 }, (_, index) => ({ name: index === 0 ? HOSTILE : `Month ${index}`, shortName: index === 0 ? HOSTILE : `M${index}`, angle: (index / 12) * 2 * Math.PI - Math.PI / 2 }));
        const svg = renderMonthSpokesAndInnerLabels({
            months,
            lineInnerRadius: 200,
            lineOuterRadius: 220,
            currentMonthIndex: 0,
            monthlyCompletedCounts: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            monthlyCompletedSceneNames: [[HOSTILE], [], [], [], [], [], [], [], [], [], [], []],
        });
        expect(wellFormedProblems(svg)).toEqual([]);
        expect(svg).toContain('Pride &amp; Prejudice');
    });

    it('escapes scene names in the center grid tooltips', () => {
        const svg = renderCenterGrid({
            statusesForGrid: ['Todo'],
            stagesForGrid: ['Zero'],
            gridCounts: { Zero: { Todo: 1 } },
            gridSceneNames: { Zero: { Todo: [HOSTILE] } },
            gridStageStates: {},
            isBookComplete: false,
            PUBLISH_STAGE_COLORS: { Zero: 'currentColor' },
            currentYearLabel: '2026',
            estimatedTotalScenes: 1,
            totalRuntimeSeconds: 0,
            startXGrid: 0, startYGrid: 0, cellWidth: 20, cellHeight: 20, cellGapX: 2, cellGapY: 2, headerY: -10,
            stageTooltips: { Zero: 'Zero "draft" & more' },
            statusTooltips: { Todo: 'To <do>' },
        } as Parameters<typeof renderCenterGrid>[0]);
        expect(wellFormedProblems(svg)).toEqual([]);
        expect(svg).toContain('Pride &amp; Prejudice');
    });

    it('catches the markup that made the saga blank', () => {
        expect(wellFormedProblems('<textPath href="#a">Pride & Prejudice</textPath>')).toEqual(['bare &']);
    });
});
