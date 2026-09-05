import { kebabSlug } from '../../utils/slug';
import type { App } from 'obsidian';

type MaybePromise<T> = T | Promise<T>;

type AnySecretStorage = {
    get?: (key: string) => MaybePromise<string | null | undefined>;
    has?: (key: string) => MaybePromise<boolean>;
    set?: (key: string, value: string) => MaybePromise<void>;
    store?: (key: string, value: string) => MaybePromise<void>;
    delete?: (key: string) => MaybePromise<void>;
    remove?: (key: string) => MaybePromise<void>;
    getSecret?: (key: string) => MaybePromise<string | null | undefined>;
    setSecret?: (key: string, value: string) => MaybePromise<void>;
    listSecrets?: () => MaybePromise<string[]>;
};

function getStorage(app: App): AnySecretStorage | null {
    const storage = (app as unknown as { secretStorage?: AnySecretStorage }).secretStorage;
    if (!storage || typeof storage !== 'object') return null;
    const hasReadMethod = typeof storage.get === 'function' || typeof storage.getSecret === 'function';
    if (!hasReadMethod) return null;
    return storage;
}

function normalizeSecretId(secretId: string): string {
    return kebabSlug(secretId, '');
}

function getReadCandidates(storage: AnySecretStorage, secretId: string): string[] {
    const raw = secretId.trim();
    if (!raw.length) return [];
    const normalized = normalizeSecretId(raw);
    if (!normalized.length) return [];
    const usesModernSecretApi = typeof storage.getSecret === 'function' || typeof storage.setSecret === 'function';
    if (!usesModernSecretApi || raw === normalized) return [raw];
    return [normalized, raw];
}

function getWriteCandidates(storage: AnySecretStorage, secretId: string): string[] {
    const raw = secretId.trim();
    if (!raw.length) return [];
    const normalized = normalizeSecretId(raw);
    if (!normalized.length) return [];
    const usesModernSecretApi = typeof storage.getSecret === 'function' || typeof storage.setSecret === 'function';
    if (!usesModernSecretApi || raw === normalized) return [raw];
    return [normalized, raw];
}

export function isSecretStorageAvailable(app: App): boolean {
    const storage = getStorage(app);
    if (!storage) return false;
    return typeof storage.setSecret === 'function'
        || typeof storage.set === 'function'
        || typeof storage.store === 'function';
}

export async function getSecret(app: App, secretId: string): Promise<string | null> {
    const storage = getStorage(app);
    if (!storage) return null;
    const candidates = getReadCandidates(storage, secretId || '');
    if (!candidates.length) return null;
    for (const id of candidates) {
        try {
            const value = typeof storage.getSecret === 'function'
                ? await storage.getSecret(id)
                : await storage.get?.(id);
            if (!value || typeof value !== 'string') continue;
            const trimmed = value.trim();
            if (trimmed.length) return trimmed;
        } catch {
            continue;
        }
    }
    return null;
}

export async function hasSecret(app: App, secretId: string): Promise<boolean> {
    const storage = getStorage(app);
    if (!storage) return false;
    const candidates = getReadCandidates(storage, secretId || '');
    if (!candidates.length) return false;
    try {
        if (typeof storage.listSecrets === 'function') {
            const listed = await storage.listSecrets();
            if (!Array.isArray(listed)) return false;
            const ids = new Set(listed.map(id => String(id).trim()).filter(Boolean));
            return candidates.some(id => ids.has(id));
        }
    } catch {
        // Fall back to per-id checks below.
    }
    if (typeof storage.has === 'function') {
        for (const id of candidates) {
            try {
                if (await storage.has(id)) return true;
            } catch {
                continue;
            }
        }
        return false;
    }
    return !!(await getSecret(app, secretId));
}

export async function setSecret(app: App, secretId: string, secretValue: string): Promise<boolean> {
    const storage = getStorage(app);
    if (!storage) return false;
    const ids = getWriteCandidates(storage, secretId || '');
    if (!ids.length) return false;
    const value = (secretValue || '').trim();
    if (!value.length) return false;
    for (const id of ids) {
        try {
            if (typeof storage.setSecret === 'function') {
                await storage.setSecret(id, value);
                return true;
            }
            if (typeof storage.set === 'function') {
                await storage.set(id, value);
                return true;
            }
            if (typeof storage.store === 'function') {
                await storage.store(id, value);
                return true;
            }
        } catch {
            continue;
        }
    }
    return false;
}

export async function deleteSecret(app: App, secretId: string): Promise<boolean> {
    const storage = getStorage(app);
    if (!storage) return false;
    const ids = getWriteCandidates(storage, secretId || '');
    if (!ids.length) return false;
    for (const id of ids) {
        try {
            if (typeof storage.delete === 'function') {
                await storage.delete(id);
                return true;
            }
            if (typeof storage.remove === 'function') {
                await storage.remove(id);
                return true;
            }
        } catch {
            continue;
        }
    }
    return false;
}
