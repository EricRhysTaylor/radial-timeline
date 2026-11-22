/**
 * The Open in Obsidian link for a book being added to the vault, and where
 * notes can be written from: one modal, one button.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDefaultCommunityShareSettings } from '../communityShare/communityShareSettings';
import { bookFromCommunityLinkRoute } from './BookFromCommunityLinkService';

const TRANSFER_ID = '55555555-5555-4555-8555-555555555555';

function plugin(change: (settings: ReturnType<typeof buildDefaultCommunityShareSettings>) => void = () => undefined) {
    const settings = buildDefaultCommunityShareSettings();
    settings.enabled = true;
    settings.tier = 2;
    settings.audience = 'public';
    settings.connection = { status: 'connected', connectionId: 'conn-1', profileId: 'profile-1', projectId: null, secretId: 'rt.community-share.connection-secret' };
    change(settings);
    return { settings: { communityShare: settings } } as never;
}

describe('obsidian://radial-timeline-transfer', () => {
    it('opens the preview for a transfer id', () => {
        expect(bookFromCommunityLinkRoute(plugin(), { id: TRANSFER_ID.toUpperCase() })).toEqual({ kind: 'open', transferId: TRANSFER_ID });
    });

    it('answers an incomplete link with its next step', () => {
        expect(bookFromCommunityLinkRoute(plugin(), {})).toMatchObject({ kind: 'notice', text: expect.stringContaining('Share page') });
        expect(bookFromCommunityLinkRoute(plugin(), { id: 'not-an-id' })).toMatchObject({ kind: 'notice' });
    });

    it('asks to connect, resume or choose a level before anything is read', () => {
        expect(bookFromCommunityLinkRoute(plugin(s => { s.connection = { status: 'disconnected' } as never; }), { id: TRANSFER_ID }))
            .toMatchObject({ kind: 'notice', text: expect.stringContaining('Connect this vault') });
        expect(bookFromCommunityLinkRoute(plugin(s => { s.sharingPaused = true; }), { id: TRANSFER_ID }))
            .toMatchObject({ kind: 'notice', text: expect.stringContaining('Resume sharing') });
        expect(bookFromCommunityLinkRoute(plugin(s => { s.tier = 0; }), { id: TRANSFER_ID }))
            .toMatchObject({ kind: 'notice', text: expect.stringContaining('above Private') });
    });
});

describe('notes are written from one place, behind one button', () => {
    const SRC = resolve(process.cwd(), 'src');
    const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return sources(full);
        return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
    });
    const files = sources(SRC).map(path => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }));
    const naming = (needle: string) => files.filter(file => file.text.includes(needle)).map(file => file.path).sort();
    const count = (text: string, needle: string) => text.split(needle).length - 1;

    it('timeline-transfer-sync is named in the client only', () => {
        expect(naming("'timeline-transfer-sync'")).toEqual(['communityShare/communityShareClient.ts']);
    });

    it('runBookTransfer is called only by the preview, from its one primary button', () => {
        expect(naming('runBookTransfer(')).toEqual(['communityShare/bookTransferWriter.ts', 'modals/BookFromCommunityModal.ts']);
        const modal = files.find(file => file.path === 'modals/BookFromCommunityModal.ts')!.text;
        expect(count(modal, 'runBookTransfer(')).toBe(1);
        expect(modal.slice(modal.indexOf('private async run(')).includes('runBookTransfer(')).toBe(true);
        expect(count(modal, '.onClick(() => this.run())')).toBe(2); // Create book, or Continue: one is shown at a time
        expect(count(modal, 'this.run(')).toBe(2);
    });

    it('nothing main.ts schedules reads a book from Community', () => {
        const main = files.find(file => file.path === 'main.ts')!.text;
        expect(main).not.toMatch(/listBookTransfers|readBookTransfer|finishBookTransfer|runBookTransfer/);
    });
});
