/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Readiness summary — the publishing status the settings card shows: Book
 * Details, matter notes, PDF layouts, and the Pandoc path, each summarized
 * through the validation service.
 */

import type { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { PublishingValidationSnapshot, ValidationIssue, ValidationSummary } from '../types';
import { getActiveBook } from '../utils/books';
import { resolveBookPages } from '../utils/bookPagesResolver';
import { getSceneFilesByOrder } from '../utils/manuscript';
import { getActiveBookMatterNoteSummaries, getActiveBookMetaStatus, type ActiveBookMetaStatus } from './activeBookNotes';
import { isPandocPathValid } from './toolchainScan';

export interface PdfLayoutSummary {
    validCount: number;
    totalCount: number;
    state: 'ready' | 'warning' | 'blocked';
    errorCount: number;
    warningCount: number;
    topMessage?: string;
}

export interface PublishingProgressContext {
    activeBookMetaStatus: ActiveBookMetaStatus;
    validationSnapshot: PublishingValidationSnapshot;
    bookMetaSummary: ValidationSummary;
    matterSummary: ValidationSummary;
    layoutSummary: PdfLayoutSummary;
    matterCount: number;
    pandocPathValid: boolean;
}

export interface MatterPreviewItem {
    file: TFile;
    side: 'front' | 'back';
    role?: string;
    usesBookMeta?: boolean;
    modeLabel: string;
    modeTone: 'plain' | 'latex';
}

export interface MatterPreviewSummary {
    front: MatterPreviewItem[];
    back: MatterPreviewItem[];
}

export function getPublishingValidationSnapshot(plugin: RadialTimelinePlugin): PublishingValidationSnapshot {
    const activeBook = getActiveBook(plugin.settings);
    return plugin.getPublishingValidationService().collect(activeBook?.id, {
        exportType: 'manuscript',
        outputFormat: 'pdf'
    });
}

function getPdfLayoutSummary(plugin: RadialTimelinePlugin, validation: PublishingValidationSnapshot): PdfLayoutSummary {
    const layouts = (plugin.settings.pandocLayouts || []).filter(layout => layout.preset === 'novel');
    const relevantIssues: ValidationIssue[] = [];
    layouts.forEach(layout => {
        relevantIssues.push(...(validation.assetIssues[`${layout.id}::asset`] || []));
        relevantIssues.push(...(validation.profileIssues[layout.id] || []));
    });
    relevantIssues.push(...validation.preflightIssues);
    relevantIssues.push(...validation.templateAccessIssues);
    if (layouts.length === 0) {
        relevantIssues.push({
            scope: 'profile',
            level: 'error',
            code: 'pdf_layout_missing',
            message: 'No PDF styles are configured.',
        });
    }
    const summary = plugin.getPublishingValidationService().summarize(relevantIssues);
    const validCount = layouts.filter(layout => {
        const assetIssues = validation.assetIssues[`${layout.id}::asset`] || [];
        const profileIssues = validation.profileIssues[layout.id] || [];
        return !assetIssues.some(issue => issue.level === 'error') && !profileIssues.some(issue => issue.level === 'error');
    }).length;
    return {
        validCount,
        totalCount: layouts.length,
        state: summary.state,
        errorCount: summary.errorCount,
        warningCount: summary.warningCount,
        topMessage: summary.topMessage
    };
}

export function getPublishingProgressContext(plugin: RadialTimelinePlugin): PublishingProgressContext {
    const activeBookMetaStatus = getActiveBookMetaStatus(plugin);
    const validationSnapshot = getPublishingValidationSnapshot(plugin);
    const activeBookMetaIssues = [...validationSnapshot.activeBookMetaIssues];
    if (!activeBookMetaStatus.found || !activeBookMetaStatus.bookMeta) {
        activeBookMetaIssues.push({
            scope: 'book-meta',
            level: 'error',
            code: 'book_meta_missing',
            message: 'Book Details not found for active book.'
        });
    }
    const resolvedBookPageCount = resolveBookPages(
        activeBookMetaStatus.bookMeta || undefined,
        getActiveBookMatterNoteSummaries(plugin)
    ).length;
    const validation = plugin.getPublishingValidationService();
    return {
        activeBookMetaStatus,
        validationSnapshot,
        bookMetaSummary: validation.summarize(activeBookMetaIssues),
        matterSummary: validation.summarize(validationSnapshot.matterIssues),
        layoutSummary: getPdfLayoutSummary(plugin, validationSnapshot),
        matterCount: resolvedBookPageCount,
        pandocPathValid: isPandocPathValid(plugin.settings.pandocPath)
    };
}

/** Front/back matter notes as the narrative export would order them, for the Book Pages preview. */
export async function getMatterPreviewSummary(plugin: RadialTimelinePlugin): Promise<MatterPreviewSummary> {
    const selection = await getSceneFilesByOrder(plugin.app, plugin, 'narrative', undefined, true);
    const front: MatterPreviewItem[] = [];
    const back: MatterPreviewItem[] = [];
    for (const file of selection.files) {
        const matterMeta = selection.matterMetaByPath?.get(file.path);
        if (!matterMeta) continue;
        const side: 'front' | 'back' = matterMeta.side === 'back' ? 'back' : 'front';
        const role = typeof matterMeta.role === 'string' && matterMeta.role.trim().length > 0 ? matterMeta.role.trim() : undefined;
        const bodyMode: 'latex' | 'plain' = matterMeta.bodyMode === 'latex' ? 'latex' : 'plain';
        const item: MatterPreviewItem = {
            file,
            side,
            role,
            usesBookMeta: matterMeta.usesBookMeta === true,
            modeLabel: bodyMode === 'latex' ? 'LaTeX' : 'Plain',
            modeTone: bodyMode
        };
        (side === 'back' ? back : front).push(item);
    }
    return { front, back };
}
