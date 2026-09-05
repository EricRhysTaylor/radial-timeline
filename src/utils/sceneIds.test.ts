import { describe, expect, it } from 'vitest';
import {
    ensureReferenceIdFrontmatter,
    ensureReferenceIdTemplateFrontmatter,
    ensureSceneIdFrontmatter,
    ensureSceneTemplateFrontmatter,
    generateSceneId,
    resolveSceneReferenceId
} from './sceneIds';

describe('sceneIds', () => {
    it('adds a stable scene id when frontmatter is missing one', () => {
        const result = ensureSceneIdFrontmatter({
            Class: 'Scene',
            Summary: 'Existing summary'
        });

        expect(result.sceneId).toMatch(/^scn_[0-9a-f]{8,10}$/);
        expect(result.frontmatter.ID).toBe(result.sceneId);
        expect(result.frontmatter.Class).toBe('Scene');
    });

    it('preserves an existing scene id value', () => {
        const result = ensureSceneIdFrontmatter({
            ID: 'scn_deadbeef',
            Class: 'Scene',
            Summary: 'Keep me'
        });

        expect(result.sceneId).toBe('scn_deadbeef');
        expect(result.frontmatter.ID).toBe('scn_deadbeef');
    });

    it('keeps scene identity stable across rename/reorder by preferring sceneId over path', () => {
        const sceneId = generateSceneId();
        const oldPath = 'Book 1/12 Scene.md';
        const renamedPath = 'Book 1/34 Scene Renamed.md';

        expect(resolveSceneReferenceId(sceneId, oldPath)).toBe(sceneId);
        expect(resolveSceneReferenceId(sceneId, renamedPath)).toBe(sceneId);
    });

    it('puts ID above class in generated scene template frontmatter', () => {
        const template = [
            'Class: Scene',
            'When: {{When}}',
            'Summary:'
        ].join('\n');
        const result = ensureSceneTemplateFrontmatter(template);
        const lines = result.frontmatter.split('\n');

        expect(lines[0]).toMatch(/^ID:\s+scn_[0-9a-f]{8,10}$/);
        expect(lines[1]).toBe('Class: Scene');
    });

    it('forces a replacement reference id when requested', () => {
        const result = ensureReferenceIdFrontmatter({
            ID: 'scn_deadbeef',
            Class: 'Backdrop',
            Context: 'context'
        }, {
            classFallback: 'Backdrop',
            forceId: 'scn_feedface'
        });

        expect(result.id).toBe('scn_feedface');
        expect(result.frontmatter.ID).toBe('scn_feedface');
        expect(result.changed).toBe(true);
    });

    it('normalizes template frontmatter with ID first and class fallback', () => {
        const result = ensureReferenceIdTemplateFrontmatter('When: {{When}}\nContext:', 'Backdrop');
        const lines = result.frontmatter.split('\n');

        expect(lines[0]).toMatch(/^ID:\s+scn_[0-9a-f]{8,10}$/);
        expect(lines[1]).toBe('Class: Backdrop');
        expect(lines[2]).toBe('When: {{When}}');
    });
});
