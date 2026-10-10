import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { Vault } from 'obsidian';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { assertSceneSourcesUnchanged, getAllSceneData } from './data';
import { buildSummaryRunRequest } from './summaryRefresh';

function fixture() {
    const file = new TFile('Book/1 Fixture.md');
    let raw = '---\nClass: Scene\nSecret: PRIVATE_YAML\n---\nPublic story.\n<!-- PRIVATE_HTML -->\n%% PRIVATE_OBSIDIAN %%';
    const vault = {
        getMarkdownFiles: () => [file], getAbstractFileByPath: () => file, read: async () => raw
    } as unknown as Vault; // SAFE: minimal scene reader fixture
    const plugin = { settings: { ...DEFAULT_SETTINGS, sourcePath: 'Book' } } as unknown as RadialTimelinePlugin; // SAFE: the reader uses only settings
    return { file, vault, plugin, edit: (text: string) => { raw = text; } };
}

describe('scene evidence privacy and source revisions', () => {
    it('excludes private comments and YAML from Pulse/Summary evidence', async () => {
        const { vault, plugin } = fixture();
        const [scene] = await getAllSceneData(plugin, vault);
        expect(scene.body).toBe('Public story.');
        expect(buildSummaryRunRequest(scene, 200).userInput).not.toContain('PRIVATE_');
    });

    it('blocks an AI write-back after the author edits its source', async () => {
        const { vault, plugin, edit } = fixture();
        const [scene] = await getAllSceneData(plugin, vault);
        await assertSceneSourcesUnchanged(vault, [scene]);
        edit('---\nClass: Scene\n---\nNew author prose.');
        await expect(assertSceneSourcesUnchanged(vault, [scene])).rejects.toThrow('changed during analysis');
    });

    it('blocks write-back when an unchanged scene was moved to a different book', async () => {
        const { vault, plugin, file } = fixture();
        const [scene] = await getAllSceneData(plugin, vault);
        file.path = 'Other Book/1 Fixture.md';
        await expect(assertSceneSourcesUnchanged(vault, [scene])).rejects.toThrow('moved during analysis');
    });

    it('blocks unreadable selected files rather than analyzing a partial corpus', async () => {
        const { vault, plugin } = fixture();
        vault.read = async () => { throw new Error('fixture read failure'); };
        await expect(getAllSceneData(plugin, vault)).rejects.toThrow('fixture read failure');
    });
});
