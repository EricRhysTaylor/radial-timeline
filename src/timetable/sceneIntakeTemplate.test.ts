import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { addSceneIntakeTemplate, promoteSceneContent, replaceSketchAnchor } from './sceneIntakeTemplate';

function frontmatter(content: string): Record<string, unknown> {
    return parse(content.split('---')[1]) as Record<string, unknown>;
}

/** Every original line survives, unchanged and in its original order. */
function expectKept(source: string, result: string): void {
    const lines = result.split('\n');
    let cursor = -1;
    for (const line of source.split('\n')) {
        cursor = lines.indexOf(line, cursor + 1);
        expect(cursor, line).toBeGreaterThanOrEqual(0);
    }
}

describe('scene intake template', () => {
    const templates = { base: 'Class: Scene\nAct: {{Act}}\nWhen: {{When}}\nSynopsis:\nTotal Time:', advanced: 'Place:\nCustom Mood: hopeful' };
    const source = '---\r\nClass: Scene\r\nAct: 3 # keep\r\nSynopsis: Original # retain\r\nUnrelated: yes\r\n---\r\n\r\nOriginal prose.\r\n';

    it('adds missing core fields while retaining the original YAML and prose', () => {
        const result = addSceneIntakeTemplate(source, { ...DEFAULT_SETTINGS, sceneYamlTemplates: templates, sceneAdvancedPropertiesEnabled: false });
        expectKept(source, result);
        expect(frontmatter(result)).toMatchObject({ Class: 'Scene', Act: 3, Synopsis: 'Original', 'Total Time': null });
        expect(frontmatter(result)).not.toHaveProperty('Custom Mood');
        expect(frontmatter(result).ID).toMatch(/^scn_/);
    });
    it('adds configured advanced custom fields without replacing existing values or ID', () => {
        const withCustom = source.replace('Unrelated: yes', 'ID: author-id\r\nCustom Mood: anxious\r\nUnrelated: yes');
        const result = addSceneIntakeTemplate(withCustom, { ...DEFAULT_SETTINGS, sceneYamlTemplates: templates, sceneAdvancedPropertiesEnabled: true });
        expect(frontmatter(result)).toMatchObject({ ID: 'author-id', 'Custom Mood': 'anxious' });
        expectKept(withCustom, result);
        expect(frontmatter(result)).toHaveProperty('Place');
    });
    it('honors mapped existing properties instead of creating duplicate aliases', () => {
        const mapped = source.replace('Act: 3', 'Story Act: 3');
        const result = addSceneIntakeTemplate(mapped, { ...DEFAULT_SETTINGS, sceneYamlTemplates: templates, enableCustomMetadataMapping: true, frontmatterMappings: { 'Story Act': 'Act' } });
        expect(frontmatter(result)).toHaveProperty('Story Act', 3);
        expect(frontmatter(result)).not.toHaveProperty('Act');
    });
    it('fills a blank ID without losing its comment', () => {
        const sourceWithId = source.replace('Class: Scene', 'ID: # preserve\r\nClass: Scene');
        const result = addSceneIntakeTemplate(sourceWithId, { ...DEFAULT_SETTINGS, sceneYamlTemplates: templates });
        expect(result).toMatch(/ID: scn_[a-f0-9]+ # preserve/);
        expect((result.match(/^ID:/gm) ?? [])).toHaveLength(1);
    });
    it('promotes a sketch without reserializing existing YAML comments or prose', () => {
        const sketch = '---\nClass: Sketch # class comment\nAct: 2 # keep act\nSynopsis: Original # keep synopsis\nPlace after scene: scn_1\nSketch Order: 4\nCustom Field: Keep\n---\n\nOriginal prose.\n';
        const result = promoteSceneContent(sketch, { ...DEFAULT_SETTINGS, sceneYamlTemplates: templates }, { advanced: true, act: 1, when: '' });
        for (const line of ['Class: Scene # class comment', 'Act: 2 # keep act', 'Synopsis: Original # keep synopsis', 'Custom Field: Keep']) expect(result).toContain(line);
        expect(result).toContain('\n\nOriginal prose.\n');
        expect(result).not.toContain('Place after scene:');
        expect(result).not.toContain('Sketch Order:');
    });
    it('keeps the generated ID when a template lists ID', () => {
        const settings = { ...DEFAULT_SETTINGS, sceneYamlTemplates: { base: 'ID:\nClass: Scene\nAct: {{Act}}', advanced: '' } };
        expect(frontmatter(addSceneIntakeTemplate('---\nClass: Scene\n---\n\nBody', settings)).ID).toMatch(/^scn_/);
    });
    it('gives a dropped note the order a new scene has, keeping custom fields under their property', () => {
        const settings = { ...DEFAULT_SETTINGS, sceneYamlTemplates: { base: 'Class: Scene\nAct: {{Act}}\nSynopsis:\nStatus: Todo', advanced: '' } };
        const result = addSceneIntakeTemplate('---\nClass: Scene\nSynopsis: Mine\nMine: 1\n---\n\nBody', settings, { act: 3 });
        expect(Object.keys(frontmatter(result))).toEqual(['ID', 'Class', 'Act', 'Synopsis', 'Mine', 'Status']);
        expect(frontmatter(result).Act).toBe(3);
    });
    it('writes the same empty fields a new scene has', () => {
        const settings = { ...DEFAULT_SETTINGS, sceneYamlTemplates: { base: 'Class: Scene\nWhen: {{When}}\nDuration: 1 hour\nCharacter: {{Character}}', advanced: 'Place:\n{{PlaceList}}\nMood: {{Mood}}' } };
        const result = addSceneIntakeTemplate('---\nClass: Scene\n---\n\nBody', settings, { when: 'Spring: Year 3' });
        expect(result).toContain('When: "Spring: Year 3"\nDuration: 1 hour\nCharacter:\n');
        expect(result).toContain('Place:\nMood:\n');
        expect(result).not.toContain('{{');
    });
    it('names new fields as the author mapped them', () => {
        const settings = { ...DEFAULT_SETTINGS, sceneYamlTemplates: templates, enableCustomMetadataMapping: true, frontmatterMappings: { 'Scene Blurb': 'Synopsis' } };
        const result = addSceneIntakeTemplate('---\nClass: Scene\n---\n\nBody', settings);
        expect(frontmatter(result)).toHaveProperty('Scene Blurb');
        expect(frontmatter(result)).not.toHaveProperty('Synopsis');
    });
    it('promotes a note with an empty Class, keeping its comment', () => {
        const result = promoteSceneContent('---\nClass: # mine\nMine: 1\n---\n\nBody', { ...DEFAULT_SETTINGS, sceneYamlTemplates: templates }, { advanced: false, act: 1, when: '', expectedSketch: false });
        expect(result).toContain('Class: Scene # mine');
    });
    it('refuses to promote a note that became something else', () => {
        expect(() => promoteSceneContent('---\nClass: Character\n---\n', DEFAULT_SETTINGS, { advanced: false, act: 1, when: '' })).toThrow();
    });
    it('refuses a note with the same property under two spellings', () => {
        expect(() => addSceneIntakeTemplate('---\nClass: Scene\nSynopsis: A\nsynopsis: B\n---\n', DEFAULT_SETTINGS)).toThrow();
    });
    it('reanchors a following sketch without changing its other properties', () => {
        const source = '---\nPlace after scene: scn_old # keep\nSynopsis: A # original\n---\n\nBody';
        expect(replaceSketchAnchor(source, 'scn_old', 'scn_new')).toBe('---\nPlace after scene: "scn_new" # keep\nSynopsis: A # original\n---\n\nBody');
    });
});
