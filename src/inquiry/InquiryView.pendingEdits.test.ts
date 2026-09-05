import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InquiryView } from './InquiryView';
import { renderInquiryBriefingSessionItem } from './briefing/inquiryBriefingRenderer';

vi.mock('./briefing/inquiryBriefingRenderer', () => ({
    renderInquiryBriefingSessionItem: vi.fn(() => ({ item: {}, updateButton: {}, openButton: {} }))
}));

beforeEach(() => vi.clearAllMocks());

describe('briefing refresh reconciles persisted pending-edit state', () => {
    it.each([true, false])('recomputes stale pendingEditsEmpty=%s from the current writeback plan', prior => {
        const notes = prior ? new Map([['scene.md', ['Revise the opening.']]]) : new Map();
        const updateSession = vi.fn();
        // SAFE: exercise the real render method with its data/service seams supplied;
        // the SVG shell and Obsidian workspace are outside this state-transition test.
        const view = Object.assign(Object.create(InquiryView.prototype), {
            state: { activeSessionId: 'session-1' },
            sessionStore: { updateSession },
            settingsAccessor: { getActionNotesAutoPopulate: () => false },
            resolveSessionStatus: () => 'saved',
            resolveSessionQuestionLabel: () => 'Opening question',
            resolveInquiryActionNotesFieldLabel: () => 'Pending edits',
            buildInquiryPendingEditsPlan: () => ({ notesByMaterial: notes, targetLabels: [] }),
            syncPendingEditsAppliedState: () => false,
            registerBoundDomEvent: vi.fn(),
        }) as { renderBriefingSessionItem: (container: HTMLElement, session: unknown, blocked: boolean) => void };
        const session = {
            key: 'session-1', questionZone: 'setup', createdAt: 0,
            result: { questionId: 'question-1', scope: 'book' },
            pendingEditsEmpty: prior,
        };
        view.renderBriefingSessionItem({} as HTMLElement, session, false);
        expect(session.pendingEditsEmpty).toBe(!prior);
        expect(updateSession).toHaveBeenCalledWith('session-1', { pendingEditsEmpty: !prior });
        expect(renderInquiryBriefingSessionItem).toHaveBeenLastCalledWith(expect.objectContaining({ pendingEditsEmpty: !prior }));
        view.renderBriefingSessionItem({} as HTMLElement, session, false);
        expect(updateSession).toHaveBeenCalledTimes(1);
    });
});
