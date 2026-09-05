import type { InquirySceneItem } from '../services/InquiryCorpusResolver';
import { buildBriefingPurgeAvailabilityKey } from './briefingPurgeAvailabilityKey';
import type { InquiryScope } from '../state';

export interface BriefingPurgeScannerDeps {
    /** Returns the current scenes the scan should consider. */
    getScenes: () => InquirySceneItem[];
    /** Current scope ('book' | 'saga'). */
    getScope: () => InquiryScope;
    /** Active book id when scope === 'book' (undefined for saga). */
    getActiveBookId: () => string | undefined;
    /** Resolves the action-notes frontmatter field label. */
    resolveActionNotesFieldLabel: () => string;
    /** Scanner that determines which scenes have purgeable action items. */
    scanForActionItems: (scenes: InquirySceneItem[]) => Promise<unknown[]>;
    /** Called when scanner state changes so callers can re-render dependent UI. */
    onStateChange: () => void;
}

/**
 * Owns the purge-availability scan state for the briefing footer.
 *
 * Tracks an availability key derived from scenes/scope/activeBook/fieldLabel;
 * a stale key means the cached result is invalid and a fresh scan is needed.
 * `token` guards against late-arriving scans superseded by newer ones.
 */
export class InquiryBriefingPurgeScanner {
    private availabilityKey = '';
    private available = false;
    private pending = false;
    private token = 0;

    constructor(private readonly deps: BriefingPurgeScannerDeps) {}

    isAvailable(): boolean { return this.available; }
    isPending(): boolean { return this.pending; }

    /** Drop any cached result and bump the token so in-flight scans are ignored. */
    invalidate(): void {
        this.availabilityKey = '';
        this.available = false;
        this.pending = false;
        this.token++;
    }

    /**
     * Mark scanner state from an externally-performed scan (used by the
     * purge confirmation flow that scans synchronously before opening the
     * modal — avoids a redundant async refresh).
     */
    markFromExternalScan(affectedCount: number): void {
        this.availabilityKey = this.computeKey();
        this.available = affectedCount > 0;
        this.pending = false;
        this.deps.onStateChange();
    }

    /**
     * Refresh the scan, skipping work when the cached key still matches and
     * no scan is in flight. Late results (token mismatch or key changed
     * mid-scan) are discarded.
     */
    async refresh(): Promise<void> {
        const scanKey = this.computeKey();
        if (!scanKey) {
            this.availabilityKey = '';
            this.available = false;
            this.pending = false;
            this.deps.onStateChange();
            return;
        }
        if (this.availabilityKey === scanKey && !this.pending) {
            this.deps.onStateChange();
            return;
        }

        this.availabilityKey = scanKey;
        this.available = false;
        this.pending = true;
        const scanToken = ++this.token;
        this.deps.onStateChange();

        const affectedScenes = await this.deps.scanForActionItems(this.deps.getScenes());
        if (scanToken !== this.token || this.availabilityKey !== scanKey) {
            return;
        }

        this.pending = false;
        this.available = affectedScenes.length > 0;
        this.deps.onStateChange();
    }

    private computeKey(): string {
        return buildBriefingPurgeAvailabilityKey({
            scenes: this.deps.getScenes(),
            scope: this.deps.getScope(),
            activeBookId: this.deps.getActiveBookId(),
            actionNotesFieldLabel: this.deps.resolveActionNotesFieldLabel(),
        });
    }
}
