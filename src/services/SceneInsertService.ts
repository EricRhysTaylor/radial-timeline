import { App, TFile, getFrontMatterInfo } from 'obsidian';
import type { RadialTimelineSettings, TimelineItem } from '../types';
import { getTemplateParts } from '../utils/yamlTemplateNormalize';
import { generateSceneContent } from '../utils/sceneGenerator';
import { ensureSceneTemplateFrontmatter } from '../utils/sceneIds';
import { comparePrefixTokens, extractPrefixToken } from '../utils/prefixOrder';
import { filterBeatsBySystem } from '../utils/gossamer';
import { getActiveFrontmatterMappings } from '../utils/frontmatter';

export interface SceneInsertOptions {
    app: App;
    settings: RadialTimelineSettings;
    anchorFile: TFile;
    primarySubplot?: string;
    getSceneData: () => Promise<TimelineItem[]>;
    beatModel?: string;
}

export interface SceneInsertResult {
    path: string;
    filename: string;
}

export interface SceneInsertionPlan {
    anchorPath: string;
    anchorBasename: string;
    path: string;
    filename: string;
    actNumber: number;
    when: string;
    subplotLabel: string;
    yamlMode: 'Basic' | 'Advanced';
    frontmatter: string;
}

interface InsertionCandidate {
    path: string;
    itemType: 'Scene' | 'Beat';
    basename: string;
    actNumber: number;
    sourceIndex: number;
}

const NEW_SCENE_LABEL = 'New Scene';

function getLocalDateString(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function basenameFromPath(path: string): string {
    const fileName = path.split('/').pop() ?? path;
    const extensionMatch = fileName.match(/\.([^.]+)$/);
    return extensionMatch ? fileName.slice(0, -(extensionMatch[0].length)) : fileName;
}

function parentPathFor(file: TFile): string {
    return file.parent?.path ?? '';
}

function joinVaultPath(parentPath: string, filename: string): string {
    return parentPath ? `${parentPath}/${filename}` : filename;
}

function formatPrefixNumber(value: number): string {
    if (!Number.isFinite(value)) return '1';
    const fixed = value.toFixed(6).replace(/0+$/g, '').replace(/\.$/, '');
    return fixed || '1';
}

function parsePrefixNumber(prefix: string | null): number | null {
    if (!prefix) return null;
    const value = Number(prefix);
    return Number.isFinite(value) ? value : null;
}

function normalizePrimarySubplot(primarySubplot?: string): string[] {
    const normalized = (primarySubplot ?? '').trim();
    if (!normalized || normalized === 'Main Plot') return [];
    return [normalized];
}

function getActNumber(item: TimelineItem): number {
    const fromActNumber = Number(item.actNumber);
    if (Number.isFinite(fromActNumber) && fromActNumber > 0) return fromActNumber;
    const fromAct = Number(item.act ?? 1);
    return Number.isFinite(fromAct) && fromAct > 0 ? fromAct : 1;
}

function getActiveBeatPaths(items: TimelineItem[], beatModel?: string): Set<string> | undefined {
    const beats = items.filter((item): item is TimelineItem & { path: string } =>
        item.itemType === 'Beat' && typeof item.path === 'string' && item.path.length > 0
    );
    if (beats.length === 0) return undefined;
    const filtered = filterBeatsBySystem(
        beats.map((item) => ({
            path: item.path,
            'Beat Model': typeof item['Beat Model'] === 'string' ? item['Beat Model'] : undefined
        })),
        beatModel
    );
    return new Set(filtered.map((beat) => beat.path));
}

function collectCandidates(items: TimelineItem[], beatModel?: string): InsertionCandidate[] {
    const activeBeatPaths = getActiveBeatPaths(items, beatModel);
    const byPath = new Map<string, InsertionCandidate>();
    items.forEach((item, sourceIndex) => {
        if (!item.path) return;
        if (item.itemType !== 'Scene' && item.itemType !== 'Beat') return;
        if (item.itemType === 'Beat' && activeBeatPaths && !activeBeatPaths.has(item.path)) return;
        if (byPath.has(item.path)) return;
        byPath.set(item.path, {
            path: item.path,
            itemType: item.itemType,
            basename: basenameFromPath(item.path),
            actNumber: getActNumber(item),
            sourceIndex
        });
    });
    return Array.from(byPath.values());
}

function sortCandidatesByManuscriptOrder(candidates: InsertionCandidate[]): InsertionCandidate[] {
    return candidates.slice().sort((a, b) => {
        if (a.actNumber !== b.actNumber) return a.actNumber - b.actNumber;
        const prefixCmp = comparePrefixTokens(extractPrefixToken(a.basename), extractPrefixToken(b.basename));
        if (prefixCmp !== 0) return prefixCmp;
        const basenameCmp = a.basename.localeCompare(b.basename, undefined, { numeric: true, sensitivity: 'base' });
        if (basenameCmp !== 0) return basenameCmp;
        const pathCmp = a.path.localeCompare(b.path);
        if (pathCmp !== 0) return pathCmp;
        return a.sourceIndex - b.sourceIndex;
    });
}

function findInsertionIndexAfterSceneBeatGap(ordered: InsertionCandidate[], anchorPath: string): number {
    const anchorIndex = ordered.findIndex((entry) => entry.path === anchorPath && entry.itemType === 'Scene');
    if (anchorIndex === -1) return ordered.length;
    let insertionIndex = anchorIndex + 1;
    while (insertionIndex < ordered.length && ordered[insertionIndex]?.itemType === 'Beat') {
        insertionIndex += 1;
    }
    return insertionIndex;
}

export function buildDecimalSceneInsertionPrefix(
    items: TimelineItem[],
    anchorPath: string,
    beatModel?: string
): string {
    const ordered = sortCandidatesByManuscriptOrder(collectCandidates(items, beatModel));
    const anchorIndex = ordered.findIndex((entry) => entry.path === anchorPath && entry.itemType === 'Scene');
    const insertionIndex = findInsertionIndexAfterSceneBeatGap(ordered, anchorPath);
    const anchor = anchorIndex >= 0 ? ordered[anchorIndex] : undefined;
    const next = ordered.slice(insertionIndex).find((entry) => entry.itemType === 'Scene');
    const existingPrefixes = new Set(ordered.map((entry) => extractPrefixToken(entry.basename)).filter((value): value is string => !!value));

    const anchorNumber = parsePrefixNumber(extractPrefixToken(anchor?.basename));
    const nextNumber = parsePrefixNumber(extractPrefixToken(next?.basename));

    if (anchorNumber !== null && nextNumber !== null && nextNumber > anchorNumber) {
        let high = nextNumber;
        for (let attempt = 0; attempt < 12; attempt += 1) {
            const candidate = formatPrefixNumber((anchorNumber + high) / 2);
            if (!existingPrefixes.has(candidate)) return candidate;
            high = Number(candidate);
        }
    }

    if (anchorNumber !== null) {
        let candidateNumber = Math.floor(anchorNumber) + 1;
        if (candidateNumber <= anchorNumber) candidateNumber = anchorNumber + 0.5;
        for (let attempt = 0; attempt < 100; attempt += 1) {
            const candidate = formatPrefixNumber(candidateNumber + attempt);
            if (!existingPrefixes.has(candidate)) return candidate;
        }
    }

    const fallback = anchorIndex >= 0 ? anchorIndex + 2 : ordered.length + 1;
    return formatPrefixNumber(fallback);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractRawFrontmatterScalar(frontmatter: string, keys: string[]): string {
    const lines = frontmatter.split(/\r?\n/);
    for (const key of keys) {
        const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(.*)$`, 'i');
        for (const line of lines) {
            const match = pattern.exec(line);
            if (match) return (match[1] ?? '').trim();
        }
    }
    return '';
}

function formatDateForYaml(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = date.getHours();
    const minute = date.getMinutes();
    const second = date.getSeconds();
    if (hour === 12 && minute === 0 && second === 0) return `${year}-${month}-${day}`;
    return `${year}-${month}-${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeWhenFallback(value: unknown): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDateForYaml(value);
    if (Array.isArray(value)) return value.length > 0 ? normalizeWhenFallback(value[0]) : '';
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toString().trim();
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value).trim();
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value).trim();
        } catch {
            return '';
        }
    }
    return '';
}

async function readAnchorWhen(app: App, settings: RadialTimelineSettings, file: TFile): Promise<string> {
    const content = await app.vault.read(file);
    const info = getFrontMatterInfo(content);
    const mappedWhenKeys = Object.entries(getActiveFrontmatterMappings(settings) ?? {})
        .filter(([, canonical]) => canonical === 'When')
        .map(([raw]) => raw);
    const rawWhen = info.frontmatter
        ? extractRawFrontmatterScalar(info.frontmatter, ['When', ...mappedWhenKeys])
        : '';
    if (rawWhen) return rawWhen;
    const cache = app.metadataCache.getFileCache(file);
    return normalizeWhenFallback(cache?.frontmatter?.When);
}

async function resolveAnchorActNumber(items: TimelineItem[], anchorPath: string, app: App, file: TFile): Promise<number> {
    const fromSceneData = items.find((item) => item.path === anchorPath && item.itemType === 'Scene');
    if (fromSceneData) return getActNumber(fromSceneData);
    const cache = app.metadataCache.getFileCache(file);
    const rawAct = cache?.frontmatter?.Act;
    const act = Number(rawAct ?? 1);
    return Number.isFinite(act) && act > 0 ? act : 1;
}

function buildUniqueScenePath(app: App, parentPath: string, prefix: string): { path: string; filename: string } {
    for (let attempt = 1; attempt < 1000; attempt += 1) {
        const suffix = attempt === 1 ? '' : ` ${attempt}`;
        const filename = `${prefix} ${NEW_SCENE_LABEL}${suffix}.md`;
        const path = joinVaultPath(parentPath, filename);
        if (!app.vault.getAbstractFileByPath(path)) return { path, filename };
    }
    const filename = `${prefix} ${NEW_SCENE_LABEL} ${Date.now()}.md`;
    return { path: joinVaultPath(parentPath, filename), filename };
}

export async function planSceneInsertion(options: SceneInsertOptions): Promise<SceneInsertionPlan> {
    const anchorPath = options.anchorFile.path;
    const sceneData = await options.getSceneData();
    const actNumber = await resolveAnchorActNumber(sceneData, anchorPath, options.app, options.anchorFile);
    const when = await readAnchorWhen(options.app, options.settings, options.anchorFile);
    // Adding a scene always inserts a decimal between the anchor and the next
    // scene, so nothing else in the manuscript moves. Ripple renumbering is a
    // drag-reorder concern (`enableManuscriptRippleRename`) and deliberately
    // does not reach this path.
    const prefix = buildDecimalSceneInsertionPrefix(sceneData, anchorPath, options.beatModel);
    const parentPath = parentPathFor(options.anchorFile);
    const { path, filename } = buildUniqueScenePath(options.app, parentPath, prefix);
    const templateParts = getTemplateParts('Scene', options.settings);
    const useAdvanced = options.settings.sceneAdvancedPropertiesEnabled ?? true;
    const template = useAdvanced ? templateParts.merged : templateParts.base;
    const subplots = normalizePrimarySubplot(options.primarySubplot);
    const content = generateSceneContent(template, {
        act: actNumber,
        when,
        due: getLocalDateString(),
        sceneNumber: prefix,
        subplots,
        character: '',
        place: '',
        characterList: [],
        placeList: []
    });

    return {
        anchorPath,
        anchorBasename: options.anchorFile.basename,
        path,
        filename,
        actNumber,
        when,
        subplotLabel: subplots[0] ?? 'Main Plot',
        yamlMode: useAdvanced ? 'Advanced' : 'Basic',
        frontmatter: ensureSceneTemplateFrontmatter(content).frontmatter
    };
}

export async function applySceneInsertionPlan(app: App, plan: SceneInsertionPlan): Promise<SceneInsertResult> {
    await app.vault.create(plan.path, `---\n${plan.frontmatter}\n---\n\n`);
    return { path: plan.path, filename: plan.filename };
}

export async function insertSceneAfterAnchor(options: SceneInsertOptions): Promise<SceneInsertResult> {
    const plan = await planSceneInsertion(options);
    return applySceneInsertionPlan(options.app, plan);
}
