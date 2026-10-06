import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, zipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { BONUS_VAULTS, type BonusVaultDef } from '../settings/bonusVaults';
import { demoBookDefinitions, demoProjectFolder, prepareDemoImport } from './demoImportPlan';
import { INQUIRY_SIDECAR_PATH } from '../inquiry/InquiryArtifactStore';

async function fixture(extra: Record<string, string> = {}) {
    const baseKey = 'setup-core::standard::sig::book::Book::';
    const entries: Record<string, string> = {
        'Demo/Book/1 Start.md': '---\nClass: Scene\nID: scene-one\n---\n[[2 [Finish]#End]] [[Character]]',
        'Demo/Book/2 [Finish].md': '---\nClass: Scene\nID: scene-two\n---\nFinish.',
        'Demo/Characters/Character.md': 'A character.',
        'Demo/Brief.md': '[[Book/1 Start\\|Start]]',
        [`Demo/${INQUIRY_SIDECAR_PATH}`]: JSON.stringify({ schemaVersion: 1, savedAt: 1, sessions: [{
            key: `${baseKey}::fingerprint`, baseKey, activeBookId: 'Book', createdAt: 1, targetSceneIds: [], briefPath: 'Brief.md', cacheWindowExpiresAt: 9999999999999,
            result: { scopeLabel: 'B1', findings: [{ span: 'B1', evidenceQuote: '[[1 Start]] must stay literal.', supportingRefs: [{ refPath: 'Book/1 Start.md' }] }], evidenceDocumentMeta: [{ path: 'Book/2 [Finish].md', sceneId: 'scene-two' }] }
        }] }),
        ...extra
    };
    const bytes = zipSync(Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, strToU8(value)])));
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)).toString('hex');
    const demo: BonusVaultDef = { id: 'test', title: 'Test', author: 'Author', countLabel: '2 scenes', status: 'available', books: [{ title: 'Book', sourceFolder: 'Book' }], archive: { url: 'https://example.com/demo.zip', downloadUrl: 'https://example.com/go/demo', root: 'Demo', bytes: bytes.length, sha256: hash } };
    return { bytes, demo, numbers: new Map([['Demo Projects/Test/Book', 4]]) };
}

describe('reviewed demo import plan', () => {
    it('rebases links, bracketed filenames, brief references and book scope without changing quotations', async () => {
        const { bytes, demo, numbers } = await fixture();
        const plan = await prepareDemoImport(bytes, demo, numbers);
        expect(strFromU8(plan.files.get('Book/1 Start.md')!)).toContain('[[Demo Projects/Test/Book/2 [Finish]#End|2 [Finish]]]');
        expect(strFromU8(plan.files.get('Brief.md')!)).toContain('[[Demo Projects/Test/Book/1 Start\\|Start]]');
        const session = JSON.parse(strFromU8(plan.files.get(INQUIRY_SIDECAR_PATH)!)).sessions[0];
        expect(session.activeBookId).toBe('Demo Projects/Test/Book');
        expect(session.result.scopeLabel).toBe('B4');
        expect(session.result.findings[0].span).toBe('B4');
        expect(session.result.findings[0].evidenceQuote).toBe('[[1 Start]] must stay literal.');
        expect(session.result.findings[0].supportingRefs[0].refPath).toBe('Demo Projects/Test/Book/1 Start.md');
        expect(session.cacheWindowExpiresAt).toBeUndefined();
        expect(plan.ids.size).toBe(2);
    });
    it('rejects a changed edition before unpacking', async () => {
        const { bytes, demo, numbers } = await fixture();
        bytes[20] ^= 1;
        await expect(prepareDemoImport(bytes, demo, numbers)).rejects.toThrow('reviewed edition');
    });
    it.each(['Demo/../escape.md', 'Demo/.obsidian/data.json', '/absolute.md', 'Demo/script.js'])('rejects unsafe or unsupported entries: %s', async path => {
        const { bytes, demo, numbers } = await fixture({ [path]: 'unsafe' });
        await expect(prepareDemoImport(bytes, demo, numbers)).rejects.toThrow();
    });
    it('rejects duplicate manuscript IDs', async () => {
        const { bytes, demo, numbers } = await fixture({ 'Demo/Book/3 Duplicate.md': '---\nClass: Scene\nID: scene-one\n---\nDuplicate.' });
        await expect(prepareDemoImport(bytes, demo, numbers)).rejects.toThrow('duplicate ID');
    });
    it('rejects saved evidence pointing outside the package', async () => {
        const { bytes, demo, numbers } = await fixture({ [`Demo/${INQUIRY_SIDECAR_PATH}`]: JSON.stringify({ schemaVersion: 1, sessions: [{ key: 'q::book::Book::::h', baseKey: 'q::book::Book::', activeBookId: 'Book', result: { evidenceDocumentMeta: [{ path: 'Author/Private.md' }] } }] }) });
        await expect(prepareDemoImport(bytes, demo, numbers)).rejects.toThrow('Missing or ambiguous');
    });
});

// Explicit integration run uses downloaded, pinned editions without adding ZIPs to the repo.
const archiveDirectory = process.env.RT_DEMO_ARCHIVE_DIRECTORY;
describe.skipIf(!archiveDirectory)('published demo editions', () => {
    it.each(BONUS_VAULTS.filter(demo => demo.archive))('imports $title with all saved evidence rebased', async demo => {
        const bytes = new Uint8Array(readFileSync(`${archiveDirectory}/${demo.id}.zip`));
        const numbers = new Map(demoBookDefinitions(demo).map((book, index) => [book.sourceFolder, index + 3]));
        const plan = await prepareDemoImport(bytes, demo, numbers);
        const sessions = JSON.parse(strFromU8(plan.files.get(INQUIRY_SIDECAR_PATH)!)).sessions;
        expect(sessions).toHaveLength(3);
        for (const session of sessions) {
            expect(session.activeBookId.startsWith(`${demoProjectFolder(demo)}/`)).toBe(true);
            expect(session.result.scopeLabel).toBe('B3');
            for (const meta of session.result.evidenceDocumentMeta) {
                expect(meta.path.startsWith(`${demoProjectFolder(demo)}/`)).toBe(true);
                expect(plan.files.has(meta.path.slice(demoProjectFolder(demo).length + 1))).toBe(true);
            }
        }
    });
});

const sherlockArchive = process.env.RT_SHERLOCK_CANDIDATE_ARCHIVE;
describe.skipIf(!sherlockArchive)('four-book release candidate import', () => {
    it('rebases all four novels and twelve saved Inquiry results', async () => {
        const bytes = new Uint8Array(readFileSync(sherlockArchive!));
        const collection = BONUS_VAULTS.find(demo => demo.id === 'sherlock-holmes')!;
        expect(collection.status).toBe('available');
        expect(collection.archive).toBeDefined();
        const demo = collection;
        const books = demoBookDefinitions(demo);
        const numbers = new Map(books.map((book, index) => [book.sourceFolder, index + 3]));
        const plan = await prepareDemoImport(bytes, demo, numbers);
        const sessions = JSON.parse(strFromU8(plan.files.get(INQUIRY_SIDECAR_PATH)!)).sessions;
        expect(sessions).toHaveLength(12);
        for (const book of books) {
            const answers = sessions.filter((session: { activeBookId: string }) => session.activeBookId === book.sourceFolder);
            expect(answers).toHaveLength(3);
            for (const answer of answers) expect(answer.result.scopeLabel).toBe(`B${numbers.get(book.sourceFolder)}`);
        }
        expect(plan.indexedPaths).toHaveLength(97);
    });
});
