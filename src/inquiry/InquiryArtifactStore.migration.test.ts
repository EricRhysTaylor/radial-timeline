import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import {
    INQUIRY_SIDECAR_DIR,
    INQUIRY_SIDECAR_PATH,
    LEGACY_INQUIRY_SIDECAR_DIR,
    LEGACY_INQUIRY_SIDECAR_PATH,
    migrateInquirySidecarToVisible
} from './InquiryArtifactStore';
import { serializeSessionsToArtifact } from './sessionArtifact';

// Characterisation: the one-time move of sessions.json out of the hidden
// dotfolder is copy-then-delete of author data, so every branch is pinned.

type Fake = {
    app: App;
    files: Map<string, string>;
    dirs: Set<string>;
    calls: string[];
    failRmdir: boolean;
};

function fakeVault(seed: Record<string, string>, opts: { newExists?: boolean; failRmdir?: boolean } = {}): Fake {
    const files = new Map(Object.entries(seed));
    const dirs = new Set<string>();
    const calls: string[] = [];
    if (opts.newExists) files.set(INQUIRY_SIDECAR_PATH, 'existing');
    const adapter = {
        exists: async (path: string) => files.has(path) || dirs.has(path),
        read: async (path: string) => {
            calls.push(`read:${path}`);
            const value = files.get(path);
            if (value === undefined) throw new Error(`missing ${path}`);
            return value;
        },
        write: async (path: string, data: string) => { calls.push(`write:${path}`); files.set(path, data); },
        mkdir: async (path: string) => { calls.push(`mkdir:${path}`); dirs.add(path); },
        remove: async (path: string) => { calls.push(`remove:${path}`); files.delete(path); },
        rmdir: async (path: string) => {
            calls.push(`rmdir:${path}`);
            if (opts.failRmdir) throw new Error('not empty');
            dirs.delete(path);
        }
    };
    return { app: { vault: { adapter } } as unknown as App, files, dirs, calls, failRmdir: !!opts.failRmdir }; // SAFE: the migration touches only vault.adapter
}

const validRaw = JSON.stringify(serializeSessionsToArtifact([], 1_700_000_000_000));

describe('migrateInquirySidecarToVisible', () => {
    it('does nothing when the visible file already exists, even if a legacy file remains', async () => {
        const fake = fakeVault({ [LEGACY_INQUIRY_SIDECAR_PATH]: validRaw }, { newExists: true });
        await migrateInquirySidecarToVisible(fake.app);
        expect(fake.calls).toEqual([]);
        expect(fake.files.get(INQUIRY_SIDECAR_PATH)).toBe('existing');
        expect(fake.files.has(LEGACY_INQUIRY_SIDECAR_PATH)).toBe(true);
    });

    it('does nothing when there is no legacy file', async () => {
        const fake = fakeVault({});
        await migrateInquirySidecarToVisible(fake.app);
        expect(fake.calls).toEqual([]);
    });

    it('leaves a corrupt legacy file in place and never writes the visible one', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const fake = fakeVault({ [LEGACY_INQUIRY_SIDECAR_PATH]: '{not json' });
        await migrateInquirySidecarToVisible(fake.app);
        expect(fake.calls).toEqual([`read:${LEGACY_INQUIRY_SIDECAR_PATH}`]);
        expect(fake.files.has(LEGACY_INQUIRY_SIDECAR_PATH)).toBe(true);
        expect(fake.files.has(INQUIRY_SIDECAR_PATH)).toBe(false);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        errorSpy.mockRestore();
    });

    it('copies a valid legacy file byte for byte, then removes the original and its dotfolders', async () => {
        const fake = fakeVault({ [LEGACY_INQUIRY_SIDECAR_PATH]: validRaw });
        await migrateInquirySidecarToVisible(fake.app);
        expect(fake.files.get(INQUIRY_SIDECAR_PATH)).toBe(validRaw);
        expect(fake.files.has(LEGACY_INQUIRY_SIDECAR_PATH)).toBe(false);
        expect(fake.calls).toEqual([
            `read:${LEGACY_INQUIRY_SIDECAR_PATH}`,
            `mkdir:${INQUIRY_SIDECAR_DIR}`,
            `write:${INQUIRY_SIDECAR_PATH}`,
            `remove:${LEGACY_INQUIRY_SIDECAR_PATH}`,
            `rmdir:${LEGACY_INQUIRY_SIDECAR_DIR}`,
            'rmdir:.radial-timeline'
        ]);
    });

    it('keeps the visible copy when the dotfolder cannot be removed', async () => {
        const fake = fakeVault({ [LEGACY_INQUIRY_SIDECAR_PATH]: validRaw }, { failRmdir: true });
        await expect(migrateInquirySidecarToVisible(fake.app)).resolves.toBeUndefined();
        expect(fake.files.get(INQUIRY_SIDECAR_PATH)).toBe(validRaw);
        expect(fake.files.has(LEGACY_INQUIRY_SIDECAR_PATH)).toBe(false);
    });
});
