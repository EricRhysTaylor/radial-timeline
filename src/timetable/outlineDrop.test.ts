import { describe, expect, it } from 'vitest';
import { vaultDragPaths } from './outlineDrop';

describe('outline reference drops', () => {
    it('recognizes encoded notes in the current vault and deduplicates links', () => {
        const link = 'obsidian://open?vault=My%20Vault&file=World%2FPeople%20%26%20Places.md';
        expect(vaultDragPaths(`${link}\n${link}`, 'My Vault')).toEqual(['World/People & Places.md']);
    });
    it('rejects external paths, other vaults, plain text, and links without a vault', () => {
        const input = ['file:///tmp/note.md', '/tmp/note.md', 'obsidian://open?vault=Other&file=note.md', 'obsidian://open?file=note.md', 'Some selected text'].join('\n');
        expect(vaultDragPaths(input, 'My Vault')).toEqual([]);
    });
});
