import { describe, expect, it } from 'vitest';
import { escapesVaultRoot, resolveExportOutputFolder } from './aiOutput';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import type RadialTimelinePlugin from '../main';

const DEFAULT_EXPORT = DEFAULT_SETTINGS.manuscriptOutputFolder || 'Radial Timeline/Export';

function pluginWithFolder(value: string | undefined): RadialTimelinePlugin {
    return { settings: { manuscriptOutputFolder: value } } as unknown as RadialTimelinePlugin;
}

describe('escapesVaultRoot', () => {
    it('accepts vault-relative folders', () => {
        for (const ok of ['Radial Timeline/Export', 'Exports', 'a/b/c', 'Manuscripts/Final']) {
            expect(escapesVaultRoot(ok)).toBe(false);
        }
    });

    it('rejects empty, drive-letter, and parent-escaping paths', () => {
        for (const bad of ['', 'G:/Drive', 'C:/Users/me', '..', '../outside', 'a/../../b']) {
            expect(escapesVaultRoot(bad)).toBe(true);
        }
    });
});

describe('resolveExportOutputFolder', () => {
    it('falls back to the default when unset or blank', () => {
        expect(resolveExportOutputFolder(pluginWithFolder(undefined))).toBe(DEFAULT_EXPORT);
        expect(resolveExportOutputFolder(pluginWithFolder('   '))).toBe(DEFAULT_EXPORT);
    });

    it('honors a configured vault-relative folder (normalized)', () => {
        expect(resolveExportOutputFolder(pluginWithFolder('My Exports'))).toBe('My Exports');
        expect(resolveExportOutputFolder(pluginWithFolder('a//b/'))).toBe('a/b');
        // A leading slash is vault-root-relative; normalizePath strips it.
        expect(resolveExportOutputFolder(pluginWithFolder('/absolute'))).toBe('absolute');
    });

    it('falls back to the default for folders that escape the vault', () => {
        expect(resolveExportOutputFolder(pluginWithFolder('G:\\Drive'))).toBe(DEFAULT_EXPORT);
        expect(resolveExportOutputFolder(pluginWithFolder('../escape'))).toBe(DEFAULT_EXPORT);
        expect(resolveExportOutputFolder(pluginWithFolder('a/../../b'))).toBe(DEFAULT_EXPORT);
    });
});
