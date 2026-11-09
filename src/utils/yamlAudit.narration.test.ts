import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { RadialTimelineSettings } from '../types/settings';
import { formatSemanticWarningReason, getSemanticWarningType, runYamlAudit } from './yamlAudit';

const NARRATION_WARNING = 'Narration not recognized';

const auditScene = async (frontmatter: Record<string, unknown>, settings: RadialTimelineSettings = DEFAULT_SETTINGS) => {
    const file = { path: 'Book/1 Scene.md', basename: '1 Scene' } as TFile;
    const app = { metadataCache: { getFileCache: () => ({ frontmatter }) } } as unknown as App;
    const result = await runYamlAudit({ app, settings, noteType: 'Scene', files: [file] });
    return (result.notes[0]?.semanticWarnings ?? [])
        .filter(warning => getSemanticWarningType(warning) === NARRATION_WARNING);
};

describe('scene properties check: Narration values', () => {
    it('flags a character name and says what the timeline does instead', async () => {
        const warnings = await auditScene({ Class: 'Scene', Narration: 'Dr. Watson' });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('"Dr. Watson"');
        expect(warnings[0]).toContain("uses the book's narration");
        expect(warnings[0]).toContain('first, third, or omni');
        expect(formatSemanticWarningReason(warnings)).toBe('Narration: Dr. Watson');
    });

    it('flags a list of names that holds no narration value', async () => {
        const warnings = await auditScene({ Class: 'Scene', Narration: ['Holmes', 'Watson'] });
        expect(warnings).toHaveLength(1);
        expect(formatSemanticWarningReason(warnings)).toBe('Narration: Holmes, Watson');
    });

    it.each([
        'first', '1st', 'second', 'you', 'third', '3rd', 'limited', 'omni', 'omniscient', 'objective', 'narrator',
        'third person limited', 'close third', 'First Person',
        'two', 'all', 'count', '3',
    ])('leaves %s alone', async (value) => {
        expect(await auditScene({ Class: 'Scene', Narration: value })).toEqual([]);
    });

    it('leaves a numeric count alone', async () => {
        expect(await auditScene({ Class: 'Scene', Narration: 2 })).toEqual([]);
    });

    it.each([
        ['empty text', ''],
        ['whitespace', '   '],
        ['null', null],
        ['an empty list', []],
    ])('leaves an empty Narration (%s) alone: the scene follows its book', async (_label, value) => {
        expect(await auditScene({ Class: 'Scene', Narration: value })).toEqual([]);
    });

    it('leaves a scene without Narration alone', async () => {
        expect(await auditScene({ Class: 'Scene' })).toEqual([]);
    });

    it('follows the author\'s custom name for Narration', async () => {
        const settings: RadialTimelineSettings = {
            ...DEFAULT_SETTINGS,
            enableCustomMetadataMapping: true,
            frontmatterMappings: { Voice: 'Narration' },
        };
        const flagged = await auditScene({ Class: 'Scene', Voice: 'Dr. Watson' }, settings);
        expect(flagged).toHaveLength(1);
        expect(formatSemanticWarningReason(flagged)).toBe('Narration: Dr. Watson');
        expect(await auditScene({ Class: 'Scene', Voice: 'close third' }, settings)).toEqual([]);
    });
});
