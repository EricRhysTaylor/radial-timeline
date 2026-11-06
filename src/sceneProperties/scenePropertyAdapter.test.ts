import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
    buildScenePropertyDefinitions,
    isValidPropertyName,
    newAdvancedEntry,
    parseAdvancedEntries,
    serializeAdvancedEntries,
    serializeAdvancedSceneProperties,
    withEntryKey,
    withEntryValue,
} from './scenePropertyAdapter';

describe('scenePropertyAdapter', () => {
    it('derives core and advanced scene properties from legacy settings', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            sceneYamlTemplates: {
                base: 'Class: Scene\nAct: 1\nWhen: 2026-01-01\nPulse Update:\nSummary Update:\nTotal Time:',
                advanced: 'Place: Somewhere\nQuestions:\nReader Emotion: Curious',
            },
            hoverMetadataFields: [
                { key: 'Place', label: 'Place', icon: 'map-pinned', enabled: true },
            ],
        };

        const definitions = buildScenePropertyDefinitions(settings);

        expect(definitions.core.map((definition) => definition.key)).toEqual([
            'Class',
            'Act',
            'When',
            'Pulse Update',
            'Summary Update',
            'Total Time',
        ]);
        expect(definitions.advanced.map((definition) => definition.key)).toEqual([
            'Place',
            'Questions',
            'Reader Emotion',
        ]);
        expect(definitions.advanced[0].revealInHover).toBe(true);
        expect(definitions.advanced[0].hoverIcon).toBe('map-pinned');
    });

    it('serializes advanced properties back into legacy template and preserves unmatched hover metadata', () => {
        const serialized = serializeAdvancedSceneProperties(
            [
                {
                    key: 'Place',
                    defaultValue: 'Somewhere',
                    required: false,
                    source: 'advanced',
                    revealInHover: true,
                    hoverIcon: 'map-pinned',
                    hoverLabel: 'Place',
                },
                {
                    key: 'Questions',
                    defaultValue: ['Who', 'Why'],
                    required: false,
                    source: 'advanced',
                    revealInHover: false,
                    hoverLabel: 'Questions',
                },
            ],
            [
                { key: 'Legacy', label: 'Legacy', icon: 'box', enabled: true },
                { key: 'Place', label: 'Place', icon: 'align-left', enabled: false },
            ]
        );

        expect(serialized.advancedTemplate).toBe(
            'Place: Somewhere\nQuestions:\n  - Who\n  - Why'
        );
        expect(serialized.hoverMetadataFields).toEqual([
            { key: 'Place', label: 'Place', icon: 'map-pinned', enabled: true },
            { key: 'Questions', label: 'Questions', icon: 'align-vertical-space-around', enabled: false },
            { key: 'Legacy', label: 'Legacy', icon: 'box', enabled: true },
        ]);
    });
});

describe('Advanced editor rows', () => {
    it('row handlers read the live list, so a value edit survives the next action', () => {
        const code = readFileSync(resolve(process.cwd(), 'src/settings/sections/scene/ScenePropertiesSection.ts'), 'utf8');
        expect(code).toContain('const renderEntryRow = (entry: AdvancedTemplateEntry, idx: number) => {');
        expect(code).not.toMatch(/\[\.\.\.(?:list|data)\b/);
    });
    const template = 'Place:\n{{PlaceList}}\nQuestions:   # Analysis Block\nTime References: []\n場所: 東京';

    it('writes untouched rows back byte for byte', () => {
        expect(serializeAdvancedEntries(parseAdvancedEntries(template))).toBe(template);
    });
    it('keeps the other rows exact when one row changes', () => {
        const entries = parseAdvancedEntries(template);
        entries[3] = withEntryValue(entries[3], 'Kyoto');
        expect(serializeAdvancedEntries(entries)).toBe('Place:\n{{PlaceList}}\nQuestions:   # Analysis Block\nTime References: []\n場所: Kyoto');
    });
    it('writes any typed value as valid YAML', () => {
        const entry = newAdvancedEntry('Mood', 'tense: very # really');
        expect(parse(entry.lines)).toEqual({ Mood: 'tense: very # really' });
        expect(parse(withEntryValue(entry, ['a: b', 'c']).lines)).toEqual({ Mood: ['a: b', 'c'] });
    });
    it('renames a row without losing its comment', () => {
        const [, questions] = parseAdvancedEntries(template);
        expect(withEntryKey(questions, 'Queries').lines).toBe('Queries:   # Analysis Block');
    });
    it('a bad legacy value does not blank the other rows', () => {
        const entries = parseAdvancedEntries('Mood: hopeful\nNote: a: b');
        expect(entries[0].value).toBe('hopeful');
        expect(entries[1].lines).toBe('Note: a: b');
    });
    it('accepts names in any language and refuses names YAML would misread', () => {
        for (const name of ['Place', '場所', 'Émotion', "Author's Note"]) expect(isValidPropertyName(name)).toBe(true);
        for (const name of ['a: b', '#tag', '- item', '[x]', '{{Place}}']) expect(isValidPropertyName(name)).toBe(false);
    });
});
