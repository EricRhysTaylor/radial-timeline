import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import {
    isValidPropertyName,
    newAdvancedEntry,
    parseAdvancedEntries,
    serializeAdvancedEntries,
    withEntryKey,
    withEntryValue,
} from '../sceneProperties/scenePropertyAdapter';
import { addSceneIntakeTemplate } from '../timetable/sceneIntakeTemplate';
import { formatYamlField, yamlScalar } from './frontmatterText';
import { generateSceneContent, type SceneCreationData } from './sceneGenerator';
import { removeTemplateFields, splitTemplateFields } from './templateMerge';
import { extractKeysInOrder } from './yamlTemplateNormalize';

/** Text YAML would read as something else if written plain. */
const AWKWARD_VALUES = [
    '1e3', '1E3', '1.5e-3', '0x10', '0o17', '.5', '5.', '+5', '-5', '12', '1.5', '.inf', '-.INF', '.nan', '.NaN',
    'true', 'True', 'FALSE', 'null', 'Null', 'NULL', '~', 'yes', 'No', 'on', 'OFF',
    'a: b', 'a:', ':a', 'a #b', '#a', '- a', '-', '? a', '[a]', '{a}', '{{Mood}}', '*a', '&a', '!a', '|', '>', '%a', '@a', '`a',
    '"a"', "'a'", 'say "hi"', "it's", 'back\\slash', 'tab\there', ' lead', 'trail ', 'line\nbreak', '場所: 東京', 'Émotion #1',
];
const PLAIN_VALUES = ['Main Plot', '2085-05-10 09:30', '2085-05-10', 'Ann', 'http://x.y/z', '1 hour', 'Zero', '東京'];
const data: SceneCreationData = { act: 2, when: '', sceneNumber: 1, subplots: [], character: '', place: '' };

describe('text reads back exactly as it was typed', () => {
    it.each(AWKWARD_VALUES)('as a value: %j', value => {
        expect(parse(`k: ${yamlScalar(value)}`)).toEqual({ k: value });
        expect(parse(formatYamlField('k', value))).toEqual({ k: value });
        expect(parse(formatYamlField('k', [value, 'x']))).toEqual({ k: [value, 'x'] });
    });
    it.each(PLAIN_VALUES)('stays plain when it can: %j', value => {
        expect(yamlScalar(value)).toBe(value);
    });
    it.each(AWKWARD_VALUES)('through the Advanced editor: %j', value => {
        const [entry] = parseAdvancedEntries(serializeAdvancedEntries([newAdvancedEntry('Mood', value)]));
        expect(entry.key).toBe('Mood');
        expect(parse(entry.lines)).toEqual({ Mood: value });
    });
});

describe('the editor shows a placeholder default however it is quoted', () => {
    it.each(['Where: "{{When}}"', "Where: '{{When}}'", 'Where: {{When}}'])('%s', lines => {
        const [entry] = parseAdvancedEntries(lines);
        expect(entry.value).toBe('{{When}}');
        expect(entry.lines).toBe(lines);
    });
    it('keeps a longer quoted value readable', () => {
        expect(parseAdvancedEntries('Note: "At {{Place}} now"')[0].value).toBe('At {{Place}} now');
    });
    it('reads a list of placeholders', () => {
        expect(parseAdvancedEntries('Places:\n  - "{{Place}}"\n  - {{Place}}')[0].value).toEqual(['{{Place}}', '{{Place}}']);
    });
});

describe('every accepted property name survives', () => {
    const NAMES = ['123', '1.5', '1e3', '0x10', 'true', 'null', 'yes', '~1', 'Place', '場所', 'Émotion', "Author's Note", 'a"b', '!mark', '%done', '@who'];

    it.each(NAMES)('%j reopens in the editor and saves again', key => {
        expect(isValidPropertyName(key)).toBe(true);
        const template = serializeAdvancedEntries([newAdvancedEntry('Before', ''), newAdvancedEntry(key, 'v'), newAdvancedEntry('After', '')]);
        expect(extractKeysInOrder(template)).toEqual(['Before', key, 'After']);
        const entries = parseAdvancedEntries(template);
        expect(entries.map(entry => entry.key)).toEqual(['Before', key, 'After']);
        expect(entries[1].value).toBe('v');
        entries[1] = withEntryValue(entries[1], 'w');
        expect(parse(serializeAdvancedEntries(entries))).toEqual({ Before: null, [key]: 'w', After: null });
    });
    it.each(NAMES)('%j can be renamed to and from without touching its value', key => {
        const renamed = withEntryKey(newAdvancedEntry('Old', 'v'), key);
        expect(parse(renamed.lines)).toEqual({ [key]: 'v' });
        expect(parse(withEntryKey(parseAdvancedEntries(renamed.lines)[0], 'New').lines)).toEqual({ New: 'v' });
    });
    it.each(NAMES)('%j reaches a dropped note', key => {
        const advanced = serializeAdvancedEntries([newAdvancedEntry(key, 'v')]);
        const settings = { ...DEFAULT_SETTINGS, sceneYamlTemplates: { base: 'Class: Scene', advanced } };
        const result = parse(addSceneIntakeTemplate('---\nClass: Scene\n---\n\nBody', settings).split('---')[1]) as Record<string, unknown>;
        expect(result[key]).toBe('v');
        const again = parse(addSceneIntakeTemplate(`---\nClass: Scene\n${formatYamlField(key, 'mine')}\n---\n\nBody`, settings).split('---')[1]) as Record<string, unknown>;
        expect(again[key]).toBe('mine');
    });
    it('reads quoted names in both styles, and removes them by name', () => {
        const template = `"123": a\n'it''s': b\n"say \\"hi\\"": c\nPlace:`;
        expect(extractKeysInOrder(template)).toEqual(['123', "it's", 'say "hi"', 'Place']);
        expect(removeTemplateFields(template, ['123'])).not.toContain('123');
        expect(splitTemplateFields(template)[0]).toMatchObject({ key: '123', lines: '"123": a' });
    });
    it.each(['a: b', '#tag', '- item', '[x]', '{{Place}}', 'x{{Place}}', '', ' ', 'a #b'])('refuses %j', key => {
        expect(isValidPropertyName(key)).toBe(false);
    });
});

describe('placeholders in any quoting style give valid YAML', () => {
    const place = 'City: "North" #1';
    const filled = (template: string, input: Partial<SceneCreationData> = {}) => parse(generateSceneContent(template, { ...data, place, ...input }));

    it('double quotes', () => expect(filled('Place: "{{Place}}"')).toEqual({ Place: place }));
    it('single quotes', () => expect(filled("Place: '{{Place}}'")).toEqual({ Place: place }));
    it('single quotes with an apostrophe', () => expect(filled("Place: '{{Place}}'", { place: "O'Hara's" })).toEqual({ Place: "O'Hara's" }));
    it('no quotes', () => expect(filled('Place: {{Place}}')).toEqual({ Place: place }));
    it('inside a longer quoted value', () => expect(filled('Note: "At {{Place}} now"')).toEqual({ Note: `At ${place} now` }));
    it('inside a longer plain value', () => expect(filled('Note: At {{Place}} now')).toEqual({ Note: `At ${place} now` }));
    it('before a comment', () => expect(filled('Place: "{{Place}}" # where\nNote: {{Place}}   # also')).toEqual({ Place: place, Note: place }));
    it('in a list item', () => expect(filled('Places:\n  - {{Place}}\n  - "{{Place}}"')).toEqual({ Places: [place, place] }));
    it('in a flow list', () => expect(filled('Places: [{{Place}}, "{{Place}}"]')).toEqual({ Places: [place, place] }));
    it('in a block value', () => expect(filled('Note: |\n  At {{Place}}\nAct: {{Act}}')).toEqual({ Note: `At ${place}\n`, Act: 2 }));
    it('several values inside quotes', () => expect(filled('Who: "{{Character}}"', { characterList: ['Ann', 'Ben'] })).toEqual({ Who: 'Ann, Ben' }));
    it('an empty value in quotes', () => expect(filled('Place: "{{Place}}"', { place: '' })).toEqual({ Place: '' }));
    it('a When or Subplot that looks like something else', () => {
        expect(filled('When: "{{When}}"\nSubplot: {{Subplot}}', { when: '1e3', subplots: ['0x10'] })).toEqual({ When: '1e3', Subplot: '0x10' });
    });
    it('leaves a value with no placeholder alone', () => {
        expect(generateSceneContent('Duration: 1 hour # note\nRefs: []\nQuote: "a: b"', data)).toBe('Duration: 1 hour # note\nRefs: []\nQuote: "a: b"');
    });
    it('a quoted placeholder reaches a dropped note as valid YAML', () => {
        const settings = { ...DEFAULT_SETTINGS, sceneYamlTemplates: { base: 'Class: Scene\nWhen: "{{When}}"', advanced: '' } };
        const result = addSceneIntakeTemplate('---\nClass: Scene\n---\n\nBody', settings, { when: 'Spring: Year 3' });
        expect((parse(result.split('---')[1]) as Record<string, unknown>).When).toBe('Spring: Year 3');
    });
});
