import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { addSceneIntakeTemplate, promoteSceneContent, replaceSketchAnchor } from './sceneIntakeTemplate';

function frontmatter(content: string): Record<string, unknown> {
    return parse(content.split('---')[1]) as Record<string, unknown>;
}

describe('scene intake template', () => {
    const templates = { base: 'Class: Scene\nAct: {{Act}}\nWhen: {{When}}\nSynopsis:\nTotal Time:', advanced: 'Place:\nCustom Mood: hopeful' };
    const source = '---\r\nClass: Scene\r\nAct: 3 # keep\r\nSynopsis: Original # retain\r\nUnrelated: yes\r\n---\r\n\r\nOriginal prose.\r\n';

    it('adds missing core fields while retaining the original YAML and prose', () => {
        const result = addSceneIntakeTemplate(source, { ...DEFAULT_SETTINGS, sceneYamlTemplates: templates, sceneAdvancedPropertiesEnabled: false });
        expect(result).toContain(source.slice(5));
        expect(frontmatter(result)).toMatchObject({ Class: 'Scene', Act: 3, Synopsis: 'Original', 'Total Time': null });
        expect(frontmatter(result)).not.toHaveProperty('Custom Mood');
        expect(frontmatter(result).ID).toMatch(/^scn_/);
    });
    it('adds configured advanced custom fields without replacing existing values or ID', () => {
        const withCustom = source.replace('Unrelated: yes', 'ID: author-id\r\nCustom Mood: anxious\r\nUnrelated: yes');
        const result = addSceneIntakeTemplate(withCustom, { ...DEFAULT_SETTINGS, sceneYamlTemplates: templates, sceneAdvancedPropertiesEnabled: true });
        expect(frontmatter(result)).toMatchObject({ ID: 'author-id', 'Custom Mood': 'anxious' });
        expect(result).toContain(withCustom.slice(5));
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
        expect(result).toContain('Class: Scene # class comment\nAct: 2 # keep act\nSynopsis: Original # keep synopsis\nCustom Field: Keep');
        expect(result).toContain('\n\nOriginal prose.\n');
        expect(result).not.toContain('Place after scene:');
        expect(result).not.toContain('Sketch Order:');
    });
    it('reanchors a following sketch without changing its other properties', () => {
        const source = '---\nPlace after scene: scn_old # keep\nSynopsis: A # original\n---\n\nBody';
        expect(replaceSketchAnchor(source, 'scn_old', 'scn_new')).toBe('---\nPlace after scene: "scn_new" # keep\nSynopsis: A # original\n---\n\nBody');
    });
});
