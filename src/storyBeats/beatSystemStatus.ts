import type { App, TFile } from 'obsidian';
import { explainScope, resolveBookScopedFiles, resolveBookScopedMarkdownFiles } from '../services/NoteScopeResolver';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../utils/frontmatter';
import { parseActLabels, resolveActLabel } from '../utils/acts';
import { getPlotSystem } from '../utils/beatsSystems';
import {
    normalizeBeatNameInput,
    normalizeBeatSetNameInput,
    toBeatMatchKey,
    toBeatModelMatchKey,
} from '../utils/beatsInputNormalize';
import { isStoryBeat } from '../utils/sceneHelpers';
import { comparePrefixTokens, extractPrefixToken } from '../utils/prefixOrder';
import type { BeatDefinition, LoadedBeatTab, RadialTimelineSettings } from '../types/settings';
import type {
    BeatExpectedBeat,
    BeatMatchedNote,
    BeatStructuralActStatus,
    BeatStructuralBeatStatus,
    BeatStructuralIssue,
    BeatStructuralSummary,
    BeatSystemStructuralStatus,
    BeatSystemStatusScope,
} from './types';
import { getActiveLoadedBeatTab } from './workspaceState';
import { resolveSelectedBeatModelFromSettings } from '../utils/beatSystemState';

export function normalizeBeatTitle(value: string): string {
    return toBeatMatchKey(value);
}

function inferActForIndex(index: number, total: number): number {
    if (total <= 0) return 1;
    const position = index / total;
    if (position < 0.33) return 1;
    if (position < 0.67) return 2;
    return 3;
}

export function clampBeatAct(act: number, maxActs: number): number {
    const n = Number.isFinite(act) ? Math.round(act) : 1;
    return Math.min(Math.max(1, n), maxActs);
}

type BeatSystemOverride = {
    id?: string;
    name: string;
    beats: BeatDefinition[];
};

function buildSelectedSystemKey(
    selectedSystem: string,
    systemOverride?: BeatSystemOverride
): string {
    if (systemOverride) {
        return `workspace:${systemOverride.id ?? normalizeBeatSetNameInput(systemOverride.name, 'custom')}`;
    }
    return normalizeBeatSetNameInput(selectedSystem, selectedSystem);
}

function buildSelectedSystemLabel(
    selectedSystem: string,
    systemOverride?: BeatSystemOverride
): string {
    if (systemOverride) {
        return normalizeBeatSetNameInput(systemOverride.name, 'Custom');
    }
    return normalizeBeatSetNameInput(selectedSystem, selectedSystem);
}

function buildExpectedBeats(
    settings: RadialTimelineSettings,
    selectedSystem: string,
    systemOverride?: BeatSystemOverride
): BeatExpectedBeat[] {
    const actCount = Math.max(3, settings.actCount ?? 3);
    const actLabels = parseActLabels(settings, actCount);

    if (systemOverride) {
        const beats = systemOverride.beats
            .map((beat) => ({
                name: normalizeBeatNameInput(beat.name, ''),
                act: clampBeatAct(typeof beat.act === 'number' ? beat.act : 1, actCount),
            }))
            .filter((beat) => beat.name.length > 0)
            .sort((a, b) => a.act - b.act);

        return beats.map((beat, index) => ({
            key: normalizeBeatTitle(beat.name),
            name: beat.name,
            actNumber: beat.act,
            actLabel: resolveActLabel(beat.act - 1, actLabels),
            ordinal: index + 1,
        }));
    }

    const system = getPlotSystem(selectedSystem);
    const beats = system?.beats ?? [];
    const details = system?.beatDetails ?? [];

    return beats
        .map((beatName, index) => {
            const detailAct = (details[index] as { act?: number } | undefined)?.act;
            const actNumber = typeof detailAct === 'number' && Number.isFinite(detailAct)
                ? clampBeatAct(detailAct, actCount)
                : inferActForIndex(index, beats.length);
            const name = normalizeBeatNameInput(beatName, '');
            return {
                key: normalizeBeatTitle(name),
                name,
                actNumber,
                actLabel: resolveActLabel(actNumber - 1, actLabels),
                ordinal: index + 1,
            };
        })
        .filter((beat) => beat.name.length > 0);
}

function toMatchedNote(file: TFile, frontmatter: Record<string, unknown>): BeatMatchedNote {
    const actValue = frontmatter.Act;
    const actNumberRaw = actValue !== undefined && actValue !== null && actValue !== ''
        ? Number(actValue)
        : undefined;
    const actNumber = Number.isFinite(actNumberRaw) ? actNumberRaw : undefined;
    const beatModel = typeof frontmatter['Beat Model'] === 'string'
        ? frontmatter['Beat Model'].trim() || undefined
        : undefined;
    const classValue = typeof frontmatter.Class === 'string' ? frontmatter.Class.trim() : undefined;

    return {
        file,
        path: file.path,
        basename: file.basename,
        title: typeof frontmatter.Title === 'string' && frontmatter.Title.trim().length > 0
            ? frontmatter.Title.trim()
            : file.basename,
        actNumber,
        beatModel,
        missingBeatModel: !beatModel,
        classValue,
    };
}

function buildIssue(code: BeatStructuralIssue['code'], message: string): BeatStructuralIssue {
    return { code, message };
}

function buildBeatLabel(kind: BeatStructuralBeatStatus['kind']): string {
    if (kind === 'complete') return '✔';
    if (kind === 'missing') return '✖ Missing';
    return '⚠ Incomplete';
}

export function getBeatSystemStructuralStatus(params: {
    app: App;
    settings: RadialTimelineSettings;
    selectedSystem?: string;
    customSystemOverride?: BeatSystemOverride;
    loadedTab?: LoadedBeatTab;
}): BeatSystemStructuralStatus {
    const { app, settings } = params;
    const activeWorkspaceTab = !params.loadedTab && !params.customSystemOverride && !params.selectedSystem
        ? getActiveLoadedBeatTab(settings)
        : undefined;
    const loadedTabOverride = params.loadedTab
        ? {
            id: params.loadedTab.sourceId ?? params.loadedTab.tabId,
            name: params.loadedTab.name,
            beats: params.loadedTab.beats,
        }
        : activeWorkspaceTab
            ? {
                id: activeWorkspaceTab.sourceId ?? activeWorkspaceTab.tabId,
                name: activeWorkspaceTab.name,
                beats: activeWorkspaceTab.beats,
            }
        : undefined;
    const systemOverride = loadedTabOverride ?? params.customSystemOverride;
    const selectedSystem = params.selectedSystem
        ?? systemOverride?.name
        ?? resolveSelectedBeatModelFromSettings(settings)
        ?? 'Custom';
    const selectedSystemKey = buildSelectedSystemKey(selectedSystem, systemOverride);
    const selectedSystemLabel = buildSelectedSystemLabel(selectedSystem, systemOverride);
    const expectedBeats = buildExpectedBeats(settings, selectedSystem, systemOverride);
    const expectedKeySet = new Set(expectedBeats.map((beat) => beat.key).filter(Boolean));
    const markdownScope = resolveBookScopedMarkdownFiles(app, settings);
    const beatScope = resolveBookScopedFiles({ app, settings, noteType: 'Beat' });

    const scope: BeatSystemStatusScope = {
        sourcePath: markdownScope.sourcePath,
        bookTitle: markdownScope.bookTitle,
        scopeSummary: explainScope(beatScope.files, { noteType: 'Beat', bookTitle: markdownScope.bookTitle }),
        reason: markdownScope.reason,
        markdownFileCount: markdownScope.files.length,
        beatNoteCount: beatScope.files.length,
    };

    const emptyResult = (): BeatSystemStructuralStatus => ({
        selectedSystem,
        selectedSystemKey,
        selectedSystemLabel,
        scope,
        expectedBeats,
        matchedBeats: [],
        beats: [],
        acts: [],
        summary: {
            expectedCount: expectedBeats.length,
            presentCount: 0,
            matchedCount: 0,
            completeCount: 0,
            issueCount: expectedBeats.length,
            missingCount: expectedBeats.length,
            duplicateCount: 0,
            misalignedCount: 0,
            outOfSequenceCount: 0,
            missingModelNoteCount: 0,
            missingModelBeatCount: 0,
            wrongModelBeatCount: 0,
            nonBeatClassBeatCount: 0,
            missingCreateableCount: expectedBeats.length,
            syncedCount: 0,
            statusLabel: expectedBeats.length === 0
                ? 'Structure status: No beats defined'
                : 'Structure status: Inactive in manuscript'
        },
        matches: {
            activeByBeatKey: new Map(),
            exactByBeatKey: new Map(),
            looseByBeatKey: new Map(),
            missingModelByBeatKey: new Map(),
        },
    });

    if (!scope.sourcePath) {
        return emptyResult();
    }

    const mappings = getActiveFrontmatterMappings(settings);
    const expectedModelKey = toBeatModelMatchKey(selectedSystemLabel);
    const exactByBeatKey = new Map<string, BeatMatchedNote[]>();
    const looseByBeatKey = new Map<string, BeatMatchedNote[]>();
    const missingModelByBeatKey = new Map<string, BeatMatchedNote[]>();
    const diagnosticsByBeatKey = new Map<string, { wrongModels: Set<string>; nonBeatClass: number }>();

    const pushMatch = (target: Map<string, BeatMatchedNote[]>, key: string, note: BeatMatchedNote) => {
        const list = target.get(key) ?? [];
        list.push(note);
        target.set(key, list);
    };

    const getDiagnostics = (key: string) => {
        const existing = diagnosticsByBeatKey.get(key);
        if (existing) return existing;
        const next = { wrongModels: new Set<string>(), nonBeatClass: 0 };
        diagnosticsByBeatKey.set(key, next);
        return next;
    };

    for (const file of markdownScope.files) {
        const key = normalizeBeatTitle(file.basename);
        if (!expectedKeySet.has(key)) continue;

        const cache = app.metadataCache.getFileCache(file);
        const raw = (cache?.frontmatter ?? {}) as Record<string, unknown>;
        const frontmatter = mappings ? normalizeFrontmatterKeys(raw, mappings) : raw;
        const note = toMatchedNote(file, frontmatter);
        const classValue = note.classValue ?? '';
        const storyBeat = classValue.length > 0 && isStoryBeat(classValue);
        const hasClass = classValue.length > 0;
        const modelKey = toBeatModelMatchKey(note.beatModel ?? '');
        const modelMatches = !!expectedModelKey && modelKey === expectedModelKey;

        if ((storyBeat || !hasClass) && modelMatches) {
            pushMatch(looseByBeatKey, key, note);
        }
        if (storyBeat && modelMatches) {
            pushMatch(exactByBeatKey, key, note);
            continue;
        }
        if (storyBeat && note.missingBeatModel) {
            pushMatch(missingModelByBeatKey, key, note);
            continue;
        }
        if (hasClass && !storyBeat) {
            getDiagnostics(key).nonBeatClass += 1;
            continue;
        }
        if (note.beatModel) {
            getDiagnostics(key).wrongModels.add(note.beatModel);
        }
    }

    const exactMatchedCount = expectedBeats.filter((beat) => (exactByBeatKey.get(beat.key)?.length ?? 0) > 0).length;
    const shouldUseLooseMatches = exactMatchedCount === 0 && [...looseByBeatKey.values()].some((entries) => entries.length > 0);
    const activeByBeatKey = shouldUseLooseMatches ? looseByBeatKey : exactByBeatKey;

    const beats = expectedBeats.map<BeatStructuralBeatStatus>((expected) => {
        const activeMatches = activeByBeatKey.get(expected.key) ?? [];
        const missingModelMatches = missingModelByBeatKey.get(expected.key) ?? [];
        const diagnostics = diagnosticsByBeatKey.get(expected.key);
        const relatedNotes = [
            ...activeMatches,
            ...missingModelMatches,
        ];

        const issues: BeatStructuralIssue[] = [];
        const hasAligned = activeMatches.some((note) => note.actNumber === expected.actNumber);
        const hasDuplicate = activeMatches.length > 1;
        const hasWrongModel = (diagnostics?.wrongModels.size ?? 0) > 0;
        const hasNonBeatClass = (diagnostics?.nonBeatClass ?? 0) > 0;
        const hasActiveMatch = activeMatches.length > 0;
        const hasUnresolvedMissingModel = !hasActiveMatch && missingModelMatches.length > 0;
        const hasUnresolvedWrongModel = !hasActiveMatch && hasWrongModel;
        const hasUnresolvedNonBeatClass = !hasActiveMatch && hasNonBeatClass;

        if (hasDuplicate) {
            issues.push(buildIssue('duplicate', 'Duplicate beat notes'));
        }
        if (activeMatches.length > 0 && !hasAligned) {
            issues.push(buildIssue('act_mismatch', 'Act mismatch'));
        }
        if (hasUnresolvedMissingModel) {
            issues.push(buildIssue('missing_model', 'Beat Model missing'));
        }
        if (hasUnresolvedWrongModel) {
            const models = [...(diagnostics?.wrongModels ?? [])].slice(0, 3);
            const suffix = (diagnostics?.wrongModels.size ?? 0) > 3
                ? ` (+${(diagnostics?.wrongModels.size ?? 0) - 3} more)`
                : '';
            issues.push(buildIssue('wrong_model', `Beat Model differs (${models.join(', ')}${suffix})`));
        }
        if (hasUnresolvedNonBeatClass) {
            issues.push(buildIssue('non_beat_class', 'Class is not Beat/Plot'));
        }

        const present = hasActiveMatch
            || hasUnresolvedMissingModel
            || hasUnresolvedWrongModel
            || hasUnresolvedNonBeatClass;
        const kind: BeatStructuralBeatStatus['kind'] = hasActiveMatch && hasAligned && !hasDuplicate
            ? 'complete'
            : present
                ? 'issue'
                : 'missing';

        if (kind === 'missing') {
            issues.unshift(buildIssue('missing', 'Missing beat note'));
        }

        return {
            expected,
            kind,
            present,
            matchedNotes: relatedNotes,
            issues,
            issueCount: kind === 'complete' ? 0 : Math.max(1, issues.length),
            isAligned: hasAligned,
            label: buildBeatLabel(kind),
        };
    });

    // Out-of-sequence detection:
    // A beat's position in the manuscript (filename prefix sort) must line up
    // with its position in the template ordinal sequence. If they diverge,
    // beats are physically out of order in the vault even when every beat is
    // present and in its correct act. This is a distinct defect from
    // act_mismatch and isn't caught by the other checks.
    //
    // We only consider beats that have at least one active match (otherwise
    // there's no file to rank). For each qualifying beat, pick a representative
    // file (the one whose filename prefix sorts lowest — i.e. its first
    // appearance in the manuscript), then compare the two rankings.
    const sequenceCandidates = beats
        .map((beat) => {
            const activeMatches = activeByBeatKey.get(beat.expected.key) ?? [];
            if (activeMatches.length === 0) return null;
            const representative = [...activeMatches].sort((a, b) => {
                const aPrefix = extractPrefixToken(a.basename);
                const bPrefix = extractPrefixToken(b.basename);
                return comparePrefixTokens(aPrefix, bPrefix);
            })[0];
            return {
                beatKey: beat.expected.key,
                templateOrdinal: beat.expected.ordinal,
                prefix: extractPrefixToken(representative.basename),
                basename: representative.basename,
            };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const outOfSequenceKeys = new Set<string>();
    if (sequenceCandidates.length >= 2) {
        const templateOrder = [...sequenceCandidates].sort((a, b) => a.templateOrdinal - b.templateOrdinal);
        const manuscriptOrder = [...sequenceCandidates].sort((a, b) => comparePrefixTokens(a.prefix, b.prefix));
        for (let i = 0; i < templateOrder.length; i++) {
            if (templateOrder[i].beatKey !== manuscriptOrder[i].beatKey) {
                outOfSequenceKeys.add(templateOrder[i].beatKey);
            }
        }
    }

    if (outOfSequenceKeys.size > 0) {
        beats.forEach((beat) => {
            if (!outOfSequenceKeys.has(beat.expected.key)) return;
            beat.issues.push(buildIssue('out_of_sequence', 'Out of manuscript sequence'));
            beat.issueCount = beat.issues.length;
            if (beat.kind === 'complete') {
                beat.kind = 'issue';
                beat.label = buildBeatLabel('issue');
            }
        });
    }

    const actMap = new Map<number, BeatStructuralBeatStatus[]>();
    beats.forEach((beat) => {
        const list = actMap.get(beat.expected.actNumber) ?? [];
        list.push(beat);
        actMap.set(beat.expected.actNumber, list);
    });

    const acts = [...actMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map<BeatStructuralActStatus>(([actNumber, actBeats]) => {
            const label = actBeats[0]?.expected.actLabel ?? `Act ${actNumber}`;
            const presentCount = actBeats.filter((beat) => beat.present).length;
            const completeCount = actBeats.filter((beat) => beat.kind === 'complete').length;
            const issueCount = actBeats.filter((beat) => beat.kind !== 'complete').length;
            return {
                actNumber,
                label,
                beats: actBeats,
                expectedCount: actBeats.length,
                presentCount,
                completeCount,
                issueCount,
                labelText: issueCount === 0
                    ? `${label} (${actBeats.length}) — ✔ Complete`
                    : `${label} (${actBeats.length}) — ⚠ ${issueCount} issue${issueCount !== 1 ? 's' : ''}`,
            };
        });

    const presentCount = beats.filter((beat) => beat.present).length;
    const matchedCount = beats.filter((beat) => (activeByBeatKey.get(beat.expected.key)?.length ?? 0) > 0).length;
    const completeCount = beats.filter((beat) => beat.kind === 'complete').length;
    const issueCount = beats.filter((beat) => beat.kind !== 'complete').length;
    const missingCount = beats.filter((beat) => beat.kind === 'missing').length;
    const duplicateCount = beats.filter((beat) => beat.issues.some((issue) => issue.code === 'duplicate')).length;
    const misalignedCount = beats.filter((beat) => beat.issues.some((issue) => issue.code === 'act_mismatch')).length;
    const outOfSequenceCount = beats.filter((beat) => beat.issues.some((issue) => issue.code === 'out_of_sequence')).length;
    const missingModelNoteCount = [...missingModelByBeatKey.values()].reduce((sum, notes) => sum + notes.length, 0);
    const missingModelBeatCount = beats.filter((beat) => beat.issues.some((issue) => issue.code === 'missing_model')).length;
    const wrongModelBeatCount = beats.filter((beat) => beat.issues.some((issue) => issue.code === 'wrong_model')).length;
    const nonBeatClassBeatCount = beats.filter((beat) => beat.issues.some((issue) => issue.code === 'non_beat_class')).length;
    const syncedCount = Math.max(0, matchedCount - misalignedCount - duplicateCount);
    const missingCreateableCount = Math.max(
        0,
        expectedBeats.length - matchedCount - missingModelBeatCount
    );

    const summary: BeatStructuralSummary = {
        expectedCount: expectedBeats.length,
        presentCount,
        matchedCount,
        completeCount,
        issueCount,
        missingCount,
        duplicateCount,
        misalignedCount,
        outOfSequenceCount,
        missingModelNoteCount,
        missingModelBeatCount,
        wrongModelBeatCount,
        nonBeatClassBeatCount,
        missingCreateableCount,
        syncedCount,
        statusLabel: matchedCount === 0
            ? 'Structure status: Inactive in manuscript'
            : issueCount === 0
                ? 'Structure status: ✔ Complete'
                : `Structure status: ⚠ ${issueCount} issue${issueCount !== 1 ? 's' : ''} • ${matchedCount} / ${expectedBeats.length} beats matched`,
    };

    return {
        selectedSystem,
        selectedSystemKey,
        selectedSystemLabel,
        scope,
        expectedBeats,
        matchedBeats: beats.filter((beat) => beat.present),
        beats,
        acts,
        summary,
        matches: {
            activeByBeatKey,
            exactByBeatKey,
            looseByBeatKey,
            missingModelByBeatKey,
        },
    };
}

// ─── Reading a structural status ───────────────────────────────────────────

export type PreviewIssueKind = 'missing' | 'incomplete';

export type PreviewIssueEntry = {
    beat: BeatStructuralBeatStatus;
    kind: PreviewIssueKind;
};

/** A beat is "missing" when absent, "incomplete" when it has an issue other than act placement. */
export function getPreviewIssueKind(status: BeatStructuralBeatStatus | null): PreviewIssueKind | null {
    if (!status) return null;
    if (status.kind === 'missing') return 'missing';
    const hasNonPlacementIssue = status.issues.some((issue) => issue.code !== 'act_mismatch');
    return hasNonPlacementIssue ? 'incomplete' : null;
}

export function getPreviewIssueEntries(structuralStatus: BeatSystemStructuralStatus | null): PreviewIssueEntry[] {
    return (structuralStatus?.beats ?? [])
        .map((beat) => {
            const kind = getPreviewIssueKind(beat);
            return kind ? { beat, kind } : null;
        })
        .filter((entry): entry is PreviewIssueEntry => !!entry)
        .sort((a, b) => a.beat.expected.ordinal - b.beat.expected.ordinal);
}

export function getPreviewIssueSummaryLabel(issues: PreviewIssueEntry[]): string[] {
    const labels: string[] = [];
    if (issues.some((entry) => entry.kind === 'missing')) labels.push('Missing');
    if (issues.some((entry) => entry.kind === 'incomplete')) labels.push('Incomplete');
    return labels;
}

function plural(count: number, one: string, many: string): string {
    return count !== 1 ? many : one;
}

/** The audit panel's structure lines for a beat system: one headline, then one line per kind of drift. */
export function describeStructuralStatus(structuralStatus: BeatSystemStructuralStatus | null): string[] {
    if (!structuralStatus) return [];
    const summary = structuralStatus.summary;
    if (summary.expectedCount === 0) {
        return ['Structure: No beats are defined for this system yet.'];
    }
    if (summary.matchedCount === 0) {
        if (summary.wrongModelBeatCount > 0) {
            return ['Structure: Matching beat titles exist, but they belong to a different Beat Model.'];
        }
        if (summary.missingModelNoteCount > 0) {
            return ['Structure: Matching beat titles exist, but some notes are missing Beat Model.'];
        }
        return ['Structure: This system is not active in the manuscript yet.'];
    }

    const lines: string[] = [];
    const topLevelLabels = getPreviewIssueSummaryLabel(getPreviewIssueEntries(structuralStatus));
    if (topLevelLabels.length > 0) {
        if (topLevelLabels.length === 1 && topLevelLabels[0] === 'Incomplete') {
            lines.push(`Structure: ${summary.issueCount} beat${plural(summary.issueCount, ' is', 's are')} incomplete.`);
        } else if (topLevelLabels.length === 1 && topLevelLabels[0] === 'Missing') {
            lines.push(`Structure: ${summary.missingCount} beat${plural(summary.missingCount, ' is', 's are')} missing from the manuscript.`);
        } else {
            lines.push(`Structure: ${topLevelLabels.join(' • ')}.`);
        }
    } else {
        lines.push('Structure: Aligned to the current beat template.');
    }

    if (summary.misalignedCount > 0) {
        lines.push(`${summary.misalignedCount} beat${plural(summary.misalignedCount, ' is', 's are')} placed in a different act than the template.`);
    }
    if (summary.outOfSequenceCount > 0) {
        lines.push(`${summary.outOfSequenceCount} beat${plural(summary.outOfSequenceCount, ' is', 's are')} out of manuscript sequence — filename prefixes do not match the template order.`);
    } else if (summary.misalignedCount > 0) {
        lines.push('Order remains intact.');
    }
    if (summary.missingModelNoteCount > 0) {
        lines.push(`${summary.missingModelNoteCount} matching note${plural(summary.missingModelNoteCount, ' is', 's are')} missing Beat Model.`);
    }
    if (summary.duplicateCount > 0) {
        lines.push(`${summary.duplicateCount} duplicate beat note${plural(summary.duplicateCount, ' was', 's were')} found.`);
    }
    return lines;
}
