import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import { removeSceneFromTimeline, type SceneMenuHost } from './SceneContextMenu';

describe('removing a scene from the timeline', () => {
    it('removes the mapped Class property while preserving the note’s other properties', async () => {
        const frontmatter: Record<string, unknown> = { 'Note Type': 'Scene', ID: 'scn_1234abcd', Title: 'The arrival' };
        const processFrontMatter = vi.fn(async (_file: unknown, update: (fm: Record<string, unknown>) => void) => update(frontmatter));
        const view = { plugin: { settings: { ...DEFAULT_SETTINGS, enableCustomMetadataMapping: true, frontmatterMappings: { 'Note Type': 'Class' } }, app: { fileManager: { processFrontMatter } } } } as unknown as SceneMenuHost;
        await removeSceneFromTimeline(view, { basename: '1 The arrival' } as never);
        expect(frontmatter).toEqual({ ID: 'scn_1234abcd', Title: 'The arrival' });
    });

    it('leaves a similarly named custom field alone when mapping is disabled', async () => {
        const frontmatter: Record<string, unknown> = { class: 'Scene', 'Note Type': 'Research', ID: 'scn_1234abcd' };
        const processFrontMatter = vi.fn(async (_file: unknown, update: (fm: Record<string, unknown>) => void) => update(frontmatter));
        const view = { plugin: { settings: { ...DEFAULT_SETTINGS, enableCustomMetadataMapping: false, frontmatterMappings: { 'Note Type': 'Class' } }, app: { fileManager: { processFrontMatter } } } } as unknown as SceneMenuHost;
        await removeSceneFromTimeline(view, { basename: '1 The arrival' } as never);
        expect(frontmatter).toEqual({ 'Note Type': 'Research', ID: 'scn_1234abcd' });
    });
});
