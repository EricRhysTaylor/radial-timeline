import { describe, expect, it } from 'vitest';
import type { MetadataCache, Vault } from 'obsidian';
import { TFile } from 'obsidian';
import { buildGossamerEvidenceDocument } from './buildGossamerEvidence';

describe('buildGossamerEvidenceDocument', () => {
    const sceneFile = new TFile('Book 1/01 Scene.md');

    const makeVault = (rawByPath: Record<string, string>): Vault => ({
        read: async (target: TFile) => rawByPath[target.path] || '',
    } as unknown as Vault);

    const makeMetadataCache = (frontmatterByPath: Record<string, Record<string, unknown>>): MetadataCache => ({
        getFileCache: (target: TFile) => ({ frontmatter: frontmatterByPath[target.path] || {} }),
    } as unknown as MetadataCache);

    it('always uses cleaned scene bodies (no summary mode)', async () => {
        const raw = `---
Class: Scene
id: scn_deadbeef
Summary: Frontmatter summary
---
Visible body.
<!-- hidden -->
%% remove %%
More body.`;

        const result = await buildGossamerEvidenceDocument({
            sceneFiles: [sceneFile],
            vault: makeVault({ [sceneFile.path]: raw }),
            metadataCache: makeMetadataCache({
                [sceneFile.path]: {
                    Class: 'scene',
                    id: 'scn_deadbeef',
                    Summary: 'Frontmatter summary'
                }
            }),
        });

        // Bodies are included and cleaned
        expect(result.text).toContain('Visible body.');
        expect(result.text).toContain('More body.');
        expect(result.text).not.toContain('Class: Scene');
        expect(result.text).not.toContain('hidden');
        expect(result.text).not.toContain('remove');
        expect(result.text).toContain('(scn_deadbeef)');
        // Summaries are never used as evidence content
        expect(result.text).not.toContain('Frontmatter summary');
    });

    it('does not accept an evidenceMode parameter', () => {
        // The function signature must not include evidenceMode — bodies-only is the only path.
        expect(buildGossamerEvidenceDocument.length).toBeLessThanOrEqual(1);
    });

    it('returns empty document when no scenes have body content', async () => {
        const raw = `---
Class: Scene
Summary: Summary only scene
---`;

        const result = await buildGossamerEvidenceDocument({
            sceneFiles: [sceneFile],
            vault: makeVault({ [sceneFile.path]: raw }),
            metadataCache: makeMetadataCache({
                [sceneFile.path]: { Class: 'scene', Summary: 'Summary only scene' }
            }),
        });

        expect(result.includedScenes).toBe(0);
        expect(result.totalScenes).toBe(1);
        expect(result.text).toContain('No scene body content available.');
    });
});
