import { describe, expect, it, vi } from 'vitest';
import { InquiryView } from './InquiryView';
import { InquiryService } from './InquiryService';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../main';

function browsingView(enabled: boolean, credential: boolean, blocked: boolean, saved = true) {
    const reopenSessionByKey = vi.fn(() => true);
    const notifyInteraction = vi.fn();
    const invalidate = vi.fn();
    const requestSnapshot = vi.fn();
    const view = Object.assign(Object.create(InquiryView.prototype), {
        plugin: {
            settings: { enableAiSceneAnalysis: enabled },
            getInquiryEstimateService: () => ({ invalidate, requestSnapshot })
        },
        state: { scope: 'book', activeBookId: 'book-1', isRunning: false },
        guidanceState: 'results',
        getResolvedEngine: () => ({ hasCredential: credential, blocked }),
        sessionStore: {
            getSessionCount: () => saved ? 1 : 0,
            getRecentSessions: () => saved
                ? [{ key: 'saved', activeBookId: 'book-1', scope: 'book', result: { questionId: 'setup-1' } }]
                : []
        },
        isErrorResult: () => false,
        reopenSessionByKey,
        notifyInteraction,
        getPayloadStats: vi.fn(),
        getCanonicalActiveBookId: () => 'book-1',
        refreshEstimateDisplays: vi.fn(),
        runner: { runWithTrace: vi.fn(), runOmnibusWithTrace: vi.fn() },
        refreshCorpus: vi.fn(),
    }) as { // SAFE: exercise real view methods with only their data/IO seams supplied; no SVG shell in Node.
        isInquiryReadOnly(): boolean;
        isInquiryRunDisabled(): boolean;
        runInquiry(question: { id: string }, options?: { forceRerun: boolean }): Promise<void>;
        runOmnibusPass(): Promise<void>;
        buildAiJobBatch(): Promise<unknown>;
        startApiSimulation(): void;
        requestEstimateSnapshot(): Promise<void>;
        handleBriefingPendingEditsClick(session: unknown): Promise<void>;
        runner: { runWithTrace: ReturnType<typeof vi.fn>; runOmnibusWithTrace: ReturnType<typeof vi.fn> };
        refreshCorpus: ReturnType<typeof vi.fn>;
    };
    return { view, reopenSessionByKey, notifyInteraction, invalidate, requestSnapshot };
}

describe('Inquiry viewing is independent of AI permission', () => {
    it('keeps saved questions within their novel and separates saga answers', () => {
        const sessions = [
            { key: 'hound', activeBookId: '03 The Hound', scope: 'book', result: { questionId: 'setup-1' } },
            { key: 'saga', scope: 'saga', result: { questionId: 'setup-1' } },
            { key: 'scarlet', activeBookId: '01 Scarlet', scope: 'book', result: { questionId: 'setup-1' } }
        ];
        const view = Object.assign(Object.create(InquiryView.prototype), {
            state: { scope: 'book', activeBookId: '01 Scarlet' },
            sessionStore: { getSessionCount: () => sessions.length, getRecentSessions: () => sessions },
            isErrorResult: () => false
        }) as { // SAFE: real saved-question lookup with deterministic session/selection seams.
            state: { scope: string; activeBookId?: string };
            findSavedSessionForQuestion(question: { id: string }): { key: string } | undefined;
        };
        expect(view.findSavedSessionForQuestion({ id: 'setup-1' })?.key).toBe('scarlet');
        view.state.activeBookId = '02 Sign';
        expect(view.findSavedSessionForQuestion({ id: 'setup-1' })).toBeUndefined();
        view.state.activeBookId = undefined;
        expect(view.findSavedSessionForQuestion({ id: 'setup-1' })).toBeUndefined();
        view.state.scope = 'saga';
        expect(view.findSavedSessionForQuestion({ id: 'setup-1' })?.key).toBe('saga');
    });

    it('reopens saved scene references using the author IDs in the active corpus', () => {
        const view = Object.assign(Object.create(InquiryView.prototype), {
            state: { scope: 'book' },
            corpus: { scenes: [{ sceneId: 'ody_scn_001', id: 'Odyssey/1 Opening.md', filePath: 'Odyssey/1 Opening.md', displayLabel: 'S1', sceneNumber: 1 }] }
        }) as { normalizeResultRefId(id: string): { refId: string; wasNormalized: boolean } }; // SAFE: real reference normalization with a corpus-only fixture.
        expect(view.normalizeResultRefId('ody_scn_001')).toEqual({ refId: 'ody_scn_001', wasNormalized: false });
        expect(view.normalizeResultRefId('ody_scn_999').refId).toBe('');
    });

    it.each([false, true])('opens the view with AI enabled=%s', async enabled => {
        const leaf = { setViewState: vi.fn(), detach: vi.fn() };
        const workspace = { getLeavesOfType: () => [], getLeaf: () => leaf, revealLeaf: vi.fn() };
        const service = new InquiryService(
            { workspace } as unknown as App, // SAFE: activateView uses only this workspace seam.
            { settings: { enableAiSceneAnalysis: enabled } } as unknown as RadialTimelinePlugin // SAFE: service gate fixture.
        );
        await service.activateView();
        expect(leaf.setViewState).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
        expect(workspace.revealLeaf).toHaveBeenCalledWith(leaf);
        expect(leaf.detach).not.toHaveBeenCalled();
    });

    it.each([
        { label: 'AI off with configured cloud credentials', enabled: false, credential: true, blocked: false },
        { label: 'AI off with the fresh Local LLM default', enabled: false, credential: true, blocked: true },
        { label: 'AI on with no cloud key', enabled: true, credential: false, blocked: true },
        { label: 'AI on with an unavailable local model', enabled: true, credential: true, blocked: true },
    ])('browses saved answers and refuses execution: $label', async ({ enabled, credential, blocked }) => {
        const { view, reopenSessionByKey, invalidate, requestSnapshot } = browsingView(enabled, credential, blocked);
        expect(view.isInquiryReadOnly()).toBe(true);
        expect(view.isInquiryRunDisabled()).toBe(true);
        await view.runInquiry({ id: 'setup-1' });
        await view.runInquiry({ id: 'setup-1' }, { forceRerun: true });
        expect(reopenSessionByKey).toHaveBeenCalledTimes(2);
        expect(reopenSessionByKey).toHaveBeenCalledWith('saved');
        await view.runOmnibusPass();
        view.startApiSimulation();
        await view.requestEstimateSnapshot();
        expect(invalidate).toHaveBeenCalled();
        expect(requestSnapshot).not.toHaveBeenCalled();
        expect(view.runner.runWithTrace).not.toHaveBeenCalled();
        expect(view.runner.runOmnibusWithTrace).not.toHaveBeenCalled();
        expect(view.refreshCorpus).not.toHaveBeenCalled();
    });

    it('explains the opt-in requirement when no saved answer exists', async () => {
        const { view, notifyInteraction, reopenSessionByKey } = browsingView(false, true, false, false);
        await view.runInquiry({ id: 'setup-1' });
        expect(notifyInteraction).toHaveBeenCalledWith(expect.stringContaining('AI features are turned off'));
        expect(reopenSessionByKey).not.toHaveBeenCalled();
    });

    it('requires explicit AI opt-in before preparing client jobs or applying pending edits', async () => {
        const { view, notifyInteraction } = browsingView(false, true, false);
        await expect(view.buildAiJobBatch()).rejects.toThrow('AI features are turned off');
        await view.handleBriefingPendingEditsClick({});
        expect(notifyInteraction).toHaveBeenCalledWith(expect.stringContaining('AI features are turned off'));
        expect(view.refreshCorpus).not.toHaveBeenCalled();
    });

    it('permits analysis only when AI is explicitly enabled and the engine is configured', () => {
        const { view } = browsingView(true, true, false);
        expect(view.isInquiryReadOnly()).toBe(false);
        expect(view.isInquiryRunDisabled()).toBe(false);
    });
});
