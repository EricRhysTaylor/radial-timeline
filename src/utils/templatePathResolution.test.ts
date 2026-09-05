import { describe, expect, it } from 'vitest';
import { TFile, normalizePath } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type { RadialTimelineSettings } from '../types/settings';
import { resolveTemplatePath } from './exportFormats';

function createPluginWithTemplateAt(vaultPath: string): RadialTimelinePlugin {
    const files = new Map<string, TFile>();
    files.set(normalizePath(vaultPath), new TFile(normalizePath(vaultPath)));

    const vault = {
        getAbstractFileByPath: (input: string) => files.get(normalizePath(input)) || null,
        adapter: {},
    } as unknown as RadialTimelinePlugin['app']['vault'];

    const settings: RadialTimelineSettings = {
        ...DEFAULT_SETTINGS,
        pandocFolder: 'Radial Timeline/Pandoc',
    };

    return {
        settings,
        app: { vault },
    } as unknown as RadialTimelinePlugin;
}

describe('resolveTemplatePath', () => {
    it('prefers existing template in configured pandoc folder over missing vault root candidate', () => {
        const plugin = createPluginWithTemplateAt('Radial Timeline/Pandoc/signature_literary_rt.tex');
        const resolved = resolveTemplatePath(plugin, 'signature_literary_rt.tex');
        expect(normalizePath(resolved)).toBe(normalizePath('Radial Timeline/Pandoc/signature_literary_rt.tex'));
    });
});

