import type { SceneRef } from '../types';
import { basename } from '../../utils/paths';

const SCENE_ID_REGEX = /^scn_[a-f0-9]{8,10}$/i;

type SceneRefEntry = {
    sceneId: string;
    path: string;
    label?: string;
    sceneNumber?: number;
    title?: string;
    aliases?: string[];
};

export type SceneRefIndex = {
    bySceneId: Map<string, SceneRefEntry>;
    byPath: Map<string, SceneRefEntry>;
    byLabel: Map<string, SceneRefEntry>;
    bySceneNumber: Map<number, SceneRefEntry[]>;
    byNormalizedKey: Map<string, SceneRefEntry[]>;
};

export type SceneRefNormalizationResult = {
    ref: SceneRef;
    normalizedFromLegacy: boolean;
    unresolved: boolean;
    warning?: string;
};

export function isStableSceneId(value: string | null | undefined): boolean {
    if (typeof value !== 'string') return false;
    return SCENE_ID_REGEX.test(value.trim());
}

export function buildSceneRefIndex(entries: SceneRefEntry[]): SceneRefIndex {
    const bySceneId = new Map<string, SceneRefEntry>();
    const byPath = new Map<string, SceneRefEntry>();
    const byLabel = new Map<string, SceneRefEntry>();
    const bySceneNumber = new Map<number, SceneRefEntry[]>();
    const byNormalizedKey = new Map<string, SceneRefEntry[]>();

    entries.forEach(entry => {
        const sceneId = normalizeSceneId(entry.sceneId);
        const path = normalizeText(entry.path);
        if (!sceneId || !path) return;

        const canonical: SceneRefEntry = {
            sceneId,
            path,
            label: normalizeText(entry.label),
            sceneNumber: Number.isFinite(entry.sceneNumber) ? Math.max(1, Math.floor(entry.sceneNumber as number)) : undefined,
            title: normalizeText(entry.title),
            aliases: (entry.aliases || []).map(alias => normalizeText(alias)).filter((alias): alias is string => !!alias)
        };

        bySceneId.set(sceneId.toLowerCase(), canonical);
        byPath.set(path.toLowerCase(), canonical);
        if (canonical.label) {
            byLabel.set(canonical.label.toLowerCase(), canonical);
        }

        indexEntryLookup(canonical, byNormalizedKey, bySceneNumber);
    });

    return {
        bySceneId,
        byPath,
        byLabel,
        bySceneNumber,
        byNormalizedKey
    };
}

export function normalizeSceneRef(
    input: Partial<SceneRef>,
    index: SceneRefIndex
): SceneRefNormalizationResult {
    const rawRefId = normalizeText(input.ref_id);
    const rawRefPath = normalizeText(input.ref_path);
    const rawRefLabel = normalizeText(input.ref_label);

    if (rawRefId && isStableSceneId(rawRefId) && index.bySceneId.has(rawRefId.toLowerCase())) {
        return {
            ref: {
                ref_id: normalizeSceneId(rawRefId)!,
                ref_label: rawRefLabel,
                ref_path: rawRefPath
            },
            normalizedFromLegacy: false,
            unresolved: false
        };
    }

    const candidates = [rawRefId, rawRefPath, rawRefLabel].filter((value): value is string => !!value);

    for (const candidate of candidates) {
        const resolved = resolveCandidate(candidate, index);
        if (resolved) {
            return {
                ref: {
                    ref_id: resolved.sceneId,
                    ref_label: rawRefLabel ?? resolved.label,
                    ref_path: rawRefPath ?? resolved.path
                },
                normalizedFromLegacy: true,
                unresolved: false,
                warning: `Normalized scene reference "${candidate}" to ${resolved.sceneId}.`
            };
        }
    }

    if (rawRefId && isStableSceneId(rawRefId)) {
        return {
            ref: {
                ref_id: '',
                ref_label: rawRefLabel,
                ref_path: rawRefPath
            },
            normalizedFromLegacy: false,
            unresolved: true,
            warning: `Canonical scene id "${rawRefId}" is not in the active corpus; leaving finding unbound.`
        };
    }

    return {
        ref: {
            ref_id: '',
            ref_label: rawRefLabel,
            ref_path: rawRefPath
        },
        normalizedFromLegacy: true,
        unresolved: true,
        warning: rawRefId
            ? `Could not resolve "${rawRefId}" to a canonical scene id; leaving finding unbound.`
            : 'Missing scene reference id; leaving finding unbound.'
    };
}

function normalizeSceneId(value: string | null | undefined): string | undefined {
    const normalized = normalizeText(value);
    if (!normalized || !isStableSceneId(normalized)) return undefined;
    return normalized.toLowerCase();
}

function normalizeText(value: string | null | undefined): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function resolveCandidate(candidate: string, index: SceneRefIndex): SceneRefEntry | undefined {
    const exact = candidate.toLowerCase();

    const bySceneId = index.bySceneId.get(exact);
    if (bySceneId) return bySceneId;

    const byPath = index.byPath.get(exact);
    if (byPath) return byPath;

    const byLabel = index.byLabel.get(exact);
    if (byLabel) return byLabel;

    const sceneToken = parseSceneNumberToken(candidate);
    if (sceneToken.sceneNumber !== undefined) {
        const byNumber = index.bySceneNumber.get(sceneToken.sceneNumber) || [];
        if (byNumber.length === 1) return byNumber[0];
        if (byNumber.length > 1 && sceneToken.slugKey) {
            const slugMatches = byNumber.filter(entry => entryMatchesSlug(entry, sceneToken.slugKey!));
            if (slugMatches.length === 1) return slugMatches[0];
        }
        return undefined;
    }

    const normalizedKey = normalizeLookupKey(candidate);
    if (normalizedKey) {
        const normalizedMatches = index.byNormalizedKey.get(normalizedKey);
        if (normalizedMatches?.length === 1) return normalizedMatches[0];
    }

    return undefined;
}

function indexEntryLookup(
    entry: SceneRefEntry,
    byNormalizedKey: Map<string, SceneRefEntry[]>,
    bySceneNumber: Map<number, SceneRefEntry[]>
): void {
    addNormalizedKey(byNormalizedKey, entry, entry.sceneId);
    addNormalizedKey(byNormalizedKey, entry, entry.path);
    addNormalizedKey(byNormalizedKey, entry, basename(entry.path));
    addNormalizedKey(byNormalizedKey, entry, removeExtension(basename(entry.path)));
    addNormalizedKey(byNormalizedKey, entry, entry.label);
    addNormalizedKey(byNormalizedKey, entry, entry.title);
    (entry.aliases || []).forEach(alias => addNormalizedKey(byNormalizedKey, entry, alias));

    if (Number.isFinite(entry.sceneNumber)) {
        const sceneNumber = Math.max(1, Math.floor(entry.sceneNumber as number));
        addSceneNumber(bySceneNumber, sceneNumber, entry);
        addNormalizedKey(byNormalizedKey, entry, String(sceneNumber));
        addNormalizedKey(byNormalizedKey, entry, `s${sceneNumber}`);
        addNormalizedKey(byNormalizedKey, entry, `scene ${sceneNumber}`);
    }
}

function addNormalizedKey(map: Map<string, SceneRefEntry[]>, entry: SceneRefEntry, raw: string | undefined): void {
    const normalized = normalizeLookupKey(raw);
    if (!normalized) return;
    addEntryToListMap(map, normalized, entry);
}

function addSceneNumber(map: Map<number, SceneRefEntry[]>, sceneNumber: number, entry: SceneRefEntry): void {
    addEntryToListMap(map, sceneNumber, entry);
}

function addEntryToListMap<K>(map: Map<K, SceneRefEntry[]>, key: K, entry: SceneRefEntry): void {
    const existing = map.get(key) || [];
    if (!existing.some(candidate => candidate.sceneId === entry.sceneId)) {
        existing.push(entry);
    }
    map.set(key, existing);
}

function parseSceneNumberToken(raw: string): { sceneNumber?: number; slugKey?: string } {
    const trimmed = normalizeText(raw);
    if (!trimmed) return {};
    const withoutPrefix = trimmed.replace(/^scn_/i, '').trim();

    const fullScene = withoutPrefix.match(/^f(?:ull)?(?:\s*scene)?[\s._-]*(\d{1,4})(?:[\s._-]+(.+))?$/i);
    const numbered = fullScene
        || withoutPrefix.match(/^s(?:cene)?[\s._-]*(\d{1,4})(?:[\s._-]+(.+))?$/i)
        || withoutPrefix.match(/^(\d{1,4})(?:[\s._-]+(.+))?$/i);
    if (!numbered) return {};

    const parsed = Number(numbered[1]);
    if (!Number.isFinite(parsed)) return {};
    const sceneNumber = Math.max(1, Math.floor(parsed));
    const slugKey = normalizeLookupKey(numbered[2]);
    return { sceneNumber, ...(slugKey ? { slugKey } : {}) };
}

function entryMatchesSlug(entry: SceneRefEntry, slugKey: string): boolean {
    const tokens = [
        entry.title,
        entry.label,
        entry.path,
        basename(entry.path),
        removeExtension(basename(entry.path)),
        ...(entry.aliases || [])
    ];
    return tokens.some(token => {
        const key = normalizeLookupKey(token);
        return !!key && key.includes(slugKey);
    });
}

function normalizeLookupKey(raw: string | undefined): string | undefined {
    const text = normalizeText(raw);
    if (!text) return undefined;
    const noExt = removeExtension(text);
    const normalized = noExt
        .toLowerCase()
        .replace(/[/\\]+/g, ' ')
        .replace(/[_\-.]+/g, ' ')
        .replace(/[^a-z0-9\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.length > 0 ? normalized : undefined;
}

function removeExtension(value: string): string {
    return value.replace(/\.[a-z0-9]{1,8}$/i, '');
}
