import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../types';
import { readBeatPurposeSecondary } from '../../synopsis/SynopsisData';
import { buildBeatHoverLines } from './SynopsisBuilder';

const beatWith = (overrides: Partial<TimelineItem>): TimelineItem =>
    ({ date: '', path: 'Story/75 Break into Three.md', title: '75 Break into Three', itemType: 'Beat', ...overrides } as TimelineItem);

const PURPOSE = 'The protagonist has an epiphany or receives crucial information that provides a solution.';
const IN_THIS_BOOK = 'Shail starts the intercontinental tourney; Trisan is coming apart over exam prep.';

describe('buildBeatHoverLines', () => {
    it('leads with the in-book line and demotes the generic Purpose beneath it', () => {
        const lines = buildBeatHoverLines(beatWith({ Purpose: PURPOSE, 'In This Book': IN_THIS_BOOK }));
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe(IN_THIS_BOOK);
        expect(readBeatPurposeSecondary(lines[0])).toBeNull();
        expect(readBeatPurposeSecondary(lines[1])).toBe(PURPOSE);
    });

    it('keeps Purpose as the lead line when the author has not written one', () => {
        expect(buildBeatHoverLines(beatWith({ Purpose: PURPOSE }))).toEqual([PURPOSE]);
    });

    it('shows the in-book line alone when the beat has no Purpose', () => {
        expect(buildBeatHoverLines(beatWith({ 'In This Book': IN_THIS_BOOK }))).toEqual([IN_THIS_BOOK]);
        expect(buildBeatHoverLines(beatWith({}))).toEqual([]);
    });
});

describe('beat purpose mark survives entity decoding', () => {
    // In Obsidian, decodeHtmlEntities parses each line as HTML and keeps only
    // its text, which strips the mark. Tests run without DOMParser, so only a
    // source guard can catch the renderer reading the mark from the decoded
    // line — where it would silently never match.
    it('SynopsisManager reads the mark from the raw content line', () => {
        const source = readFileSync(new URL('../../SynopsisManager.ts', import.meta.url), 'utf8');
        expect(source).toContain('readBeatPurposeSecondary(contentLines[i])');
        expect(source).not.toMatch(/readBeatPurposeSecondary\((lineContent|decodedContentLines)/);
    });
});
