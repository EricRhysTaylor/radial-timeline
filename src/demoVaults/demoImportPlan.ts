import { parseYaml } from 'obsidian';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import type { BonusVaultDef } from '../settings/bonusVaults';
import { parseSessionArtifact, serializeSessionsToArtifact } from '../inquiry/sessionArtifact';
import { INQUIRY_SIDECAR_PATH } from '../inquiry/InquiryArtifactStore';
import type { SampleBookDefinition } from '../utils/sampleVault';

export const DEMO_PROJECTS_FOLDER = 'Demo Projects';
export const demoProjectFolder = (demo: Pick<BonusVaultDef, 'title'>): string => `${DEMO_PROJECTS_FOLDER}/${demo.title}`;
export const demoBookDefinitions = (demo: BonusVaultDef): SampleBookDefinition[] =>
    (demo.books ?? []).map(book => ({ ...book, sourceFolder: `${demoProjectFolder(demo)}/${book.sourceFolder}` }));

export interface DemoImportPlan {
    files: Map<string, Uint8Array>;
    indexedPaths: string[];
    ids: Set<string>;
}

/** Validate the reviewed edition before unpacking or writing anything. */
export async function prepareDemoImport(
    bytes: Uint8Array,
    demo: BonusVaultDef,
    bookNumbers: ReadonlyMap<string, number>
): Promise<DemoImportPlan> {
    if (!demo.archive || !demo.books?.length) throw new Error('This demo is not yet available.');
    if (bytes.length !== demo.archive.bytes) throw new Error('The demo download is incomplete or has changed. Nothing was added.');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer));
    const hash = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== demo.archive.sha256) throw new Error('The demo download does not match the reviewed edition. Nothing was added.');
    let total = 0;
    let count = 0;
    const root = `${demo.archive.root}/`;
    const decoded = unzipSync(bytes, { filter: entry => {
        if (!entry.name.startsWith(root) || entry.name.includes('\\')
            || entry.name.split('/').some(part => part === '.' || part === '..' || part.startsWith('.'))) {
            throw new Error('The demo archive contains an unsafe path.');
        }
        if (entry.name.endsWith('/')) return false;
        if (!/\.(md|json|html|jpg|webp|png)$/i.test(entry.name)) throw new Error('The demo archive contains an unsupported file.');
        total += entry.originalSize;
        if (++count > 600 || total > 40 * 1024 * 1024) throw new Error('The demo archive exceeds the import limit.');
        return true;
    }});
    const source = new Map(Object.entries(decoded).map(([path, data]) => [path.slice(root.length), data]));
    const destination = demoProjectFolder(demo);
    const paths = new Set(source.keys());
    const aliases = new Map<string, string[]>();
    for (const path of paths) {
        const name = path.split('/').pop()!.replace(/\.md$/, '');
        aliases.set(name, [...(aliases.get(name) ?? []), path]);
    }
    function resolvePath(raw: string, required = false): string {
        const target = raw.replace(/\.md$/, '');
        const exact = paths.has(raw) ? raw : paths.has(`${raw}.md`) ? `${raw}.md` : undefined;
        const matches = aliases.get(target) ?? [];
        const path = exact ?? (matches.length === 1 ? matches[0] : undefined);
        if (!path && required) throw new Error(`Missing or ambiguous demo reference: ${raw}`);
        // Unresolved character/place links stay within the demo namespace as well.
        return `${destination}/${path ?? raw}`;
    }
    function rebaseWiki(text: string): string {
        return text.replace(/\[\[(.+?)\]\]/g, (_match, content: string) => {
            const separator = content.indexOf('|');
            const target = (separator < 0 ? content : content.slice(0, separator)).replace(/\\$/, '');
            const anchorAt = target.indexOf('#');
            const path = anchorAt < 0 ? target : target.slice(0, anchorAt);
            if (!path || /^[a-z]+:\/\//i.test(path)) return `[[${content}]]`;
            const anchor = anchorAt < 0 ? '' : target.slice(anchorAt);
            const escaped = separator > 0 && content[separator - 1] === '\\' ? '\\' : '';
            const alias = separator < 0 ? path.split('/').pop()!.replace(/\.md$/, '') : content.slice(separator + 1);
            return `[[${resolvePath(path).replace(/\.md$/, '')}${anchor}${escaped}|${alias}]]`;
        });
    }
    const files = new Map<string, Uint8Array>();
    const ids = new Set<string>();
    const indexedPaths: string[] = [];
    for (const [path, data] of source) {
        if (path === INQUIRY_SIDECAR_PATH) continue;
        if (path.endsWith('.md')) {
            const text = strFromU8(data);
            const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
            const fm = header ? parseYaml(header[1]) as Record<string, unknown> : {};
            if (fm.Class === 'Scene' || fm.Class === 'Beat') {
                if (typeof fm.ID !== 'string' || !fm.ID.trim() || ids.has(fm.ID)) throw new Error(`Invalid or duplicate ID in ${path}.`);
                ids.add(fm.ID);
                indexedPaths.push(`${destination}/${path}`);
            }
            files.set(path, strToU8(rebaseWiki(text)));
        } else files.set(path, data);
    }
    for (const book of demo.books) {
        if (!Array.from(paths).some(path => path.startsWith(`${book.sourceFolder}/`) && path.endsWith('.md'))) {
            throw new Error(`Missing manuscript: ${book.title}`);
        }
    }
    const artifact = source.get(INQUIRY_SIDECAR_PATH);
    const sessions = artifact ? parseSessionArtifact(strFromU8(artifact)) : null;
    if (!sessions?.length) throw new Error('The demo is missing its saved Inquiry briefings.');
    const bookFolders = new Set(demo.books.map(book => book.sourceFolder));
    for (const session of sessions) {
        const oldBook = session.activeBookId;
        if (!oldBook || !bookFolders.has(oldBook) || !session.key || !session.baseKey || !session.result) {
            throw new Error('A saved Inquiry briefing has an invalid book scope.');
        }
        const newBook = `${destination}/${oldBook}`;
        const number = bookNumbers.get(newBook);
        if (!number) throw new Error('The demo book has no registered position.');
        const oldLabel = session.result.scopeLabel;
        const newLabel = `B${number}`;
        // Rebase only reference metadata. Quotes, prose, scores and provenance stay intact.
        function rebaseMetadata(value: unknown): unknown {
            if (Array.isArray(value)) return value.map(rebaseMetadata);
            if (!value || typeof value !== 'object') return value;
            return Object.fromEntries(Object.entries(value).map(([key, item]) => {
                if (typeof item === 'string') {
                    if (['path', 'refPath', 'briefPath', 'logPath'].includes(key)) return [key, resolvePath(item, true)];
                    if (key === 'bookId' && bookFolders.has(item)) return [key, `${destination}/${item}`];
                    if (key === 'rawRef') return [key, rebaseWiki(item)];
                    if ((key === 'scopeLabel' || key === 'span') && item === oldLabel) return [key, newLabel];
                }
                return [key, rebaseMetadata(item)];
            }));
        }
        session.result = rebaseMetadata(session.result) as typeof session.result;
        session.activeBookId = newBook;
        const scopeMarker = `::book::${oldBook}::`;
        if (!session.key.includes(scopeMarker) || !session.baseKey.includes(scopeMarker)) throw new Error('Invalid saved Inquiry key.');
        session.key = session.key.replace(scopeMarker, `::book::${newBook}::`);
        session.baseKey = session.baseKey.replace(scopeMarker, `::book::${newBook}::`);
        if (session.briefPath) session.briefPath = resolvePath(session.briefPath, true);
        if (session.logPath) session.logPath = resolvePath(session.logPath, true);
        delete session.cacheWindowExpiresAt;
        delete session.cacheReuseFingerprint;
        delete session.cacheReuseState;
        delete session.providerCacheStatus;
        delete session.cachedStableRatio;
        delete session.cachedStableTokens;
        delete session.totalInputTokens;
    }
    files.set(INQUIRY_SIDECAR_PATH, strToU8(JSON.stringify(serializeSessionsToArtifact(sessions, Date.now(), {
        displayName: demo.title, bookFolder: demoBookDefinitions(demo)[0].sourceFolder
    }), null, 2)));
    const books = demoBookDefinitions(demo);
    const config = ['---', 'rt_sample_vault: true', 'schema_version: 1', `display_name: ${JSON.stringify(demo.title)}`,
        `book_folder: ${JSON.stringify(books[0].sourceFolder)}`, 'books:',
        ...books.flatMap(book => [`  - title: ${JSON.stringify(book.title)}`, `    source_folder: ${JSON.stringify(book.sourceFolder)}`]),
        '---', '', `# ${demo.title}`, '', 'This finished demo lives inside your vault. Select its book in Radial Timeline to explore the scenes, beats, Pulse, and Gossamer. Open Inquiry to browse the saved briefings; no API key is needed.', '',
        'New AI analysis requires enabling AI and configuring your own provider in Settings. For a collection, use the book selector to explore each novel.', ''].join('\n');
    files.set('Sample Vault Config.md', strToU8(config));
    return { files, ids, indexedPaths };
}
