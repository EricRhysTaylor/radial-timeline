import { makeFile } from '../../tests/helpers/obsidianFixtures';
import { describe, expect, it } from 'vitest';
import type { App, TFile } from 'obsidian';
import { applyAuditFindings } from './apply';
import type { TimelineAuditFinding } from './types';

function makeFinding(path: string, action: TimelineAuditFinding['reviewAction'], options: Partial<TimelineAuditFinding> = {}): TimelineAuditFinding {
    return {
        file: makeFile(path),
        sceneId: path,
        title: path,
        path,
        manuscriptOrderIndex: 0,
        currentWhenRaw: '2026-01-01 08:00',
        currentWhen: new Date('2026-01-01T08:00:00'),
        whenValid: true,
        whenParseIssue: null,
        expectedChronologyPosition: 1,
        inferredWrittenTimelinePosition: null,
        status: 'warning',
        issues: [],
        evidence: [],
        rationale: '',
        suggestedWhen: action === 'apply' ? new Date('2026-01-02T19:00:00') : null,
        suggestedConfidence: action === 'apply' ? 'high' : null,
        suggestedProvenance: action === 'apply' ? 'keyword' : null,
        allowedActions: ['apply', 'keep', 'mark_review'],
        reviewAction: action,
        unresolved: action !== 'apply',
        aiSuggested: false,
        safeApplyEligible: action === 'apply',
        ...options
    };
}

describe('timeline audit apply adapter', () => {
    it('writes only accepted When changes and never touches plugin bookkeeping in YAML', async () => {
        const docs = new Map<string, Record<string, unknown>>([
            // Legacy field from an earlier plugin version — apply must not manage it.
            ['Story/1 Apply.md', { When: '2026-01-01 08:00', NeedsReview: true }],
            ['Story/2 Keep.md', { When: '2026-01-01 08:00' }],
            ['Story/3 Review.md', { When: '2026-01-01 08:00' }]
        ]);
        const touched: string[] = [];

        const app = {
            fileManager: {
                processFrontMatter: async (file: TFile, updater: (fm: Record<string, unknown>) => void) => {
                    const current = docs.get(file.path);
                    if (!current) throw new Error(`Missing doc: ${file.path}`);
                    touched.push(file.path);
                    updater(current);
                }
            },
            vault: {
                // No change log in this stub vault.
                getAbstractFileByPath: () => null,
                createFolder: async () => undefined,
                create: async () => { throw new Error('log write not under test'); }
            }
        } as unknown as App;

        await applyAuditFindings(app, [
            makeFinding('Story/1 Apply.md', 'apply'),
            makeFinding('Story/2 Keep.md', 'keep'),
            makeFinding('Story/3 Review.md', 'mark_review')
        ]);

        // Accepted suggestion writes the new When and nothing else.
        expect(docs.get('Story/1 Apply.md')?.When).toBe('2026-01-02 19:00');
        expect(docs.get('Story/1 Apply.md')?.WhenSource).toBeUndefined();
        expect(docs.get('Story/1 Apply.md')?.NeedsReview).toBe(true); // legacy field left alone

        // Keep / mark-review are session decisions — those files are never opened.
        expect(touched).toEqual(['Story/1 Apply.md']);
        expect(docs.get('Story/2 Keep.md')?.NeedsReview).toBeUndefined();
        expect(docs.get('Story/3 Review.md')?.NeedsReview).toBeUndefined();
    });

    it('writes an individually accepted AI date suggestion without treating it as bulk-safe', async () => {
        const docs = new Map<string, Record<string, unknown>>([
            ['Story/7 Flashback.md', { When: '2085-04-01 08:00' }]
        ]);
        const app = {
            fileManager: {
                processFrontMatter: async (file: TFile, updater: (fm: Record<string, unknown>) => void) => {
                    const current = docs.get(file.path);
                    if (!current) throw new Error(`Missing doc: ${file.path}`);
                    updater(current);
                }
            },
            vault: {
                getAbstractFileByPath: () => null,
                createFolder: async () => undefined,
                create: async () => { throw new Error('log write not under test'); }
            }
        } as unknown as App;

        await applyAuditFindings(app, [makeFinding('Story/7 Flashback.md', 'apply', {
            suggestedWhen: new Date('2077-10-14T13:13:00'),
            suggestedConfidence: 'med',
            suggestedProvenance: 'ai',
            aiSuggested: true,
            safeApplyEligible: false
        })]);

        expect(docs.get('Story/7 Flashback.md')?.When).toBe('2077-10-14 13:13');
    });
});
