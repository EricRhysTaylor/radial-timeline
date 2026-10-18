import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { saveSettingsVerified } from './verifiedSave';

describe('durable settings save', () => {
    it('rejects an Obsidian save that resolves without changing disk', async () => {
        const write = vi.fn(async () => undefined);
        await expect(saveSettingsVerified({ value: 2 }, write, async () => '{"value":1}')).rejects.toThrow();
        expect(write).toHaveBeenCalledWith({ value: 2 });
    });
    it('accepts the exact saved snapshot despite later in-memory changes', async () => {
        const data = { value: 1 };
        let stored = '';
        await saveSettingsVerified(data, async snapshot => { stored = JSON.stringify(snapshot, null, 2); data.value = 2; }, async () => stored);
        expect(JSON.parse(stored)).toEqual({ value: 1 });
    });
    it('propagates write and read failures without claiming success', async () => {
        const read = vi.fn(async () => '');
        await expect(saveSettingsVerified({}, async () => { throw new Error('write denied'); }, read)).rejects.toThrow('write denied');
        expect(read).not.toHaveBeenCalled();
        await expect(saveSettingsVerified({}, async () => undefined, async () => { throw new Error('read denied'); })).rejects.toThrow('read denied');
    });
    it('verifies the shared plugin save boundary, not just one Publish caller', () => {
        const source = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
        expect(source).toContain('await saveSettingsVerified(persistedSettings');
        expect(source).toContain('this.app.vault.adapter.read(this.getSettingsFilePath())'); // SAFE: source wiring assertion, no adapter access.
    });
});
