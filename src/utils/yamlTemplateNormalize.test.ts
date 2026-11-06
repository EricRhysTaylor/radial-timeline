import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { computeCanonicalOrder, extractKeysInOrder, getBaseKeys, getExcludeKeyPredicate, getSceneTemplate, getTemplateParts, migrateSceneTemplates, safeParseYaml } from './yamlTemplateNormalize';

describe('yamlTemplateNormalize', () => {
    it('moves older vaults to the Total Time position new vaults have', () => {
        const base = DEFAULT_SETTINGS.sceneYamlTemplates!.base.replace('Total Time:\n', '');
        const migrated = migrateSceneTemplates({ base, advanced: 'Place:' });
        expect(extractKeysInOrder(migrated.base)).toEqual(extractKeysInOrder(DEFAULT_SETTINGS.sceneYamlTemplates!.base));
        expect(migrated.advanced).toBe('Place:');
    });

    it('carries an advanced Total Time default into Core without a duplicate', () => {
        const migrated = migrateSceneTemplates({ base: 'Class: Scene\nTotal Time:', advanced: 'Place:\nTotal Time: 2.5 # mine\nQuestions:' });
        expect(migrated).toEqual({ base: 'Class: Scene\nTotal Time: 2.5 # mine', advanced: 'Place:\nQuestions:' });
    });

    it('leaves a current template and the author custom fields untouched', () => {
        const stored = { base: 'Class: Scene\nWords:\nTotal Time: 1\nAuthor Core: custom', advanced: 'Mood: hopeful # keep\nPlace:\n{{PlaceList}}' };
        expect(migrateSceneTemplates(stored)).toEqual(stored);
    });

    it('restores a blank core template instead of creating scenes with no Class', () => {
        expect(migrateSceneTemplates({ base: '  ', advanced: '' }).base).toBe(DEFAULT_SETTINGS.sceneYamlTemplates!.base);
    });

    it('reads property names in any language', () => {
        expect(extractKeysInOrder('場所:\nÉmotion: x\n{{PlaceList}}\n  - nested: no\n# Comment: no\nPlace:')).toEqual(['場所', 'Émotion', 'Place']);
    });

    it('keeps non-English advanced fields when merging templates', () => {
        const merged = getTemplateParts('Scene', { ...DEFAULT_SETTINGS, sceneYamlTemplates: { base: 'Class: Scene\nPulse Update:', advanced: '場所: 東京\nChapter: ignored\nClass: ignored' } }).merged;
        expect(merged).toBe('Class: Scene\n場所: 東京\nPulse Update:');
    });

    it('selects Core or Core plus Advanced from one place', () => {
        const settings = { ...DEFAULT_SETTINGS, sceneYamlTemplates: { base: 'Class: Scene', advanced: 'Place:' } };
        expect(getSceneTemplate({ ...settings, sceneAdvancedPropertiesEnabled: false })).toBe('Class: Scene');
        expect(getSceneTemplate({ ...settings, sceneAdvancedPropertiesEnabled: true })).toContain('Place:');
        expect(getSceneTemplate({ ...settings, sceneAdvancedPropertiesEnabled: false }, true)).toContain('Place:');
    });

    it('enforces Pulse Update and Summary Update as required base Scene keys', () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            sceneYamlTemplates: {
                base: 'Class: Scene\nAct: {{Act}}\nWhen: {{When}}',
                advanced: ''
            }
        };

        const keys = getBaseKeys('Scene', settings);
        expect(keys).toContain('Pulse Update');
        expect(keys).toContain('Summary Update');
    });

    it('treats Chapter as a base field for Scene, Beat, and Backdrop templates', () => {
        expect(getBaseKeys('Scene', DEFAULT_SETTINGS)).toContain('Chapter');
        expect(getBaseKeys('Beat', DEFAULT_SETTINGS)).toContain('Chapter');
        expect(getBaseKeys('Backdrop', DEFAULT_SETTINGS)).toContain('Chapter');
    });

    it('does not exclude deprecated Pulse Last Updated fields from Scene extra-key audits', () => {
        const isExcluded = getExcludeKeyPredicate('Scene');
        expect(isExcluded('Pulse Last Updated')).toBe(false);
        expect(isExcluded('Beats Last Updated')).toBe(false);
        expect(isExcluded('id')).toBe(true);
    });

    it('keeps reference ID first in canonical order', () => {
        const order = computeCanonicalOrder('Scene', DEFAULT_SETTINGS);
        expect(order[0]).toBe('ID');
    });

    it('gives optional-managed Part keys a canonical position without templating them', () => {
        const order = computeCanonicalOrder('Scene', DEFAULT_SETTINGS);
        const baseKeys = getBaseKeys('Scene', DEFAULT_SETTINGS);

        // Ordered — so a scene that carries them keeps them in a stable place.
        for (const key of ['Part']) {
            expect(order).toContain(key);
            // ...but absent from the template, so the audit never demands them and
            // note creation never seeds them. This pairing is the whole point of
            // the optional-managed registry.
            expect(baseKeys).not.toContain(key);
        }

        // Part → Chapter → Scene is the structural nesting; the order reflects it.
        expect(order.indexOf('Part')).toBeLessThan(order.indexOf('Chapter'));
        expect(order.indexOf('Part')).toBeGreaterThan(order.indexOf('Act'));
    });

    it('does not exclude scene triplet analysis fields when AI is disabled', () => {
        const isExcluded = getExcludeKeyPredicate('Scene', { enableAiSceneAnalysis: false });
        expect(isExcluded('previousSceneAnalysis')).toBe(false);
        expect(isExcluded('currentSceneAnalysis')).toBe(false);
        expect(isExcluded('nextSceneAnalysis')).toBe(false);
    });

    it('treats template placeholders as scalar values during YAML parsing', () => {
        const parsed = safeParseYaml([
            'Class: Scene',
            'Act: {{Act}}',
            'When: {{When}}',
            'Subplot:',
            '{{SubplotList}}'
        ].join('\n'));

        expect(parsed.Class).toBe('Scene');
        expect(parsed.Act).toBe('{{Act}}');
        expect(parsed.When).toBe('{{When}}');
        expect(parsed.Subplot).toBe('');
    });
});
