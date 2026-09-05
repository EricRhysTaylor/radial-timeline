import { describe, expect, it } from 'vitest';
import * as fs from 'fs'; // SAFE: test-only filesystem fixture setup.
import * as os from 'os'; // SAFE: test-only temporary directory setup.
import * as path from 'path'; // SAFE: test-only fixture path setup.
import { TFile, TFolder, normalizePath } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { RadialTimelineSettings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { validatePandocLayout } from './exportFormats';
import {
    HOTFIX_ID_SPEC_DRIFT_OVERWRITE,
    ensureBundledLayoutInstalledForExport,
    ensureBundledPandocLayoutsRegistered,
    ensureSpecDrivenBundledFictionTemplatesCurrent,
    formatBundledFontInstallSummary,
    getVaultFontDir,
    getBundledPandocLayoutContent,
    getBundledPandocLayouts,
    installBundledPandocFonts,
    installBundledPandocLayouts,
    ensureManuscriptReferenceDocxInstalled,
    setPandocFontPathsForVault,
} from './pandocBundledLayouts';

function createPluginWithBundledLayout(layoutId: string): { plugin: RadialTimelinePlugin; layout: ReturnType<typeof getBundledPandocLayouts>[number] } {
    const layout = getBundledPandocLayouts().find(item => item.id === layoutId);
    if (!layout) throw new Error(`Missing bundled layout: ${layoutId}`);

    const files = new Map<string, { file: TFile; content: string }>();
    const folders = new Set<string>();
    // No font fixtures on disk: the font bytes are embedded in the bundle
    // (src/generated/embeddedAssets.ts), because Obsidian never installs a
    // plugin-folder asset tree. Install reads the embedded payload directly.
    const vaultBase = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-pandoc-vault-'));

    const vault = {
        adapter: {
            getBasePath: () => vaultBase,
        },
        getAbstractFileByPath: (input: string) => {
            const key = normalizePath(input);
            const entry = files.get(key);
            if (entry) return entry.file;
            if (folders.has(key)) return new TFolder(key);
            return null;
        },
        createFolder: async (input: string) => {
            const key = normalizePath(input);
            folders.add(key);
            return new TFolder(key);
        },
        create: async (input: string, content: string) => {
            const key = normalizePath(input);
            const file = new TFile(key);
            files.set(key, { file, content });
            return file;
        },
        read: async (file: TFile) => {
            const key = normalizePath(file.path);
            return files.get(key)?.content || '';
        },
        modify: async (file: TFile, content: string) => {
            const key = normalizePath(file.path);
            const existing = files.get(key);
            if (existing) {
                existing.content = content;
            } else {
                files.set(key, { file, content });
            }
        }
    } as unknown as RadialTimelinePlugin['app']['vault'];

    const settings: RadialTimelineSettings = {
        ...DEFAULT_SETTINGS,
        pandocFolder: 'Radial Timeline/Pandoc',
        pandocLayouts: [layout]
    };

    const plugin = {
        settings,
        app: { vault },
        saveSettings: async () => {}
    } as unknown as RadialTimelinePlugin;

    setPandocFontPathsForVault(plugin);

    return { plugin, layout };
}

describe('bundled pandoc layout export auto-install', () => {
    it('registers a four-layout bundled fiction set', () => {
        const fictionLayouts = getBundledPandocLayouts().filter(layout => layout.preset === 'novel');
        expect(fictionLayouts).toHaveLength(4);
        expect(fictionLayouts.map(layout => layout.name)).toEqual([
            'Basic',
            'Standard',
            'Professional',
            'Signature'
        ]);
        expect(fictionLayouts.map(layout => layout.path)).toEqual([
            'rt_classic_manuscript.tex',
            'rt_contemporary_literary.tex',
            'rt_signature_literary.tex',
            'rt_modern_classic.tex'
        ]);
        expect(fictionLayouts.map(layout => layout.tier)).toEqual(['free', 'free', 'pro', 'pro']);
        const modernClassic = fictionLayouts.find(layout => layout.id === 'bundled-fiction-modern-classic');
        expect(modernClassic?.usesModernClassicStructure).toBe(true);
        expect(modernClassic?.hasEpigraphs).toBe(true);
        const signature = fictionLayouts.find(layout => layout.id === 'bundled-fiction-signature-literary');
        expect(signature?.hasSceneOpenerHeadingOptions).toBe(true);
    });

    it('installs missing bundled .tex template and then validates successfully', async () => {
        const { plugin, layout } = createPluginWithBundledLayout('bundled-fiction-signature-literary');

        const before = validatePandocLayout(plugin, layout);
        expect(before.valid).toBe(false);

        const install = await ensureBundledLayoutInstalledForExport(plugin, layout);
        expect(install.installed).toBe(true);
        expect(install.failed).toBe(false);

        const after = validatePandocLayout(plugin, layout);
        expect(after.valid).toBe(true);
    });

    it('refreshes bundled font assets even when the .tex template is already installed', async () => {
        const { plugin, layout } = createPluginWithBundledLayout('bundled-fiction-contemporary-literary');
        const target = normalizePath(`${plugin.settings.pandocFolder}/${layout.path}`);
        const canonical = getBundledPandocLayoutContent(layout.id)!;
        const fontDir = path.join(getVaultFontDir()!, 'source-serif-4');

        await (plugin.app.vault as any).createFolder(plugin.settings.pandocFolder);
        await (plugin.app.vault as any).create(target, canonical);
        fs.rmSync(fontDir, { recursive: true, force: true });
        expect(fs.existsSync(path.join(fontDir, 'SourceSerif4-Regular.otf'))).toBe(false);

        const result = await ensureBundledLayoutInstalledForExport(plugin, layout);
        expect(result.installed).toBe(false);
        expect(result.failed).toBe(false);
        expect(fs.existsSync(path.join(fontDir, 'SourceSerif4-Regular.otf'))).toBe(true);
        expect(fs.existsSync(path.join(fontDir, 'SourceSerif4-BoldIt.otf'))).toBe(true);
    });

    it('canonical spec-driven content for each bundled fiction layout has the spec-generator semantic markers', () => {
        // Standard Manuscript / Contemporary Literary: scene-opener macro contract.
        for (const layoutId of ['bundled-fiction-classic-manuscript', 'bundled-fiction-contemporary-literary']) {
            const content = getBundledPandocLayoutContent(layoutId);
            expect(content).toBeTruthy();
            expect(content!).toContain('\\newcommand{\\rtSceneOpenerTitle}[1]');
            expect(content!).toContain('\\newcommand{\\rtSceneOpener}[1]');
            // Old hooks must not regress — they don't fire on \section*{}.
            expect(content!).not.toContain('\\preto\\section{\\clearpage\\thispagestyle{empty}}');
        }

        // Contemporary Literary: macro-driven running headers, no literal labels.
        const standard = getBundledPandocLayoutContent('bundled-fiction-classic-manuscript')!;
        const contemporary = getBundledPandocLayoutContent('bundled-fiction-contemporary-literary')!;
        // New font policy (vault → system, no IfFontExistsTF wrappers, no rt-font errors).
        expect(standard).toContain('\\setmainfont{Arial}');
        expect(standard).not.toContain('\\IfFontExistsTF');
        expect(standard).not.toContain('\\PackageError{rt-font}');
        expect(standard).not.toContain('Sorts Mill Goudy');
        // Contemporary: Source Serif 4 is the spec body font; the resolver
        // emits either a Path block (vault has files) or a plain \setmainfont
        // (system-only). Both forms are valid; we pin only that the font
        // family name is present and there are no legacy strict-policy artifacts.
        expect(contemporary).toContain('\\setmainfont{Source Serif 4}');
        expect(contemporary).not.toContain('\\IfFontExistsTF');
        expect(contemporary).not.toContain('\\PackageError{rt-font}');
        expect(contemporary).not.toContain('Charter');
        expect(contemporary).not.toContain('\\setmainfont{Arial}');
        expect(contemporary).not.toContain('Sorts Mill Goudy');
        expect(contemporary).toMatch(/\\fancyhead\[LE\]\{[^}]*\\BookTitle\}/);
        expect(contemporary).toMatch(/\\fancyhead\[RO\]\{[^}]*\\rtSceneRunningTitle\}/);
        expect(contemporary).not.toContain('\\nouppercase{title}');
        expect(contemporary).not.toContain('\\nouppercase{scene}');
        // Spec-driven chapter spacing now lives inside \rtChapter as
        // \vspace*{0.46\textheight} (the old \titlespacing*{\chapter} hook never
        // fired — assembler emits \rtChapter, not \chapter).
        expect(contemporary).toMatch(/\\newcommand\{\\rtChapter\}[^]*\\vspace\*\{0\.46\\textheight\}/);

        // Signature Literary / Contemporary Literary use symmetric margins.
        for (const layoutId of ['bundled-fiction-signature-literary', 'bundled-fiction-contemporary-literary']) {
            const content = getBundledPandocLayoutContent(layoutId)!;
            expect(content).toContain('  left=0.9in,');
            expect(content).toContain('  right=0.9in');
        }

        // Modern Classic: symmetric margins + assembled-macro contract.
        const modernClassic = getBundledPandocLayoutContent('bundled-fiction-modern-classic')!;
        expect(modernClassic).toContain('  left=0.98in,');
        expect(modernClassic).toContain('  right=0.98in');
        expect(modernClassic).toContain('\\newcommand{\\rtPart}[4]');
        expect(modernClassic).not.toContain('\\newcommand{\\rtEpigraph}[2]');
        expect(modernClassic).toContain('\\rule{0.46in}{0.4pt}');
        expect(modernClassic).toContain('\\begin{minipage}{\\textwidth}');
        expect(modernClassic).not.toContain('\\begin{minipage}{0.86\\textwidth}');
        expect(modernClassic).not.toContain('\\begin{minipage}{0.68\\textwidth}');
        expect(modernClassic).not.toContain('PART~#1');
        expect(modernClassic).toContain('{\\normalfont\\bfseries\\Large #1}\\par');
        expect(modernClassic).toContain('\\newcommand{\\rtChapter}[2]');
        expect(modernClassic).toContain('{\\normalfont\\bfseries\\small Chapter~#1}\\par');
        expect(modernClassic).toContain('{\\normalfont\\LARGE #2}\\par');
        expect(modernClassic).not.toContain('{\\normalfont\\itshape\\Large #2}\\par');
        expect(modernClassic).toContain('\\newcommand{\\rtSceneSep}[1]');
        expect(modernClassic).toMatch(/\\newcommand\{\\rtSceneSep\}\[1\][^]*\\thispagestyle\{rtEmpty\}/);
        expect(modernClassic).toContain('\\errmessage{Radial Timeline export requires Pandoc metadata: title}');
        expect(modernClassic).toContain('\\errmessage{Radial Timeline export requires Pandoc metadata: author}');
        expect(modernClassic).toContain('\\newcommand{\\BookTitle}{$if(title)$$title$$endif$}');
        expect(modernClassic).toContain('\\newcommand{\\AuthorName}{$if(author)$$for(author)$$author$$sep$, $endfor$$endif$}');
        expect(modernClassic).not.toContain('Untitled Manuscript');
        expect(modernClassic).not.toContain('$else$Author');
        // Unsafe legacy chapter titleformat must not regress.
        expect(modernClassic).not.toContain('\\titleformat{\\chapter}[display]{\\normalfont}{}{0pt}{%');
        expect(modernClassic).not.toContain('Chapter~\\thechapter');
    });

    it('spec-driven fiction templates do not switch away from the configured main font family', () => {
        for (const layoutId of [
            'bundled-fiction-classic-manuscript',
            'bundled-fiction-contemporary-literary',
            'bundled-fiction-signature-literary',
            'bundled-fiction-modern-classic',
        ]) {
            const content = getBundledPandocLayoutContent(layoutId)!;
            expect(content).not.toMatch(/\\begin\{minipage\}\{0\.\d+\\textwidth\}/);
            expect(content).not.toContain('\\sffamily');
            expect(content).not.toContain('\\rmfamily');
            expect(content).not.toContain('\\ttfamily');
        }
    });

    /**
     * Drift-detect: stale on-disk content for a spec-driven fiction layout is
     * overwritten with the canonical generator output on plugin load. The
     * single hotfix-history entry under id `spec-drift-overwrite-v1` triggers
     * the synthetic template and matter update alert.
     */
    it('drift-detect: overwrites stale on-disk content with canonical spec output and records one history entry', async () => {
        const { plugin, layout } = createPluginWithBundledLayout('bundled-fiction-contemporary-literary');
        const target = normalizePath(`${plugin.settings.pandocFolder}/${layout.path}`);
        const stale = '% stale\n';

        await (plugin.app.vault as any).createFolder(plugin.settings.pandocFolder);
        await (plugin.app.vault as any).create(target, stale);

        const result = await ensureBundledLayoutInstalledForExport(plugin, layout);
        expect(result.installed).toBe(false);
        expect(result.failed).toBe(false);

        const file = plugin.app.vault.getAbstractFileByPath(target) as TFile;
        const updated = await (plugin.app.vault as any).read(file);
        const canonical = getBundledPandocLayoutContent(layout.id);
        expect(updated).toBe(canonical);

        const history = plugin.settings.templateHotfixHistory ?? [];
        expect(history).toHaveLength(1);
        expect(history[0].layoutId).toBe(layout.id);
        expect(history[0].hotfixId).toBe(HOTFIX_ID_SPEC_DRIFT_OVERWRITE);
        expect(history[0].acknowledged).toBe(false);
    });

    it('drift-detect no-op: on-disk content already matches canonical → no rewrite, no history entry', async () => {
        const { plugin, layout } = createPluginWithBundledLayout('bundled-fiction-contemporary-literary');
        const target = normalizePath(`${plugin.settings.pandocFolder}/${layout.path}`);

        // Pre-install fonts so the canonical the resolver generates with
        // current vault state matches what the drift-detect step will compute
        // after `installBundledPandocFonts` runs in the same scope.
        await (plugin.app.vault as any).createFolder(plugin.settings.pandocFolder);
        await ensureBundledLayoutInstalledForExport(plugin, layout);

        const installedFile = plugin.app.vault.getAbstractFileByPath(target) as TFile;
        const canonical = await (plugin.app.vault as any).read(installedFile);

        // Now the on-disk content should be byte-stable across a second
        // install attempt — no rewrite, no history entry.
        const result = await ensureBundledLayoutInstalledForExport(plugin, layout);
        expect(result.installed).toBe(false);
        expect(result.failed).toBe(false);

        const file = plugin.app.vault.getAbstractFileByPath(target) as TFile;
        const after = await (plugin.app.vault as any).read(file);
        expect(after).toBe(canonical);

        expect(plugin.settings.templateHotfixHistory ?? []).toEqual([]);
    });

    it('drift-detect per-layout: stale Contemporary + up-to-date Standard yields exactly one history entry', async () => {
        const { plugin, layout: contemporary } = createPluginWithBundledLayout('bundled-fiction-contemporary-literary');
        const standard = getBundledPandocLayouts().find(item => item.id === 'bundled-fiction-classic-manuscript')!;
        // Register both layouts in the plugin so the orchestrator can see both.
        plugin.settings.pandocLayouts = [contemporary, standard];

        const contemporaryTarget = normalizePath(`${plugin.settings.pandocFolder}/${contemporary.path}`);
        const standardTarget = normalizePath(`${plugin.settings.pandocFolder}/${standard.path}`);
        const standardCanonical = getBundledPandocLayoutContent(standard.id)!;

        await (plugin.app.vault as any).createFolder(plugin.settings.pandocFolder);
        await (plugin.app.vault as any).create(contemporaryTarget, '% stale\n');
        await (plugin.app.vault as any).create(standardTarget, standardCanonical);

        await ensureBundledLayoutInstalledForExport(plugin, contemporary);
        await ensureBundledLayoutInstalledForExport(plugin, standard);

        const history = plugin.settings.templateHotfixHistory ?? [];
        expect(history).toHaveLength(1);
        expect(history[0].layoutId).toBe(contemporary.id);
        expect(history[0].hotfixId).toBe(HOTFIX_ID_SPEC_DRIFT_OVERWRITE);
    });

    it('hand-coded non-spec layouts (screenplay, podcast) are not drift-detected: on-disk content is preserved', async () => {
        for (const layoutId of ['bundled-screenplay', 'bundled-podcast']) {
            const { plugin, layout } = createPluginWithBundledLayout(layoutId);
            const target = normalizePath(`${plugin.settings.pandocFolder}/${layout.path}`);
            const userEdit = '% user-edited content for ' + layoutId + '\n';

            await (plugin.app.vault as any).createFolder(plugin.settings.pandocFolder);
            await (plugin.app.vault as any).create(target, userEdit);

            await ensureBundledLayoutInstalledForExport(plugin, layout);

            const file = plugin.app.vault.getAbstractFileByPath(target) as TFile;
            const after = await (plugin.app.vault as any).read(file);
            // Drift-detect skipped: hand-coded layouts are not in the spec-driven set.
            expect(after).toBe(userEdit);
            expect(plugin.settings.templateHotfixHistory ?? []).toEqual([]);
        }
    });

    it('migrates legacy bundled signature ids/paths and avoids duplicate bundled entries', () => {
        const { plugin } = createPluginWithBundledLayout('bundled-fiction-signature-literary');
        plugin.settings.pandocLayouts = [
            {
                id: 'bundled-novel',
                name: 'Novel Manuscript (ST)',
                preset: 'novel',
                path: 'signature_literary_rt.tex',
                bundled: true
            },
            {
                id: 'bundled-fiction-signature-literary',
                name: 'Signature Literary',
                preset: 'novel',
                path: 'rt_signature_literary.tex',
                bundled: true
            }
        ];

        const changed = ensureBundledPandocLayoutsRegistered(plugin);
        expect(changed).toBe(true);

        const bundledFiction = (plugin.settings.pandocLayouts || [])
            .filter(layout => layout.bundled && layout.preset === 'novel');
        expect(bundledFiction).toHaveLength(4);
        expect(bundledFiction.map(layout => layout.id).sort()).toEqual([
            'bundled-fiction-classic-manuscript',
            'bundled-fiction-contemporary-literary',
            'bundled-fiction-modern-classic',
            'bundled-fiction-signature-literary'
        ]);

        const signature = bundledFiction.find(layout => layout.id === 'bundled-fiction-signature-literary');
        expect(signature?.name).toBe('Professional');
        expect(signature?.path).toBe('rt_signature_literary.tex');
    });

    /**
     * Regression: when the on-disk `.tex` for a spec-driven fiction template
     * diverged from the canonical generator output (legacy literal `title`
     * /`scene` running-header text, stale chapter spacing, anything an
     * in-flight session edit may have left behind), `installBundledPandocLayouts`
     * used to skip with `alreadyPresent` and leave the corruption in place.
     * The drift-detect path overwrites stale fiction templates so install
     * is self-healing — users don't need to manually delete vault files.
     */
    it('installBundledPandocLayouts drift-detects and overwrites stale on-disk content for spec-driven fiction templates', async () => {
        const { plugin, layout } = createPluginWithBundledLayout('bundled-fiction-contemporary-literary');
        const target = normalizePath(`${plugin.settings.pandocFolder}/${layout.path}`);
        const stale = [
            '% Pandoc LaTeX Template - Contemporary Literary',
            '\\fancyhead[LE]{\\sffamily\\footnotesize\\nouppercase{title}}',
            '\\fancyhead[RO]{\\sffamily\\footnotesize\\nouppercase{scene}}',
            '\\titlespacing*{\\chapter}{0pt}{0.18\\textheight}{0.14\\textheight}',
        ].join('\n');

        await (plugin.app.vault as any).createFolder(plugin.settings.pandocFolder);
        await (plugin.app.vault as any).create(target, stale);

        const result = await installBundledPandocLayouts(plugin, [layout.id]);
        expect(result.failed).toEqual([]);
        // Should have overwritten (counted as installed), not skipped as alreadyPresent.
        expect(result.installed).toContain(layout.name);
        expect(result.alreadyPresent).not.toContain(layout.name);

        const file = plugin.app.vault.getAbstractFileByPath(target) as TFile;
        const updated = await (plugin.app.vault as any).read(file);
        const canonical = getBundledPandocLayoutContent(layout.id);
        expect(updated).toBe(canonical);
    });

    it('installBundledPandocLayouts does NOT overwrite when on-disk content already matches the canonical spec output', async () => {
        const { plugin, layout } = createPluginWithBundledLayout('bundled-fiction-contemporary-literary');
        const target = normalizePath(`${plugin.settings.pandocFolder}/${layout.path}`);

        // Install once to land canonical content.
        await (plugin.app.vault as any).createFolder(plugin.settings.pandocFolder);
        const first = await installBundledPandocLayouts(plugin, [layout.id]);
        expect(first.installed).toContain(layout.name);

        // Re-install — should report alreadyPresent (no drift, no overwrite).
        const second = await installBundledPandocLayouts(plugin, [layout.id]);
        expect(second.installed).toEqual([]);
        expect(second.alreadyPresent).toContain(layout.name);

        // File still exists.
        expect(plugin.app.vault.getAbstractFileByPath(target)).toBeInstanceOf(TFile);
    });

    it('startup sync installs missing fiction templates and overwrites stale RT-owned fiction templates', async () => {
        const { plugin, layout } = createPluginWithBundledLayout('bundled-fiction-contemporary-literary');
        const target = normalizePath(`${plugin.settings.pandocFolder}/${layout.path}`);

        await (plugin.app.vault as any).createFolder(plugin.settings.pandocFolder);
        await (plugin.app.vault as any).create(target, '% stale contemporary\n');

        const result = await ensureSpecDrivenBundledFictionTemplatesCurrent(plugin);

        expect(result.failed).toEqual([]);
        expect(result.updated).toContain(layout.name);
        expect(result.installed.length).toBeGreaterThanOrEqual(3);

        const file = plugin.app.vault.getAbstractFileByPath(target) as TFile;
        const updated = await (plugin.app.vault as any).read(file);
        expect(updated).toBe(getBundledPandocLayoutContent(layout.id));

        const modernClassic = getBundledPandocLayouts().find(item => item.id === 'bundled-fiction-modern-classic')!;
        const modernClassicTarget = normalizePath(`${plugin.settings.pandocFolder}/${modernClassic.path}`);
        expect(plugin.app.vault.getAbstractFileByPath(modernClassicTarget)).toBeInstanceOf(TFile);
        const vaultBase = (plugin.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath(); // SAFE: test asserts the desktop vault base path used for local font installation.
        expect(fs.existsSync(path.join(vaultBase, plugin.settings.pandocFolder, 'fonts/source-serif-4/SourceSerif4-Regular.otf'))).toBe(true);
        expect(fs.existsSync(path.join(vaultBase, plugin.settings.pandocFolder, 'fonts/sorts-mill-goudy/SortsMillGoudy-Regular.ttf'))).toBe(true);
        // Latin Modern is deliberately not bundled — it comes from the TeX
        // distribution, so nothing should be written into the vault for it.
        expect(fs.existsSync(path.join(vaultBase, plugin.settings.pandocFolder, 'fonts/latin-modern'))).toBe(false);

        const history = plugin.settings.templateHotfixHistory ?? [];
        expect(history).toHaveLength(1);
        expect(history[0].layoutId).toBe(layout.id);
        expect(history[0].hotfixId).toBe(HOTFIX_ID_SPEC_DRIFT_OVERWRITE);
    });

    /**
     * Regression for GH #29 (part 2): the "Install" Notice must never claim
     * fonts were installed when the on-disk result doesn't actually match the
     * source byte-for-byte. Simulates a silently truncated write (the real
     * failure mode a full disk or interrupted copy would produce) and
     * verifies every affected family is reported as failed, not installed.
     */
    it('never reports a font family as installed/already-present when its files cannot be written', async () => {
        const { plugin } = createPluginWithBundledLayout('bundled-fiction-contemporary-literary');
        const vaultBase = (plugin.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath(); // SAFE: test asserts against the desktop vault base path used for local font installation.
        // Simulate the real-world failure mode this guards against: the
        // family's destination cannot be created because a plain file already
        // occupies the path. mkdirSync throws, so nothing is written — and
        // the family must be reported failed rather than silently succeeding.
        const fontRoot = path.join(vaultBase, plugin.settings.pandocFolder, 'fonts');
        fs.mkdirSync(fontRoot, { recursive: true });
        fs.writeFileSync(path.join(fontRoot, 'source-serif-4'), 'not a directory');

        const result = await installBundledPandocFonts(plugin);

        expect(result.installed.find(f => f.family === 'source-serif-4')).toBeUndefined();
        expect(result.alreadyPresent.find(f => f.family === 'source-serif-4')).toBeUndefined();
        expect(result.failed).toContain('source-serif-4');
        // Unaffected families must still succeed — one broken family
        // shouldn't cascade into failing everything.
        expect(result.failed).not.toContain('sorts-mill-goudy');
        expect(result.installed.some(f => f.family === 'sorts-mill-goudy')).toBe(true);
    });

    /**
     * Regression for GH #34: the font bytes must come from the bundle, not
     * from a plugin-folder asset tree. Obsidian installs only manifest.json /
     * main.js / styles.css from a release, so an install path that reads
     * `<plugin>/assets/fonts` works on a dev machine and fails for every
     * Community-Plugins user. Nothing may be read from the plugin folder.
     */
    it('installs fonts with no plugin-folder asset tree present', async () => {
        const { plugin } = createPluginWithBundledLayout('bundled-fiction-contemporary-literary');
        const vaultBase = (plugin.app.vault.adapter as unknown as { getBasePath: () => string }).getBasePath(); // SAFE: test asserts against the desktop vault base path used for local font installation.
        // Exactly the state of a real install: the plugin folder holds no
        // assets directory at all.
        expect(fs.existsSync(path.join(vaultBase, '.obsidian/plugins/radial-timeline/assets'))).toBe(false);

        const result = await installBundledPandocFonts(plugin);

        expect(result.failed).toEqual([]);
        const regular = path.join(vaultBase, plugin.settings.pandocFolder, 'fonts/source-serif-4/SourceSerif4-Regular.otf');
        expect(fs.existsSync(regular)).toBe(true);
        expect(fs.statSync(regular).size).toBeGreaterThan(1000);
        // The OFL requires the licence to travel with a redistributed font.
        expect(fs.existsSync(path.join(vaultBase, plugin.settings.pandocFolder, 'fonts/source-serif-4/LICENSE.md'))).toBe(true);
        expect(fs.existsSync(path.join(vaultBase, plugin.settings.pandocFolder, 'fonts/sorts-mill-goudy/OFL.txt'))).toBe(true);
    });

    /**
     * Regression for GH #34 (Word half): the reference document must also
     * come from the bundle. This previously failed with "Missing bundled
     * asset: …/assets/pandoc/reference-manuscript.docx" for every user who
     * installed through the Community Plugins browser.
     */
    it('writes the Word reference document with no plugin-folder asset tree present', () => {
        const { plugin } = createPluginWithBundledLayout('bundled-fiction-contemporary-literary');

        const result = ensureManuscriptReferenceDocxInstalled(plugin);

        expect(result.error).toBeUndefined();
        expect(result.path).toBeTruthy();
        expect(fs.existsSync(result.path!)).toBe(true);
        // A real .docx is a ZIP container — verify we wrote the actual
        // binary, not a truncated or text-decoded copy.
        const header = fs.readFileSync(result.path!).subarray(0, 2).toString('latin1');
        expect(header).toBe('PK');
        expect(fs.statSync(result.path!).size).toBeGreaterThan(1000);
    });

    /**
     * Regression for GH #29 (part 3): the success Notice must be able to show
     * the user exactly which files landed, their real on-disk size, and
     * where — not just the word "installed". LICENSE/README text files that
     * are copied alongside source-serif-4 must not be reported as if they
     * were fonts.
     */
    it('reports installed font files with their verified on-disk size and absolute folder location', async () => {
        const { plugin } = createPluginWithBundledLayout('bundled-fiction-contemporary-literary');

        const result = await installBundledPandocFonts(plugin);

        expect(result.failed).toEqual([]);
        expect(result.targetRoot).toBeTruthy();
        expect(result.targetRoot).toContain('fonts');

        const sourceSerif = result.installed.find(f => f.family === 'source-serif-4');
        expect(sourceSerif).toBeTruthy();
        const regular = sourceSerif!.files.find(f => f.file === 'SourceSerif4-Regular.otf');
        expect(regular).toBeTruthy();
        expect(regular!.sizeBytes).toBeGreaterThan(0);
        // absolutePath must point at the exact file whose size we just
        // verified — this is what the Settings pill's "reveal in Finder"
        // click action opens, so it must resolve to a real file, not just
        // the family folder.
        expect(regular!.absolutePath).toBe(path.join(result.targetRoot!, 'source-serif-4', 'SourceSerif4-Regular.otf'));
        expect(fs.existsSync(regular!.absolutePath)).toBe(true);
        expect(fs.statSync(regular!.absolutePath).size).toBe(regular!.sizeBytes);
        // LICENSE.md/README.md are copied alongside this family but must
        // never be listed as if they were font files.
        expect(sourceSerif!.files.some(f => f.file === 'LICENSE.md' || f.file === 'README.md')).toBe(false);

        const summary = formatBundledFontInstallSummary(result);
        expect(summary).toContain('source-serif-4/');
        expect(summary).toContain('SourceSerif4-Regular.otf');
        expect(summary).toContain('Location:');
        expect(summary).toContain(result.targetRoot!);
        expect(summary).not.toContain('LICENSE.md');
    });

    it('seeds the registry so install-all leaves all bundled fiction layouts validating', async () => {
        const { plugin } = createPluginWithBundledLayout('bundled-fiction-signature-literary');
        plugin.settings.pandocLayouts = [];

        const result = await installBundledPandocLayouts(plugin);
        expect(result.failed).toEqual([]);
        expect(result.installed.length).toBeGreaterThan(0);

        const changed = ensureBundledPandocLayoutsRegistered(plugin);
        expect(changed).toBe(true);

        const fictionLayouts = (plugin.settings.pandocLayouts || []).filter(layout => layout.preset === 'novel');
        expect(fictionLayouts).toHaveLength(4);

        for (const layout of fictionLayouts) {
            expect(validatePandocLayout(plugin, layout).valid).toBe(true);
        }
    });
});
