export interface AICacheEntry {
    key: string;
    value: unknown;
    createdAt: number;
}

export class AICache {
    private entries = new Map<string, AICacheEntry>();
    constructor(private ttlMs: number = 2 * 60 * 1000) {}

    get<T = unknown>(key: string): T | null {
        const entry = this.entries.get(key);
        if (!entry) return null;
        if ((Date.now() - entry.createdAt) > this.ttlMs) {
            this.entries.delete(key);
            return null;
        }
        return entry.value as T;
    }

    set(key: string, value: unknown): void {
        this.entries.set(key, {
            key,
            value,
            createdAt: Date.now()
        });
    }
}
