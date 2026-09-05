export const SCENE_ID_PREFIX = 'scn_';
const DEFAULT_HEX_LENGTH = 8;
const MIN_HEX_LENGTH = 8;
const MAX_HEX_LENGTH = 10;
const SCENE_CLASS_KEY = 'class';
const SCENE_ID_KEY = 'id';
const CANONICAL_REFERENCE_ID_KEY = 'ID';

export function generateSceneId(hexLength: number = DEFAULT_HEX_LENGTH): string {
    const length = clampHexLength(hexLength);
    const byteLength = Math.ceil(length / 2);
    const bytes = new Uint8Array(byteLength);
    const cryptoApi = window.crypto;
    if (cryptoApi?.getRandomValues) {
        cryptoApi.getRandomValues(bytes);
    } else {
        for (let idx = 0; idx < byteLength; idx += 1) {
            bytes[idx] = Math.floor(Math.random() * 256);
        }
    }
    const hex = Array.from(bytes)
        .map(value => value.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, length);
    return `${SCENE_ID_PREFIX}${hex}`;
}

/**
 * Lookup keys for scene-id frontmatter, in priority order.
 * - `id` / `ID` — canonical (what new writes use)
 * - `SceneId` / `Scene Id` / `Scene_Id` / `Scene-Id` — legacy variants present
 *   in scene files written before the canonical key was introduced. Without
 *   these, manuscript exports and Inquiry runs would silently lose scene
 *   anchoring on every legacy file.
 */
const SCENE_ID_LOOKUP_KEYS = [SCENE_ID_KEY, 'sceneid', 'scene id', 'scene_id', 'scene-id'];

export function readSceneId(frontmatter: Record<string, unknown> | null | undefined): string | undefined {
    if (!frontmatter || typeof frontmatter !== 'object') return undefined;
    for (const candidate of SCENE_ID_LOOKUP_KEYS) {
        const key = findCaseInsensitiveKey(frontmatter, candidate);
        if (!key) continue;
        const value = frontmatter[key];
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed.length > 0) return trimmed;
    }
    return undefined;
}

export const readReferenceId = readSceneId;

export function isSceneClassFrontmatter(frontmatter: Record<string, unknown> | null | undefined): boolean {
    if (!frontmatter || typeof frontmatter !== 'object') return false;
    const classKey = findCaseInsensitiveKey(frontmatter, SCENE_CLASS_KEY);
    if (!classKey) return false;
    const raw = frontmatter[classKey];
    const values = Array.isArray(raw) ? raw : [raw];
    return values.some(value => String(value ?? '').trim().toLowerCase() === 'scene');
}

export function ensureSceneIdFrontmatter(
    frontmatter: Record<string, unknown>,
    providedId?: string
): { frontmatter: Record<string, unknown>; sceneId: string; changed: boolean } {
    const ensured = ensureReferenceIdFrontmatter(frontmatter, {
        providedId,
        classFallback: 'Scene'
    });
    return {
        frontmatter: ensured.frontmatter,
        sceneId: ensured.id,
        changed: ensured.changed
    };
}

export function ensureReferenceIdFrontmatter(
    frontmatter: Record<string, unknown>,
    options: {
        providedId?: string;
        classFallback?: string;
        forceId?: string;
    } = {}
): { frontmatter: Record<string, unknown>; id: string; changed: boolean } {
    const existingId = readReferenceId(frontmatter);
    const forcedId = normalizeSceneIdValue(options.forceId);
    const id = forcedId ?? existingId ?? normalizeSceneIdValue(options.providedId) ?? generateSceneId();
    const classKey = findCaseInsensitiveKey(frontmatter, SCENE_CLASS_KEY);
    const idKey = findCaseInsensitiveKey(frontmatter, SCENE_ID_KEY);
    const ordered: Record<string, unknown> = {};

    ordered[CANONICAL_REFERENCE_ID_KEY] = id;
    if (classKey) {
        ordered[classKey] = frontmatter[classKey];
    } else if (options.classFallback) {
        ordered.Class = options.classFallback;
    }

    for (const [key, value] of Object.entries(frontmatter)) {
        const lower = key.toLowerCase();
        if (lower === SCENE_ID_KEY || lower === SCENE_CLASS_KEY) continue;
        ordered[key] = value;
    }

    const changed = forcedId
        ? (existingId !== forcedId || idKey !== CANONICAL_REFERENCE_ID_KEY || (!classKey && !!options.classFallback))
        : (!existingId || idKey !== CANONICAL_REFERENCE_ID_KEY || (!classKey && !!options.classFallback));
    return {
        frontmatter: ordered,
        id,
        changed
    };
}

export function ensureReferenceIdTemplateFrontmatter(
    template: string,
    classFallback: string
): { frontmatter: string; id: string } {
    const lines = template.split('\n');
    const remaining: string[] = [];
    let classLine: string | undefined;
    let existingId: string | undefined;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed && remaining.length === 0) continue;

        if (!existingId && /^id\s*:/i.test(trimmed)) {
            const rawValue = trimmed.replace(/^id\s*:/i, '').trim();
            existingId = normalizeSceneIdValue(rawValue);
            continue;
        }
        if (!classLine && /^class\s*:/i.test(trimmed)) {
            classLine = line;
            continue;
        }
        remaining.push(line);
    }

    const id = existingId ?? generateSceneId();
    const outputLines = [`${CANONICAL_REFERENCE_ID_KEY}: ${id}`, classLine ?? `Class: ${classFallback}`, ...remaining];
    return {
        frontmatter: outputLines.join('\n').trimEnd(),
        id
    };
}

export function ensureSceneTemplateFrontmatter(template: string): { frontmatter: string; sceneId: string } {
    const ensured = ensureReferenceIdTemplateFrontmatter(template, 'Scene');
    return {
        frontmatter: ensured.frontmatter,
        sceneId: ensured.id
    };
}

export function resolveSceneReferenceId(sceneId: string | undefined, filePath: string): string {
    const normalized = normalizeSceneIdValue(sceneId);
    if (normalized) return normalized;
    return filePath;
}

function findCaseInsensitiveKey(frontmatter: Record<string, unknown>, key: string): string | undefined {
    const lower = key.toLowerCase();
    return Object.keys(frontmatter).find(entry => entry.toLowerCase() === lower);
}

function normalizeSceneIdValue(value: string | undefined): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function clampHexLength(length: number): number {
    if (!Number.isFinite(length)) return DEFAULT_HEX_LENGTH;
    const normalized = Math.floor(length);
    return Math.min(MAX_HEX_LENGTH, Math.max(MIN_HEX_LENGTH, normalized));
}
