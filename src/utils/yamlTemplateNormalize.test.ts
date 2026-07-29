import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { computeCanonicalOrder, getBaseKeys, getExcludeKeyPredicate, safeParseYaml } from './yamlTemplateNormalize';

describe('yamlTemplateNormalize', () => {
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
        for (const key of ['Part', 'Part Epigraph', 'Part Epigraph By']) {
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
