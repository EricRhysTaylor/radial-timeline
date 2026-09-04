/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Starter setup — the writes behind "Auto configure publishing": find the
 * toolchain, make sure the Pandoc folder exists, install bundled layouts and
 * fonts, and create the starter Book Details / inline-LaTeX matter notes.
 * Also owns the template-path helpers that decide where a layout's .tex file
 * lives in the vault. Reads of the active book's notes live in
 * `activeBookNotes.ts`.
 */

import { normalizePath, TFile, TFolder } from 'obsidian';
import { createHash } from 'crypto'; // SAFE: exact retired starter sample fingerprinting
import type RadialTimelinePlugin from '../main';
import { getPandocFolder } from '../utils/exportFormats';
import { compactTemplatePathForStorage, isAbsolutePath } from '../utils/templateImport';
import { getActiveBookExportContext } from '../utils/exportContext';
import { resolveManuscriptOutputFolder } from '../utils/aiOutput';
import {
    ensureBundledLayoutInstalledForExport,
    ensureBundledPandocLayoutsRegistered,
    getBundledPandocLayouts,
    installBundledPandocLayouts
} from '../utils/pandocBundledLayouts';
import { isPandocPathValid, scanSystemPaths } from './toolchainScan';

// ── Vault folders ────────────────────────────────────────────────────────────

/** Create every missing segment of a vault folder path. Throws if a file already sits at any segment. */
export async function ensureVaultFolderPath(plugin: RadialTimelinePlugin, folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath.trim().replace(/^\/+/, ''));
    if (!normalized) return;
    let current = '';
    for (const segment of normalized.split('/').filter(Boolean)) {
        current = current ? `${current}/${segment}` : segment;
        const existing = plugin.app.vault.getAbstractFileByPath(current);
        if (existing instanceof TFolder) continue;
        if (existing) throw new Error(`Cannot create folder "${current}" because a file exists at that path.`);
        await plugin.app.vault.createFolder(current);
    }
}

// ── Template paths ───────────────────────────────────────────────────────────

/** Vault paths where a stored template path may resolve, Pandoc-folder-prefixed form first. */
export function buildTemplatePathCandidates(plugin: RadialTimelinePlugin, rawPath: string): string[] {
    const trimmed = rawPath.trim();
    if (!trimmed || isAbsolutePath(trimmed)) return [];
    const normalized = normalizePath(trimmed.replace(/^\/+/, ''));
    if (!normalized) return [];
    const pandocFolder = getPandocFolder(plugin);
    const prefixed = normalizePath(`${pandocFolder}/${normalized}`);
    if (!normalized.startsWith(`${pandocFolder}/`) && prefixed !== normalized) {
        return [prefixed, normalized];
    }
    return [normalized];
}

export function resolveExistingTemplateVaultPath(plugin: RadialTimelinePlugin, rawPath: string): string | null {
    for (const candidate of buildTemplatePathCandidates(plugin, rawPath)) {
        if (plugin.app.vault.getAbstractFileByPath(candidate) instanceof TFile) return candidate;
    }
    return null;
}

/** Where a new stored template path should be written: bare filenames go under the Pandoc folder. */
export function resolveTargetTemplateVaultPath(plugin: RadialTimelinePlugin, rawPath: string): string | null {
    const trimmed = rawPath.trim();
    if (!trimmed || isAbsolutePath(trimmed)) return null;
    const normalized = normalizePath(trimmed.replace(/^\/+/, ''));
    if (!normalized) return null;
    const pandocFolder = getPandocFolder(plugin);
    if (normalized.startsWith(`${pandocFolder}/`)) return normalized;
    if (normalized.includes('/')) return normalized;
    return normalizePath(`${pandocFolder}/${normalized}`);
}

/**
 * When a layout's stored path is edited to a new .tex name and the old file
 * exists in the vault, rename the file to follow it. Returns true on rename.
 */
export async function maybeRenameTemplateFileForPathChange(
    plugin: RadialTimelinePlugin,
    previousStoredPath: string,
    nextStoredPath: string
): Promise<boolean> {
    const previous = compactTemplatePathForStorage(plugin, previousStoredPath);
    const next = compactTemplatePathForStorage(plugin, nextStoredPath);
    if (!previous || !next || previous === next) return false;
    if (!/\.tex$/i.test(next)) return false;

    const sourceVaultPath = resolveExistingTemplateVaultPath(plugin, previous);
    if (!sourceVaultPath) return false;
    const targetVaultPath = resolveTargetTemplateVaultPath(plugin, next);
    if (!targetVaultPath) return false;
    if (normalizePath(targetVaultPath) === normalizePath(sourceVaultPath)) return false;
    if (plugin.app.vault.getAbstractFileByPath(targetVaultPath)) return false;

    const sourceFile = plugin.app.vault.getAbstractFileByPath(sourceVaultPath);
    if (!(sourceFile instanceof TFile)) return false;

    const slashIndex = targetVaultPath.lastIndexOf('/');
    const targetFolder = slashIndex > 0 ? targetVaultPath.slice(0, slashIndex) : '';
    if (targetFolder) await ensureVaultFolderPath(plugin, targetFolder);
    await plugin.app.fileManager.renameFile(sourceFile, targetVaultPath);
    return true;
}

// ── Environment ──────────────────────────────────────────────────────────────

export interface PublishingEnvironmentResult {
    pandocFound: boolean;
    latexFound: boolean;
    templatesInstalled: number;
    folderReady: boolean;
    issues: string[];
}

/** Detect Pandoc/LaTeX, ensure the Pandoc folder, install bundled layouts + fonts, register them, save. */
export async function ensurePublishingEnvironment(plugin: RadialTimelinePlugin): Promise<PublishingEnvironmentResult> {
    const issues: string[] = [];
    let pandocFound = false;
    let latexFound = false;
    let templatesInstalled = 0;
    let folderReady = false;

    const pandocAlreadyValid = (plugin.settings.pandocPath || '').trim().length > 0
        && isPandocPathValid(plugin.settings.pandocPath);
    const scan = await scanSystemPaths();

    if (pandocAlreadyValid) {
        pandocFound = true;
    } else if (scan.pandocPath) {
        plugin.settings.pandocPath = scan.pandocPath;
        pandocFound = true;
    } else {
        issues.push('Pandoc not found — install from pandoc.org');
    }

    if (scan.latexPath) {
        latexFound = true;
    } else {
        issues.push('LaTeX not found — install to enable PDF export');
    }

    const pandocFolder = getPandocFolder(plugin);
    try {
        await ensureVaultFolderPath(plugin, pandocFolder);
        folderReady = true;
    } catch (e) {
        issues.push(`Could not create Pandoc folder: ${(e as Error).message}`);
    }

    if (folderReady) {
        const result = await installBundledPandocLayouts(plugin);
        templatesInstalled = result.installed.length;
        if (result.failed.length > 0) {
            issues.push(`Failed to install templates: ${result.failed.join(', ')}`);
        }
        if (result.fonts.failed.length > 0) {
            issues.push(`Failed to install bundled fonts: ${result.fonts.failed.join(', ')}. PDF export will fall back to system fonts where available.`);
        }
        for (const layout of getBundledPandocLayouts()) {
            const refresh = await ensureBundledLayoutInstalledForExport(plugin, layout);
            if (refresh.failed) issues.push(`Failed to refresh template: ${layout.name}`);
        }
    }

    ensureBundledPandocLayoutsRegistered(plugin);
    await plugin.saveSettings();
    return { pandocFound, latexFound, templatesInstalled, folderReady, issues };
}

// ── Starter notes ────────────────────────────────────────────────────────────

export const BOOK_META_NOTE_NAME = '000 BookMeta.md';

/** The starter Book Details note: every field the publishing pipeline reads, with placeholder values. */
export function buildBookMetaSampleContent(year: number): string {
    return [
        '---',
        'Class: BookMeta',
        'Book:',
        '  title: "Untitled Manuscript"',
        '  subtitle: ""',
        '  author: "Author"',
        'Rights:',
        '  copyright_holder: "Copyright Holder"',
        `  year: ${year}`,
        'Identifiers:',
        '  isbn_paperback: "000-0-00-000000-0"',
        'Publisher:',
        '  name: "Publisher"',
        '  imprint: "Imprint"',
        '  edition: "1"',
        'Frontmatter:',
        '  title_page_note: ""',
        '  dedication: ""',
        '  epigraph_quote: ""',
        '  epigraph_attribution: ""',
        'Backmatter:',
        '  acknowledgments: ""',
        '  about_author: ""',
        '  author_note: ""',
        '  other_works: ""',
        'Production:',
        '  imprint: "Imprint"',
        '  edition: "1"',
        '  print_location: "City, Country"',
        '---',
        ''
    ].join('\n');
}

export interface CreateBookMetaResult {
    created: boolean;
    path?: string;
    reason?: string;
}

/** Create the starter Book Details note in the active book's source folder unless one is already there. */
export async function createBookMetaOnly(plugin: RadialTimelinePlugin): Promise<CreateBookMetaResult> {
    const sourceFolder = getActiveBookExportContext(plugin).sourceFolder.trim();
    if (!sourceFolder) return { created: false, reason: 'Active book source folder is not set.' };

    const vault = plugin.app.vault;
    const normalizedFolder = normalizePath(sourceFolder);
    await ensureVaultFolderPath(plugin, normalizedFolder);

    const bookMetaPath = normalizePath(`${normalizedFolder}/${BOOK_META_NOTE_NAME}`);
    if (vault.getAbstractFileByPath(bookMetaPath)) {
        return { created: false, path: bookMetaPath, reason: 'Book Details already exists.' };
    }
    await vault.create(bookMetaPath, buildBookMetaSampleContent(new Date().getFullYear()));
    return { created: true, path: bookMetaPath };
}

export interface StarterPublishingSetupResult {
    created: string[];
    updatedGenerated: string[];
    skippedExisting: string[];
}

// Earlier releases shipped these exact sample bodies. A note whose content
// still hashes to one of them is ours to refresh; anything else is the
// author's and is left alone.
const RETIRED_BUNDLED_PERSONAL_MATTER_SAMPLE_HASHES_BY_NAME: Record<string, readonly string[]> = {
    '0.1 Alpha Readers.md': ['92a58ee02a57c6e631e219fe377905176ca2fa237b642cbeb98df05131829cf9'],
    '0.2 Title Page.md': ['96b65423ba74a9bc39c22d4f760d912e558cc17524c080967656a20a0bed9ab1'],
    '0.3 Copyright.md': ['458479c8c5a1dc88c2111fde4af4131846d96412eaf0364c88190707aa7d5de6'],
    '0.4 Dedication.md': ['3767f96f1364ba2b6a6508d33d196ee3ff3769d5c14f4d8dd098ee0bb0a51c5f'],
    '0.5 Epigraph.md': ['4dcdd0b12ce7a3b39dfd2f265b774fd634571fe6beda6985ffd95b9186aa9058'],
    '0.6 Title 2.md': ['b2763cabbb18edfd6f26fb8404ca11841ab316314cb129d3e1d2c9bc58977f5b'],
    '0.7 Quotation.md': ['67b7659c5ad7265faa5b7ccd3c9df8dd58518fd0c135c0e22d04d18d57350408'],
    '0.8 Quotation 2.md': ['dba0ee40c15bc3100d735b0742bb21f705e1aa681230e62040d0962b316555c7'],
    '0.9 Quotation 3.md': ['d36d9878a918effc060bf5c18710219cc6d498d5c0518c2d2fa7c478455ec62b'],
    '200.1 Acknowledgments.md': ['22fc13c6ce137a5c53ddc29ff90ebeccb85f48c402576c25e83e2ed30dd587a5'],
    '200.2 About the Author.md': ['6c8c14aa4f01caf826bc1525d13ea7a5ce3050cc610d0664aef7cc66ea9864f8'],
};

function sha256Hex(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** True when a note body is byte-for-byte one of the sample bodies an earlier release generated. */
export function isRetiredBundledPersonalMatterSample(name: string, content: string): boolean {
    return RETIRED_BUNDLED_PERSONAL_MATTER_SAMPLE_HASHES_BY_NAME[name]?.includes(sha256Hex(content)) ?? false;
}

const LATEX_MATTER_COMMENT = [
    '<!--',
    'Optional inline LaTeX Book Pages example.',
    'This file is only an illustration of inline LaTeX and may be deleted at any time.',
    'Book matter does not require a physical note file.',
    'Regular title, copyright, dedication, epigraph, acknowledgments, and author pages can render directly from Book Details without note files.',
    'Keep this kind of note only when a page needs custom LaTeX content.',
    '-->'
];

function latexMatterNote(frontmatter: string[], body: string[]): string {
    return ['---', ...frontmatter, '---', '', ...LATEX_MATTER_COMMENT, '', ...body, ''].join('\n');
}

/** The inline-LaTeX matter examples, in file order. */
export function buildStarterMatterSamples(): { name: string; content: string }[] {
    return [
        {
            name: '0.1 Alpha Readers.md',
            content: latexMatterNote(['Class: Frontmatter', 'BodyMode: latex'], [
                '\\begin{center}',
                '\\vspace*{4cm}',
                '',
                '\\LARGE Alpha Readers',
                '',
                '\\vspace{4cm}',
                '',
                '\\normalsize Instructions for early readers.\\\\',
                'QUESTIONS: Note what feels clear, confusing, compelling, or incomplete.',
                '',
                '',
                '\\vfill',
                '',
                '\\end{center}',
                '\\newpage',
            ])
        },
        {
            name: '0.2 Title Page.md',
            content: latexMatterNote(['Class: Frontmatter', 'Role: title-page', 'BodyMode: latex'], [
                '\\begin{center}',
                '\\vspace*{4cm}',
                '',
                '\\Huge TITLE\\\\',
                '\\large Book 1',
                '',
                '\\vspace{1cm}',
                '',
                '\\rule{4cm}{0.4pt}',
                '\\vspace{-.1cm}',
                '',
                'Author Name',
                '\\vspace{-.4cm}',
                '',
                '\\rule{4cm}{0.4pt}',
                '',
                '\\vfill',
                '\\end{center}',
                '\\newpage',
            ])
        },
        {
            name: '0.3 Copyright.md',
            content: latexMatterNote(['Class: Frontmatter', 'Role: copyright', 'BodyMode: latex'], [
                '\\begingroup',
                '\\footnotesize',
                '\\begin{center}',
                '\\vspace*{1cm}',
                '',
                "This book is a work of fiction. Any references to historical events, real people, or real places are used fictitiously. Names, characters, and places are products of the author's imagination.",
                '',
                '\\vspace{.15cm}',
                '',
                'TITLE Copyright \\textcopyright{} 2026 Author Name\\\\',
                'All rights reserved. No part of this publication may be reproduced, distributed, or transmitted in any form or by any means, including photocopying, recording, or other electronic or mechanical methods, without the prior written permission of the publisher, except in the case of brief quotations embodied in critical reviews and certain other noncommercial uses permitted by copyright law. For permission requests, write to the publisher at the address below.',
                '',
                '\\vspace{.15cm}',
                '',
                'ISBN: 978-0-000000-0 (Paperback)\\\\',
                'ISBN: 978-0-000000-0 (Hardcover)\\\\',
                'Library of Congress Control Number: 00000000000',
                '',
                '\\vspace{.25cm}',
                '',
                '\\textit{Designed by Designer Name}',
                '',
                '\\vspace{.25cm}',
                '',
                'Printed by Example Printer in the United States of America.',
                '',
                '\\vspace{.25cm}',
                '',
                'First printing edition 2026.',
                '',
                '\\vspace{.25cm}',
                '',
                'Example Publisher\\\\',
                '111 Address Street\\\\',
                'City, State 12345\\\\',
                'www.example.com',
                '',
                '\\vfill',
                '\\end{center}',
                '\\endgroup',
                '\\newpage',
            ])
        },
        {
            name: '0.4 Dedication.md',
            content: latexMatterNote(['Class: Frontmatter', 'Role: dedication', 'BodyMode: latex'], [
                '\\begin{center}',
                '\\vspace*{4cm}',
                '',
                '',
                '\\normalsize',
                'For someone who made this work possible\\\\',
                'and for those who helped it find its shape.',
                '',
                '\\end{center}',
                '\\newpage',
            ])
        },
        {
            name: '0.5 Epigraph.md',
            content: latexMatterNote(['Class: Frontmatter', 'Role: epigraph', 'BodyMode: latex'], [
                '\\begin{center}',
                '\\vspace*{4cm}',
                '',
                '\\normalsize',
                'A short quoted passage can appear here\\\\',
                'followed by a second line if needed.',
                '',
                '\\vspace*{0.5cm}',
                '\\small',
                '\\textit{---Source or Attribution}',
                '',
                '\\end{center}',
                '\\newpage',
            ])
        },
        {
            name: '0.6 Title 2.md',
            content: latexMatterNote(['Class: Frontmatter', 'BodyMode: latex'], [
                '\\begin{center}',
                '\\vspace*{4cm}',
                '',
                '\\large THE BOOK TITLE\\\\',
                '',
                '\\end{center}',
                '\\newpage',
            ])
        },
        {
            name: '0.7 Quotation.md',
            content: latexMatterNote(['Class: Frontmatter', 'BodyMode: latex'], [
                '\\begin{center}',
                '\\vspace*{4cm}',
                '',
                '\\normalsize',
                'Various lines of quoted text can appear here.',
                '',
                '\\vspace{1cm}',
                '',
                '---Anonymous, \\textit{Example Source}',
                '',
                '\\end{center}',
                '\\newpage',
            ])
        },
        {
            name: '0.8 Quotation 2.md',
            content: latexMatterNote(['Class: Frontmatter', 'BodyMode: latex'], [
                '\\begin{center}',
                '\\vspace*{4cm}',
                '',
                '\\normalsize',
                'A second quotation can appear here for books that need another opening page.',
                '',
                '\\vspace{1cm}',
                '',
                '---Anonymous, \\textit{Second Example Source}',
                '',
                '\\end{center}',
                '\\newpage',
            ])
        },
        {
            name: '0.9 Quotation 3.md',
            content: latexMatterNote(['Class: Frontmatter', 'BodyMode: latex'], [
                '\\begin{center}',
                '\\vspace*{4cm}',
                '',
                '\\normalsize',
                'A third quotation or content note can appear here when the book needs one.',
                '',
                '\\vspace{1cm}',
                '',
                '---Anonymous, \\textit{Third Example Source}',
                '',
                '\\end{center}',
                '\\newpage',
            ])
        },
        {
            name: '200.1 Acknowledgments.md',
            content: latexMatterNote(['Class: Backmatter', 'Role: acknowledgments', 'BodyMode: latex'], [
                '\\vspace*{4cm}',
                '',
                '\\begin{center}',
                '\\large ACKNOWLEDGMENTS',
                '\\end{center}',
                '',
                '\\vspace{1em}',
                '',
                '\\normalsize',
                '',
                'Thank you to the readers, editors, family, friends, and collaborators who helped bring this manuscript into shape.',
            ])
        },
        {
            name: '200.2 About the Author.md',
            content: latexMatterNote(['Class: Backmatter', 'Role: about-author', 'BodyMode: latex'], [
                '\\vspace*{4cm}',
                '',
                '\\begin{center}',
                '\\large ABOUT THE AUTHOR',
                '\\end{center}',
                '',
                '\\vspace{1em}',
                '',
                '\\normalsize',
                '',
                'Add a short author biography here. Include relevant background, publications, interests, or where readers can learn more.',
            ])
        }
    ];
}

/**
 * Create the starter publishing files: Book Details note, inline-LaTeX matter
 * examples, and the bundled PDF layouts. Existing author files are left
 * alone; only byte-identical retired samples are refreshed.
 */
export async function generateSampleTemplates(plugin: RadialTimelinePlugin): Promise<StarterPublishingSetupResult> {
    const vault = plugin.app.vault;
    const baseFolder = resolveManuscriptOutputFolder(plugin);
    const pandocFolder = getPandocFolder(plugin);
    const activeSourceFolderRaw = getActiveBookExportContext(plugin).sourceFolder.trim();
    const matterTargetFolder = activeSourceFolderRaw ? normalizePath(activeSourceFolderRaw) : baseFolder;

    for (const folder of [baseFolder, pandocFolder, matterTargetFolder]) {
        await ensureVaultFolderPath(plugin, folder);
    }

    const created: string[] = [];
    const updatedGenerated: string[] = [];
    const skippedExisting: string[] = [];

    const bookMetaPath = normalizePath(`${matterTargetFolder}/${BOOK_META_NOTE_NAME}`);
    if (vault.getAbstractFileByPath(bookMetaPath)) {
        skippedExisting.push(BOOK_META_NOTE_NAME);
    } else {
        await vault.create(bookMetaPath, buildBookMetaSampleContent(new Date().getFullYear()));
        created.push(BOOK_META_NOTE_NAME);
    }

    for (const { name, content } of buildStarterMatterSamples()) {
        const filePath = normalizePath(`${matterTargetFolder}/${name}`);
        const existing = vault.getAbstractFileByPath(filePath);
        if (!existing) {
            await vault.create(filePath, content);
            created.push(name);
            continue;
        }
        if (existing instanceof TFile) {
            const existingContent = await vault.read(existing);
            if (existingContent === content) continue;
            if (isRetiredBundledPersonalMatterSample(name, existingContent)) {
                await vault.modify(existing, content);
                updatedGenerated.push(name);
                continue;
            }
        }
        skippedExisting.push(name);
    }

    const bundledInstall = await installBundledPandocLayouts(plugin);
    if (bundledInstall.fonts.failed.length > 0) {
        console.warn(`[Radial Timeline] Bundled font install failed for: ${bundledInstall.fonts.failed.join(', ')}. PDF export will fall back to system fonts where available.`);
    }
    created.push(
        ...getBundledPandocLayouts()
            .filter(layout => bundledInstall.installed.includes(layout.name))
            .map(layout => layout.path)
    );
    ensureBundledPandocLayoutsRegistered(plugin);
    await plugin.saveSettings();

    return { created, updatedGenerated, skippedExisting };
}
