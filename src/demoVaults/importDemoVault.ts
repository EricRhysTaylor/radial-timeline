import { Notice, parseYaml, requestUrl, TFile, TFolder } from 'obsidian';
import { strFromU8 } from 'fflate';
import type RadialTimelinePlugin from '../main';
import type { BonusVaultDef } from '../settings/bonusVaults';
import { demoBookDefinitions, demoProjectFolder, prepareDemoImport } from './demoImportPlan';
import { readSampleVaultManifest, registerSampleBookProfiles } from '../utils/sampleVault';
import { systemFolderPath } from '../utils/systemFolder';
import { INQUIRY_SIDECAR_PATH } from '../inquiry/InquiryArtifactStore';
import { parseSessionArtifact } from '../inquiry/sessionArtifact';
import { initializeSampleInquirySources } from '../inquiry/sampleInquirySources';

const importing = new WeakSet<RadialTimelinePlugin>();

async function ensureFolder(plugin: RadialTimelinePlugin, path: string): Promise<void> {
    let current = '';
    for (const segment of path.split('/')) {
        current = current ? `${current}/${segment}` : segment;
        const existing = plugin.app.vault.getAbstractFileByPath(current);
        if (existing && !(existing instanceof TFolder)) throw new Error(`A file blocks the demo folder: ${current}`);
        if (!existing) await plugin.app.vault.createFolder(current);
    }
}

/** A note's YAML header as a plain object, or undefined when it has none. */
function readYamlHeader(text: string): Record<string, unknown> | undefined {
    const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const value: unknown = header ? parseYaml(header[1]) : undefined;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function assertIdle(plugin: RadialTimelinePlugin): void {
    if (plugin._inquiryRunInFlight) throw new Error('Let the current Inquiry run finish before adding a demo.');
}

/** Wait only during an import/open, until Obsidian has read the Markdown files. */
async function awaitDemoIndex(plugin: RadialTimelinePlugin, paths: string[]): Promise<void> {
    const ready = () => paths.every(path => {
        const file = plugin.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile && !!plugin.app.metadataCache.getFileCache(file);
    });
    const deadline = Date.now() + 15000;
    while (!ready()) {
        if (Date.now() >= deadline) throw new Error('Obsidian did not finish indexing the demo files.');
        await new Promise(resolve => window.setTimeout(resolve, 100));
    }
}

async function openDemo(plugin: RadialTimelinePlugin, demo: BonusVaultDef): Promise<void> {
    assertIdle(plugin);
    const definitions = demoBookDefinitions(demo);
    const current = plugin.settings.books ?? [];
    const registration = registerSampleBookProfiles(current, definitions, definitions[0].sourceFolder);
    // Demo books must not silently become evidence in an author's existing saga.
    if (current.some(book => book.sourceFolder.trim() && !book.sourceFolder.startsWith('Demo Projects/'))) {
        const currentIds = new Set(current.map(book => book.id));
        for (const book of registration.books) if (!currentIds.has(book.id)) book.includeInSaga = false;
    }
    plugin.settings.books = registration.books;
    initializeSampleInquirySources(plugin.settings);
    await plugin.saveSettings();
    await plugin.setActiveBookId(registration.targetId);
    for (const view of plugin.getInquiryService().getInquiryViews()) await view.onDemoProjectsChanged();
    await plugin.getTimelineService().activateView();
}

/** One complete folder becomes visible at once; existing destinations are never replaced. */
export async function importDemoVault(
    plugin: RadialTimelinePlugin,
    demo: BonusVaultDef,
    report: (status: string) => void = () => undefined
): Promise<void> {
    if (importing.has(plugin)) throw new Error('Another demo is being added. Please wait for it to finish.');
    if (!demo.books?.length) throw new Error('This demo is not yet available.');
    importing.add(plugin);
    let staging: TFolder | null = null;
    let installed = false;
    try {
        assertIdle(plugin);
        const destination = demoProjectFolder(demo);
        const existing = plugin.app.vault.getAbstractFileByPath(destination);
        if (existing) {
            const manifest = plugin.app.vault.getAbstractFileByPath(`${destination}/Sample Vault Config.md`);
            if (!(existing instanceof TFolder) || !(manifest instanceof TFile)) throw new Error(`The folder ${destination} already exists and is not an installed demo. Nothing was changed.`);
            const header = readYamlHeader(await plugin.app.vault.read(manifest));
            const config = header ? readSampleVaultManifest(header) : null;
            const definitions = demoBookDefinitions(demo);
            if (config?.displayName !== demo.title || config.books?.length !== definitions.length
                || !definitions.every(book => config.books?.some(entry => entry.sourceFolder === book.sourceFolder))) {
                throw new Error('This folder does not match the demo collection. Nothing was changed.');
            }
            const sessionFile = plugin.app.vault.getAbstractFileByPath(`${destination}/${INQUIRY_SIDECAR_PATH}`);
            const sessions = sessionFile instanceof TFile ? parseSessionArtifact(await plugin.app.vault.read(sessionFile)) : null;
            if (!sessions?.length || !definitions.every(book => sessions.some(session => session.activeBookId === book.sourceFolder))) {
                throw new Error('This demo is missing its saved Inquiry briefings. Existing files were preserved.');
            }
            report('Opening your existing demo…');
            const manuscript = plugin.app.vault.getMarkdownFiles().filter(file => definitions.some(book => file.path.startsWith(`${book.sourceFolder}/`)));
            await awaitDemoIndex(plugin, manuscript.map(file => file.path));
            if (!manuscript.length) throw new Error('The demo manuscript folder is missing. Nothing was changed.');
            await openDemo(plugin, demo);
            return;
        }
        if (!demo.archive || demo.status !== 'available') throw new Error('This demo is not yet available.');
        report('Downloading the demo…');
        const response = await requestUrl({ url: demo.archive.url, method: 'GET' }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            if (/ERR_TIMED_OUT|timed?\s*out/i.test(message)) {
                throw new Error('The demo download timed out. Nothing was added. Choose Add demo to this vault to try again, or use Download ZIP.');
            }
            throw error;
        });
        if (response.status !== 200) throw new Error('The demo could not be downloaded. Please try again.');
        const registered = registerSampleBookProfiles(plugin.settings.books ?? [], demoBookDefinitions(demo), demoBookDefinitions(demo)[0].sourceFolder);
        const bookNumbers = new Map(registered.books.map((book, index) => [book.sourceFolder, index + 1]));
        report('Checking the download…');
        const plan = await prepareDemoImport(new Uint8Array(response.arrayBuffer), demo, bookNumbers);
        for (const file of plugin.app.vault.getMarkdownFiles()) {
            const fm: Record<string, unknown> | undefined = plugin.app.metadataCache.getFileCache(file)?.frontmatter
                ?? readYamlHeader(await plugin.app.vault.read(file));
            const id = fm?.ID;
            if (typeof id === 'string' && plan.ids.has(id)) throw new Error('A copy of this manuscript already exists in this vault. Open that book instead; nothing was added.');
        }
        assertIdle(plugin);
        report('Adding the demo files…');
        const stagingPath = systemFolderPath('Demo Imports', `${demo.id}-${crypto.randomUUID()}`);
        await ensureFolder(plugin, stagingPath);
        const stagingFolder = plugin.app.vault.getAbstractFileByPath(stagingPath);
        if (!(stagingFolder instanceof TFolder)) throw new Error('The demo could not be staged. Nothing was added.');
        staging = stagingFolder;
        for (const [path, bytes] of plan.files) {
            const target = `${stagingPath}/${path}`;
            await ensureFolder(plugin, target.slice(0, target.lastIndexOf('/')));
            if (/\.(md|json|html)$/.test(path)) await plugin.app.vault.create(target, strFromU8(bytes));
            else await plugin.app.vault.createBinary(target, new Uint8Array(bytes).buffer);
        }
        // Let Obsidian finish reading all staged Markdown before its paths
        // move. Renaming during those reads can leave metadata missing until reload.
        report('Indexing the demo files…');
        await awaitDemoIndex(plugin, Array.from(plan.files.keys())
            .filter(path => path.endsWith('.md')).map(path => `${stagingPath}/${path}`));
        assertIdle(plugin);
        await ensureFolder(plugin, 'Demo Projects');
        if (plugin.app.vault.getAbstractFileByPath(destination)) throw new Error('The destination appeared during import. Nothing was replaced.');
        await plugin.app.vault.rename(staging, destination);
        installed = true;
        staging = null;
        report('Preparing the timeline…');
        await awaitDemoIndex(plugin, plan.indexedPaths);
        await openDemo(plugin, demo);
        new Notice(`${demo.title} is ready to explore.`);
    } catch (error) {
        if (staging) await plugin.app.fileManager.trashFile(staging);
        if (installed) throw new Error(`The complete demo is saved. Choose Open demo to finish setup. ${error instanceof Error ? error.message : ''}`.trim());
        throw error;
    } finally {
        importing.delete(plugin);
    }
}
