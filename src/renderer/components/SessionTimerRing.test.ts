import { describe, expect, it } from 'vitest';
import {
    PROGRESS_RING_BASE_WIDTH,
    PROGRESS_RING_RADIUS_OFFSET,
    SESSION_TIMER_RING_GAP,
    SESSION_TIMER_RING_PROGRESS_RADIUS_OFFSET_ANCHOR,
    SESSION_TIMER_RING_PROGRESS_WIDTH_ANCHOR,
    SESSION_TIMER_RING_WIDTH,
} from '../layout/LayoutConstants';
import { renderProgressRingBaseLayer } from '../utils/ProgressRing';
import { buildSessionTimerRingState, renderSessionTimerRing, renderSessionTimerRingLayer, sessionTimerArcPath, tabTimerWedgePath } from './SessionTimerRing';

describe('SessionTimerRing', () => {
    it('places the session ring outside the progress ring', () => {
        const state = buildSessionTimerRingState({
            progressRadius: 700,
            progressRingWidth: 8,
            ringGap: 2,
            sessionRingWidth: 5,
            elapsedMs: 30 * 60000,
            targetMinutes: 120,
        });

        expect(state?.radius).toBe(708.5);
        expect(state?.strokeWidth).toBe(5);
        expect(state?.progress).toBe(0.25);
        expect(state?.colorProgress).toBe(0.25);
        expect(state?.direction).toBe('clockwise');
    });

    it('uses a thin session ring with a small gap outside the progress ring', () => {
        const lineInnerRadius = 680;
        const progressRadius = lineInnerRadius + SESSION_TIMER_RING_PROGRESS_RADIUS_OFFSET_ANCHOR;
        const state = buildSessionTimerRingState({
            progressRadius,
            progressRingWidth: SESSION_TIMER_RING_PROGRESS_WIDTH_ANCHOR,
            ringGap: SESSION_TIMER_RING_GAP,
            sessionRingWidth: SESSION_TIMER_RING_WIDTH,
            elapsedMs: 30 * 60000,
            targetMinutes: 120,
        });

        expect(state).not.toBeNull();
        expect(state?.radius).toBe(progressRadius + (SESSION_TIMER_RING_PROGRESS_WIDTH_ANCHOR / 2) + SESSION_TIMER_RING_GAP + (SESSION_TIMER_RING_WIDTH / 2));
        expect(PROGRESS_RING_BASE_WIDTH).toBe(11);
        expect(PROGRESS_RING_RADIUS_OFFSET).toBe(13);
        expect(SESSION_TIMER_RING_PROGRESS_RADIUS_OFFSET_ANCHOR).toBe(10);
        expect(SESSION_TIMER_RING_PROGRESS_WIDTH_ANCHOR).toBe(8);
        expect(SESSION_TIMER_RING_WIDTH).toBe(5);
        expect(SESSION_TIMER_RING_GAP).toBe(2);
        expect(state?.strokeWidth).toBe(5);
    });

    it('renders countdown sessions as a counterclockwise remaining-time arc', () => {
        const state = buildSessionTimerRingState({
            progressRadius: 700,
            progressRingWidth: 8,
            ringGap: 2,
            sessionRingWidth: 3,
            elapsedMs: 30 * 60000,
            targetMinutes: 120,
            countdown: true,
        });

        expect(state?.progress).toBe(0.75);
        expect(state?.colorProgress).toBe(0.25);
        expect(state?.direction).toBe('counterclockwise');
        const svg = renderSessionTimerRing(state);
        expect(svg).toContain('is-counterclockwise');
        expect(svg).toContain('is-progress-25');
        const path = sessionTimerArcPath(724, 0.75, 'counterclockwise');
        expect(path).toContain('M -724 0');
        expect(path).toContain(' 0 1 0 0 -724');
    });

    it('can drive the ring from typed word progress instead of elapsed time', () => {
        const state = buildSessionTimerRingState({
            progressRadius: 700,
            progressRingWidth: 8,
            ringGap: 2,
            sessionRingWidth: 3,
            progressValue: 250,
            targetValue: 1000,
        });

        expect(state?.progress).toBe(0.25);
        expect(state?.colorProgress).toBe(0.25);
        expect(state?.direction).toBe('clockwise');
    });

    it('starts countdown sessions as a full stage-colored ring', () => {
        const state = buildSessionTimerRingState({
            progressRadius: 700,
            progressRingWidth: 8,
            ringGap: 2,
            sessionRingWidth: 3,
            elapsedMs: 0,
            targetMinutes: 120,
            countdown: true,
        });
        const svg = renderSessionTimerRing(state);

        expect(state?.progress).toBe(1);
        expect(state?.colorProgress).toBe(0);
        expect(svg).toContain('is-progress-0');
        expect(svg).toContain('is-counterclockwise');
        expect(svg.match(/ A /g)?.length).toBe(2);
    });

    it('depletes the tab countdown wedge counterclockwise from the top', () => {
        const path = tabTimerWedgePath(9, 0.75, 'counterclockwise');

        expect(path).toContain('L -9 0');
        expect(path).toContain(' 0 1 0 0 -9');
    });

    it('grows the tab elapsed wedge clockwise from the top', () => {
        const path = tabTimerWedgePath(9, 0.25, 'clockwise');

        expect(path).toContain('L 0 -9');
        expect(path).toContain(' 0 0 1 9 0');
    });

    it('keeps countdown rings on the neutral track so spent time returns to gray', () => {
        const svg = renderSessionTimerRing({
            radius: 707.5,
            strokeWidth: 3,
            progress: 0.75,
            colorProgress: 0,
            direction: 'counterclockwise',
            paused: false,
        });

        expect(svg).toContain('is-counterclockwise');
        expect(svg).toContain('ert-timeline-session-ring__track');
    });

    it('renders the neutral track without an active arc for inactive sessions', () => {
        const svg = renderSessionTimerRing({
            radius: 708.5,
            strokeWidth: 5,
            progress: 0,
            colorProgress: 0,
            direction: 'clockwise',
            paused: false,
        });

        expect(svg).toContain('ert-timeline-session-ring__track');
        expect(svg).not.toContain('ert-timeline-session-ring__arc');
    });

    it('renders a closed two-arc path at completion', () => {
        const path = sessionTimerArcPath(705.5, 1);

        expect(path.match(/ A /g)?.length).toBe(2);
    });

    it('quantizes timer color state without inline styles', () => {
        const svg = renderSessionTimerRing({
            radius: 705.5,
            strokeWidth: 3,
            progress: 0.51,
            colorProgress: 0.51,
            direction: 'clockwise',
            paused: false,
        });

        expect(svg).toContain('is-progress-50');
        expect(svg).not.toContain('style=');
    });

    it('renders as an overlay layer after the progress backing ring', () => {
        const progressLayer = renderProgressRingBaseLayer({
            progressRadius: 693,
            estimateResult: null,
        });
        const timerLayer = renderSessionTimerRingLayer({
            radius: 698.5,
            strokeWidth: SESSION_TIMER_RING_WIDTH,
            progress: 0.5,
            colorProgress: 0.5,
            direction: 'clockwise',
            paused: false,
        });
        const svg = `${progressLayer}${timerLayer}`;

        expect(svg.indexOf('class="progress-ring-base"')).toBeGreaterThanOrEqual(0);
        expect(svg.indexOf('class="ert-timeline-session-ring-layer"')).toBeGreaterThan(svg.indexOf('class="progress-ring-base"'));
        expect(timerLayer).not.toContain('style=');
    });
});
