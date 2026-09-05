/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * Scene Data Service
 * 
 * Handles loading, filtering, and processing scene data from vault files.
 * Extracted from the massive getSceneData() method in main.ts (643 lines).
 */

import { App, TFile } from 'obsidian';
import type { TimelineItem, RadialTimelineSettings, BookMeta, MatterMeta } from '../types';
import { frontmatterValueToText, getActiveFrontmatterMappings, normalizeBeatFrontmatterKeys, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { parseWhenField } from '../utils/date';
import { normalizeBooleanValue, isStoryBeat } from '../utils/sceneHelpers';
import { stripWikiLinks } from '../utils/text';
import { filterBeatsBySystem } from '../utils/gossamer';
import { clampActNumber, getConfiguredActCount } from '../utils/acts';
import { isPathInFolderScope } from '../utils/pathScope';
import { readSceneId } from '../utils/sceneIds';
import { isMatterClassValue, parseMatterMetaFromFrontmatter } from '../utils/matterMeta';
import { resolveSelectedBeatModelFromSettings } from '../utils/beatSystemState';
import { readSharedChapterTitle } from '../utils/timelineChapters';

export interface GetSceneDataOptions {
    filterBeatsBySystem?: boolean;
    sourcePath?: string;  // Override the default source path (used for Social APR project targeting)
}

// [PULSE_FLAG_METADATA_KEYS and helper removed - normalization handles this]

export class SceneDataService {
    private app: App;
    private settings: RadialTimelineSettings;
    /** Central BookMeta for the active manuscript (exactly one per book). */
    private _bookMeta: BookMeta | null = null;
    /** Tracks usage of compatibility fallbacks for metrics. */
    private migrationCounters = new Map<string, number>();

    constructor(app: App, settings: RadialTimelineSettings) {
        this.app = app;
        this.settings = settings;
    }

    private trackCompatUsage(id: string, _file: string, _message?: string): void {
        this.migrationCounters.set(id, (this.migrationCounters.get(id) ?? 0) + 1);
    }

    /**
     * Get the BookMeta for the active manuscript.
     * Populated during getSceneData() — returns null if no BookMeta note exists.
     */
    getBookMeta(): BookMeta | null {
        return this._bookMeta;
    }

    /**
     * Update settings (called when settings change)
     */
    updateSettings(settings: RadialTimelineSettings): void {
        this.settings = settings;
    }

    /**
     * Read access to the live settings reference (shared with the plugin).
     */
    getSettings(): RadialTimelineSettings {
        return this.settings;
    }

    /**
     * Get all scene data from the vault
     */
    async getSceneData(options?: GetSceneDataOptions): Promise<TimelineItem[]> {
        const filterBeats = options?.filterBeatsBySystem ?? true;
        // Use override sourcePath if provided (for Social APR project targeting), otherwise use settings
        const sourcePath = options?.sourcePath ?? this.settings.sourcePath;

        // Find markdown files in vault that match the filters
        const files = this.app.vault.getMarkdownFiles().filter((file: TFile) => {
            // If sourcePath is empty, include all files, otherwise only include files in the sourcePath
            return isPathInFolderScope(file.path, sourcePath || '');
        });

        const scenes: TimelineItem[] = [];
        const plotsToProcess: Array<{ file: TFile, metadata: Record<string, unknown>, beatMetadata: Record<string, unknown>, validActNumber: number }> = [];
        // Reset BookMeta — will be populated if a BookMeta note is found
        this._bookMeta = null;
        // Reset metrics for this run
        this.migrationCounters.clear();

        for (const file of files) {
            try {
                const rawMetadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
                const mappings = getActiveFrontmatterMappings(this.settings);
                const metadata = rawMetadata ? normalizeFrontmatterKeys(rawMetadata, mappings) : undefined;

                if (metadata && metadata.Class === "Scene") {
                    // Parse the When field using the centralized parser (single source of truth)
                    const whenStr = metadata.When;
                    let when: Date | undefined;
                    if (typeof whenStr === 'string') {
                        const parsed = parseWhenField(whenStr);
                        if (parsed) {
                            when = parsed;
                        }
                    } else if (whenStr instanceof Date) {
                        // Already a Date object
                        when = whenStr;
                    }

                    const hasValidWhen = when instanceof Date && !isNaN(when.getTime());
                    const normalizedWhen = hasValidWhen ? when : undefined;
                    const missingWhen = !hasValidWhen;
                    const isoDate = hasValidWhen && normalizedWhen
                        ? normalizedWhen.toISOString().split('T')[0]
                        : '';

                    // Split subplots if provided, otherwise default to "Main Plot"
                    const subplots = metadata.Subplot
                        ? Array.isArray(metadata.Subplot)
                            ? metadata.Subplot
                            : [metadata.Subplot]
                        : ["Main Plot"];

                    // Read actNumber from metadata, default to 1 if missing or empty
                    const actValue = metadata.Act;
                    const configuredActs = getConfiguredActCount(this.settings);
                    const actNumberRaw = (actValue !== undefined && actValue !== null && actValue !== '') ? Number(actValue) : 1;
                    const validActNumber = clampActNumber(actNumberRaw, configuredActs);
                    const sceneId = readSceneId(metadata);

                    // Use filename for display; numbering is derived from the filename/title prefix.
                    // Do not consume YAML Title for numbering/ordering to avoid stale frontmatter.
                    const sceneTitle = file.basename;

                    // Create a scene for each subplot
                    for (const subplot of subplots) {
                        const durationValue = metadata.Duration;
                        const duration = (durationValue !== undefined && durationValue !== null)
                            ? frontmatterValueToText(durationValue)
                            : undefined;

                        const pulseUpdate = metadata["Pulse Update"];
                        const pulseLastUpdated = metadata["Pulse Last Updated"];

                        // Compat: Check for legacy keys (metrics only)
                        if (rawMetadata) {
                            // F005: Beats/Review update legacy flags
                            if ('Beats Update' in rawMetadata || 'beatsupdate' in rawMetadata) {
                                this.trackCompatUsage('Beats Update->Pulse Update', file.path, 'Using legacy field "Beats Update". Consider renaming to "Pulse Update".');
                            }
                            if ('Review Update' in rawMetadata || 'reviewupdate' in rawMetadata) {
                                this.trackCompatUsage('Review Update->Pulse Update', file.path, 'Using legacy field "Review Update". Consider renaming to "Pulse Update".');
                            }
                            if ('Beats Last Updated' in rawMetadata || 'beatslastupdated' in rawMetadata) {
                                this.trackCompatUsage('Beats Last Updated->Pulse Last Updated', file.path, 'Using legacy field "Beats Last Updated". Consider renaming to "Pulse Last Updated".');
                            }
                            // F013: iterations -> Iteration
                            if ('iterations' in rawMetadata || 'revision' in rawMetadata) {
                                this.trackCompatUsage('iterations->Iteration', file.path, 'Using legacy field "iterations/revision". Consider renaming to "Iteration".');
                            }
                            // Runtime Profile (already removed, but tracking presence for awareness)
                            if ('runtimeProfile' in rawMetadata) {
                                this.trackCompatUsage('runtimeProfile->Runtime Profile', file.path, 'Using legacy camelCase "runtimeProfile". Rename to "Runtime Profile".');
                            }
                        }

                        // Parse Character field and strip Obsidian wiki links [[...]]
                        const rawCharacter = metadata.Character;
                        const characterList = Array.isArray(rawCharacter)
                            ? (rawCharacter as string[]).map(c => stripWikiLinks(c))
                            : (rawCharacter ? [stripWikiLinks(rawCharacter as string)] : undefined);

                        const rawPov = metadata.POV;
                        let povField: string | undefined;
                        if (Array.isArray(rawPov)) {
                            for (const entry of rawPov) {
                                const candidate = typeof entry === 'string' ? entry : frontmatterValueToText(entry);
                                const trimmed = candidate.trim();
                                if (trimmed.length > 0) {
                                    povField = trimmed;
                                    break;
                                }
                            }
                        } else if (typeof rawPov === 'string') {
                            const trimmed = rawPov.trim();
                            if (trimmed.length > 0) {
                                povField = trimmed;
                            }
                        } else if (rawPov !== undefined && rawPov !== null) {
                            const converted = frontmatterValueToText(rawPov).trim();
                            if (converted.length > 0) {
                                povField = converted;
                            }
                        }

                        const runtimeProfileRaw = metadata["Runtime Profile"] ?? metadata["RuntimeProfile"];
                        const runtimeProfile = runtimeProfileRaw !== undefined && runtimeProfileRaw !== null
                            ? frontmatterValueToText(runtimeProfileRaw).trim()
                            : undefined;
                        const chapterTitle = readSharedChapterTitle(metadata);

                        scenes.push({
                            date: isoDate,
                            when: normalizedWhen,
                            missingWhen,
                            path: file.path,
                            sceneId,
                            title: sceneTitle,
                            number: undefined,
                            subplot: subplot,
                            act: String(validActNumber),
                            actNumber: validActNumber,
                            pov: povField,
                            place: metadata.Place as string | undefined,
                            Character: characterList,
                            synopsis: metadata.Synopsis as string | undefined,
                            Summary: metadata.Summary as string | undefined,
                            status: metadata.Status as string | string[] | undefined,
                            "Publish Stage": metadata["Publish Stage"] as string | undefined,
                            due: metadata.Due as string | undefined,
                            pendingEdits: (() => {
                                // Only read Pending Edits field (text notes for next revision)
                                // Note: "Iterations" is a separate numeric field for revision count
                                const raw = metadata["Pending Edits"];
                                if (Array.isArray(raw)) {
                                    return raw.map(entry => frontmatterValueToText(entry)).join('\n');
                                }
                                if (raw !== undefined && raw !== null) {
                                    return frontmatterValueToText(raw);
                                }
                                return undefined;
                            })(),
                            Duration: duration,
                            Chapter: chapterTitle,
                            Runtime: metadata.Runtime !== undefined && metadata.Runtime !== null
                                ? frontmatterValueToText(metadata.Runtime)
                                : undefined,
                            RuntimeProfile: runtimeProfile && runtimeProfile.length > 0 ? runtimeProfile : undefined,
                            // AI Scene Analysis fields - handle both string and array formats from YAML
                            "previousSceneAnalysis": Array.isArray(metadata["previousSceneAnalysis"])
                                ? (metadata["previousSceneAnalysis"] as string[]).join('\n')
                                : metadata["previousSceneAnalysis"] as string | undefined,
                            "currentSceneAnalysis": Array.isArray(metadata["currentSceneAnalysis"])
                                ? (metadata["currentSceneAnalysis"] as string[]).join('\n')
                                : metadata["currentSceneAnalysis"] as string | undefined,
                            "nextSceneAnalysis": Array.isArray(metadata["nextSceneAnalysis"])
                                ? (metadata["nextSceneAnalysis"] as string[]).join('\n')
                                : metadata["nextSceneAnalysis"] as string | undefined,
                            itemType: "Scene",
                            "Pulse Update": normalizeBooleanValue(pulseUpdate),
                            "Pulse Last Updated": typeof pulseLastUpdated === 'string' ? pulseLastUpdated : undefined,
                            rawFrontmatter: metadata
                        });
                    }
                } else if (metadata && metadata.Class === "Backdrop") {
                    // Parse Backdrop Item
                    const whenStr = metadata.When;
                    let when: Date | undefined;
                    if (typeof whenStr === 'string') {
                        const parsed = parseWhenField(whenStr);
                        if (parsed) when = parsed;
                    } else if (whenStr instanceof Date) {
                        when = whenStr;
                    }

                    const durationValue = metadata.Duration;
                    const duration = (durationValue !== undefined && durationValue !== null)
                        ? frontmatterValueToText(durationValue)
                        : undefined;

                    const isoDate = when ? when.toISOString().split('T')[0] : '';

                    const contextValue = typeof metadata.Context === 'string'
                        ? metadata.Context
                        : undefined;
                    const chapterTitle = readSharedChapterTitle(metadata);
                    const legacySynopsisValue = typeof metadata.Synopsis === 'string'
                        ? metadata.Synopsis
                        : undefined;
                    const backdropContext = contextValue ?? legacySynopsisValue;
                    if (!contextValue && legacySynopsisValue) {
                        this.trackCompatUsage('Backdrop.Synopsis->Context', file.path, 'Using legacy field "Synopsis" for backdrop Context. Consider renaming to "Context".');
                    }

                    scenes.push({
                        date: isoDate,
                        when: when,
                        path: file.path,
                        title: file.basename, // Use filename as title, as requested
                        synopsis: backdropContext, // Backdrop hover context
                        Context: backdropContext,
                        Chapter: chapterTitle,
                        Duration: duration,
                        End: metadata.End as string | undefined,
                        itemType: "Backdrop",
                        rawFrontmatter: metadata
                        // No subplot assignment - rendered in special Backdrop Ring
                    });

                } else if (metadata && metadata.Class === "BookMeta") {
                    // BookMeta note — central metadata source for the manuscript.
                    // Exactly one per book. Parsed and stored, NOT added to scenes array.
                    // Ignored by Timeline — used only during export.
                    const book = metadata.Book as Record<string, unknown> | undefined;
                    const rights = metadata.Rights as Record<string, unknown> | undefined;
                    const identifiers = metadata.Identifiers as Record<string, unknown> | undefined;
                    const publisher = metadata.Publisher as Record<string, unknown> | undefined;
                    const frontmatterBlocks = metadata.Frontmatter as Record<string, unknown> | undefined;
                    const backmatterBlocks = metadata.Backmatter as Record<string, unknown> | undefined;

                    this._bookMeta = {
                        title: (book?.title as string) || undefined,
                        subtitle: (book?.subtitle as string) || undefined,
                        author: (book?.author as string) || undefined,
                        rights: rights ? {
                            copyright_holder: (rights.copyright_holder as string) || undefined,
                            year: (rights.year as number) ?? undefined
                        } : undefined,
                        identifiers: identifiers ? {
                            isbn_paperback: (identifiers.isbn_paperback as string) || undefined
                        } : undefined,
                        publisher: publisher ? {
                            name: (publisher.name as string) || undefined,
                            imprint: (publisher.imprint as string) || undefined,
                            edition: (publisher.edition as string) || undefined
                        } : undefined,
                        frontmatter: frontmatterBlocks ? {
                            title_page_note: (frontmatterBlocks.title_page_note as string) || undefined,
                            dedication: (frontmatterBlocks.dedication as string) || undefined,
                            epigraph_quote: (frontmatterBlocks.epigraph_quote as string) || undefined,
                            epigraph_attribution: (frontmatterBlocks.epigraph_attribution as string) || undefined
                        } : undefined,
                        backmatter: backmatterBlocks ? {
                            acknowledgments: (backmatterBlocks.acknowledgments as string) || undefined,
                            about_author: (backmatterBlocks.about_author as string) || undefined,
                            author_note: (backmatterBlocks.author_note as string) || undefined,
                            other_works: (backmatterBlocks.other_works as string) || undefined
                        } : undefined,
                        sourcePath: file.path
                    };

                } else if (metadata && isMatterClassValue(metadata.Class)) {
                    // Front-matter / back-matter notes – included in manuscript pipeline,
                    // excluded from timeline stats via isNonSceneItem().

                    const parsed = parseMatterMetaFromFrontmatter(metadata);
                    const matterMeta: MatterMeta | undefined = parsed || undefined;
                    const side = parsed?.side === 'back' ? 'back' : 'front';

                    scenes.push({
                        date: '',
                        path: file.path,
                        title: file.basename,
                        itemType: side === 'back' ? 'Backmatter' : 'Frontmatter',
                        matterMeta,
                        rawFrontmatter: metadata
                    });

                } else if (metadata && isStoryBeat(metadata.Class)) {
                    // Defer processing of Plot/Beat items until after all scenes are collected
                    const actValue = metadata.Act;
                    const configuredActs = getConfiguredActCount(this.settings);
                    const actNumberRaw = (actValue !== undefined && actValue !== null && actValue !== '') ? Number(actValue) : 1;
                    const validActNumber = clampActNumber(actNumberRaw, configuredActs);
                    plotsToProcess.push({
                        file,
                        metadata,
                        beatMetadata: rawMetadata ? normalizeBeatFrontmatterKeys(rawMetadata, mappings) : metadata,
                        validActNumber
                    });
                }
            } catch (error) {
                console.error(`Error processing file ${file.path}:`, error);
            }
        }

        // Apply dominant subplot preferences before processing beats
        this.applyDominantSubplotPreferences(scenes);

        // Filter scenes to show only dominant subplot representation
        const filteredScenes = this.filterScenesByDominantSubplot(scenes);

        // Build a map: date -> scenes (only unique file paths)
        const scenesByDate = new Map<string, TimelineItem[]>();
        const processedPaths = new Set<string>();

        for (const scene of filteredScenes) {
            const dateKey = scene.date;

            // Skip if we've already processed this path for this date
            const pathDateKey = `${scene.path}-${dateKey}`;
            if (processedPaths.has(pathDateKey)) {
                continue;
            }
            processedPaths.add(pathDateKey);

            if (!scenesByDate.has(dateKey)) {
                scenesByDate.set(dateKey, []);
            }
            scenesByDate.get(dateKey)!.push(scene);
        }

        // Process plot/beat items
        // Filter by Beat Model if requested (use centralized helper - single source of truth)
        let beatsToProcess = plotsToProcess;
        const selectedBeatModel = resolveSelectedBeatModelFromSettings(this.settings);
        if (filterBeats && selectedBeatModel) {
            // Map to objects with "Beat Model" field for filtering
            const beatsWithModel = beatsToProcess.map(p => ({
                original: p,
                "Beat Model": p.metadata["Beat Model"]
            }));
            const filtered = filterBeatsBySystem(beatsWithModel, selectedBeatModel);
            beatsToProcess = filtered.map(f => f.original);
        }

        for (const { file, metadata, beatMetadata, validActNumber } of beatsToProcess) {
            // Beats are structural, not temporal — no When field support.
            const dateKey = '';

            // Beat Model is required for Beat notes; do not silently infer when missing.
            const beatSource = beatMetadata ?? metadata;
            const beatModelRaw = typeof beatSource["Beat Model"] === 'string'
                ? String(beatSource["Beat Model"]).trim()
                : '';
            const beatModel = beatModelRaw.length > 0 ? beatModelRaw : undefined;
            const missingBeatModel = !beatModel;
            const purpose = typeof beatSource.Purpose === 'string'
                ? beatSource.Purpose
                : undefined;
            const chapterTitle = readSharedChapterTitle(beatSource);

            // Beats appear only once in the outermost ring - not duplicated per subplot
            filteredScenes.push({
                date: dateKey,
                when: undefined,
                path: file.path,
                title: beatSource.Title as string | undefined ?? file.basename,
                subplot: "Main Plot", // Beats always use Main Plot for outermost ring
                act: String(validActNumber),
                actNumber: validActNumber,
                synopsis: beatSource.Synopsis as string | undefined,
                Purpose: purpose,
                Chapter: chapterTitle,
                "Beat Model": beatModel,
                missingBeatModel,
                Range: beatSource.Range as string | undefined,
                "Suggest Placement": beatSource["Suggest Placement"] as string | undefined,
                itemType: "Beat", // Modern standard - renderer should use isBeatNote() helper
                // Include all Gossamer score fields (Gossamer1-30)
                Gossamer1: beatSource.Gossamer1 as number | undefined,
                Gossamer2: beatSource.Gossamer2 as number | undefined,
                Gossamer3: beatSource.Gossamer3 as number | undefined,
                Gossamer4: beatSource.Gossamer4 as number | undefined,
                Gossamer5: beatSource.Gossamer5 as number | undefined,
                "Publish Stage": beatSource["Publish Stage"] as string | undefined,
                // Raw frontmatter for accessing Gossamer Justification and other dynamic fields
                rawFrontmatter: beatSource
            });
        }

        return filteredScenes;
    }

    /**
     * Apply dominant subplot preferences from settings
     */
    private applyDominantSubplotPreferences(scenes: TimelineItem[]): void {
        if (!this.settings.dominantSubplots) return;

        // Group scenes by path
        const scenesByPath = new Map<string, TimelineItem[]>();
        scenes.forEach(scene => {
            if (!scene.path) return;
            if (!scenesByPath.has(scene.path)) {
                scenesByPath.set(scene.path, []);
            }
            scenesByPath.get(scene.path)!.push(scene);
        });

        // For each path with a stored preference, mark the preferred subplot
        Object.entries(this.settings.dominantSubplots).forEach(([path, dominantSubplot]) => {
            const scenesForPath = scenesByPath.get(path);
            if (!scenesForPath || scenesForPath.length <= 1) return;

            // Mark scenes matching the dominant subplot
            scenesForPath.forEach(scene => {
                // Store the preference on the scene for later filtering
                (scene as TimelineItem & { _isDominantSubplot?: boolean })._isDominantSubplot =
                    scene.subplot === dominantSubplot;
            });
        });
    }

    /**
     * Keep all scenes but mark the dominant subplot for visual coloring
     * (this does NOT filter - all subplot versions are kept for rendering in their respective rings)
     */
    private filterScenesByDominantSubplot(scenes: TimelineItem[]): TimelineItem[] {
        // Don't filter - just return all scenes
        // The _isDominantSubplot flag is already set by applyDominantSubplotPreferences
        // and will be used by the renderer for coloring purposes in narrative/chronologue modes
        return scenes;
    }

    /**
     * Check if a file path is a scene file
     */
    isSceneFile(filePath: string): boolean {
        // This method was originally in the plugin
        // It needs to check the file's metadata
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return false;

        const metadata = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!metadata) return false;

        return metadata.Class === "Scene";
    }
}
