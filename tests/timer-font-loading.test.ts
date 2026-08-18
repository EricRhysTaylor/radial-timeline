import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('writing session timer font loading', () => {
    const readTimelineCss = () => readFileSync(resolve(process.cwd(), 'src/styles/timeline.css'), 'utf8');
    const readIndicatorsCss = () => readFileSync(resolve(process.cwd(), 'src/styles/indicators.css'), 'utf8');
    const readTimelineViewSource = () => readFileSync(resolve(process.cwd(), 'src/view/TimeLineView.ts'), 'utf8');
    const readRuleBlock = (css: string, selector: string): string => {
        const start = css.indexOf(selector);
        if (start === -1) return '';
        const open = css.indexOf('{', start);
        const close = css.indexOf('}', open);
        return open === -1 || close === -1 ? '' : css.slice(open + 1, close);
    };

    it('uses the plugin-private JetBrains Mono face for timer UI', () => {
        const fontCss = readFileSync(resolve(process.cwd(), 'src/styles/font.css'), 'utf8');
        const timelineCss = readTimelineCss();

        expect(fontCss).toContain("font-family: 'Radial Timeline JetBrains Mono'");
        expect(timelineCss).toContain("'Radial Timeline JetBrains Mono', var(--font-monospace)");
        expect(fontCss).not.toContain('JetBrains Mono RT');
        expect(timelineCss).not.toContain('JetBrains Mono RT');
        expect(timelineCss).not.toContain("'JetBrains Mono', var(--font-monospace)");
    });

    it('embeds the bundled WOFF2 during CSS bundling', () => {
        const bundlerSource = readFileSync(resolve(process.cwd(), 'scripts/bundle-css.mjs'), 'utf8');

        expect(bundlerSource).toContain('assets/fonts/jetbrains-mono/JetBrainsMono-Thin.woff2');
        expect(bundlerSource).toContain('data:font/woff2;base64');
        expect(bundlerSource).toContain('embedBundledFontUrls');
    });

    it('keeps timer buttons free of movement animation', () => {
        const timelineCss = readTimelineCss();
        const indicatorsCss = readIndicatorsCss();
        const countPulseBlock = timelineCss.match(/@keyframes ert-timeline-session-count-pulse \{[\s\S]*?\n\}/)?.[0] ?? '';
        const ringPulseBlock = indicatorsCss.match(/@keyframes ert-timeline-session-ring-count-pulse \{[\s\S]*?\n\}/)?.[0] ?? '';
        const ringTrackBlock = readRuleBlock(indicatorsCss, '.radial-timeline-container .ert-timeline-session-ring__track');
        const ringPausedBlock = readRuleBlock(indicatorsCss, '.radial-timeline-container .ert-timeline-session-ring.is-paused .ert-timeline-session-ring__arc');
        const ringCompleteProgressIndex = indicatorsCss.indexOf('.radial-timeline-container .ert-timeline-session-ring.is-progress-100 .ert-timeline-session-ring__arc');
        const ringPausedIndex = indicatorsCss.indexOf('.radial-timeline-container .ert-timeline-session-ring.is-paused .ert-timeline-session-ring__arc');
        const clockBlock = readRuleBlock(timelineCss, '.ert-timeline-session-panel__clock {');
        const sessionButtonBlock = readRuleBlock(timelineCss, '.ert-timeline-session.clickable-icon {');
        const titleButtonBlock = readRuleBlock(timelineCss, '.ert-timeline-session.clickable-icon:not(.is-icon-only)');
        const iconOnlyButtonBlock = readRuleBlock(timelineCss, '.ert-timeline-session.clickable-icon.is-icon-only');
        const titleCountBlock = readRuleBlock(timelineCss, '.ert-timeline-session__label {');
        const clockValueBlock = readRuleBlock(timelineCss, '.ert-timeline-session-panel__clock-value');
        const beginBlock = readRuleBlock(timelineCss, 'button.ert-timeline-session-panel__begin {');
        const beginRowBlock = readRuleBlock(timelineCss, '.ert-timeline-session-panel__begin-row');
        const sectionBlock = readRuleBlock(timelineCss, '.ert-timeline-session-panel__section');
        const buttonBlocks = [
            '.ert-timeline-session-panel__primary',
            '.ert-timeline-session-panel__secondary',
            '.ert-timeline-session-panel__ghost',
            '.ert-timeline-session-panel__chip',
        ].map(selector => readRuleBlock(timelineCss, selector));
        const hoverBlocks = [
            '.ert-timeline-session-panel__primary:hover',
            '.ert-timeline-session-panel__secondary:hover',
            '.ert-timeline-session-panel__ghost:hover',
            '.ert-timeline-session-panel__chip:hover',
        ].map(selector => readRuleBlock(timelineCss, selector));

        // Begin Session: the panel's one action — a centered, accent-bordered
        // text button, never a bare icon and never a moving one.
        expect(beginBlock).not.toMatch(/transition:[^;]*transform/);
        expect(beginBlock).toContain('border: 1px solid color-mix(in srgb, var(--interactive-accent) 70%, transparent)');
        expect(beginBlock).toContain('border-radius: var(--radius-s)');
        expect(beginRowBlock).toContain('justify-content: center');
        expect(timelineCss).toContain('.ert-timeline-session-panel.is-community-shared .ert-timeline-session-panel__begin');
        expect(timelineCss).not.toContain('ert-timeline-session-panel__ratio');
        expect(timelineCss).not.toContain('ert-timeline-session-panel__quick');
        buttonBlocks.forEach(block => expect(block).not.toMatch(/transition:[^;]*transform/));
        hoverBlocks.forEach(block => expect(block).not.toContain('translateY'));
        expect(countPulseBlock).not.toContain('transform:');
        expect(countPulseBlock).toContain('--ert-session-pulse-color');
        expect(countPulseBlock).toContain('color: var(--ert-session-pulse-color, white)');
        expect(ringPulseBlock).not.toContain('transform:');
        expect(ringPulseBlock).toContain('--ert-session-pulse-color');
        expect(ringPulseBlock).toContain('stroke: var(--ert-session-pulse-color, white)');
        expect(ringTrackBlock).toContain('stroke: color-mix(in srgb, var(--text-normal) 44%, var(--background-primary))');
        expect(ringTrackBlock).toContain('opacity: 1');
        expect(ringPausedBlock).toContain('stroke: var(--text-warning)');
        expect(ringPausedBlock).toContain('opacity: 1');
        expect(ringPausedIndex).toBeGreaterThan(ringCompleteProgressIndex);
        expect(timelineCss).toContain('animation: ert-timeline-session-count-pulse 300ms ease-out');
        expect(indicatorsCss).toContain('animation: ert-timeline-session-ring-count-pulse 300ms ease-out');
        expect(clockBlock).toContain('background: transparent');
        expect(clockBlock).toContain('border: 0');
        expect(timelineCss).toContain('.ert-timeline-session-panel__clock.is-paused {\n  color: var(--text-warning);');
        expect(timelineCss).toContain('.ert-timeline-search .ert-timeline-search__input[type="search"]');
        expect(timelineCss).toContain('height: 24px');
        expect(timelineCss).toContain('min-height: 24px');
        expect(timelineCss).toContain('max-height: 24px');
        expect(sessionButtonBlock).toContain('cursor: pointer');
        expect(timelineCss).toContain('.ert-timeline-session.clickable-icon .ert-timeline-session__label');
        expect(titleButtonBlock).toContain('min-width: calc(4.5ch + 2.7rem)');
        expect(iconOnlyButtonBlock).toContain('width: 24px');
        expect(timelineCss).toContain('.ert-timeline-session.clickable-icon.is-goal-met');
        expect(timelineCss).toContain('color: var(--text-success)');
        expect(titleCountBlock).toContain('min-width: 4.5ch');
        expect(titleCountBlock).toContain('padding-inline');
        expect(clockValueBlock).toContain('padding-inline: 0.5rem');
        expect(timelineCss).toContain('.ert-timeline-session-panel__clock:not(.is-complete) .ert-timeline-session-panel__clock-value');
        expect(timelineCss).toContain('min-width: 10.5ch');
        expect(sectionBlock).not.toContain('transition:');
        expect(timelineCss).toContain('.ert-timeline-session-panel__section:hover');
        expect(timelineCss).toContain('.ert-timeline-session-panel__section:focus-within');
        expect(timelineCss).not.toMatch(/\\.ert-timeline-session-panel__section:hover[\\s\\S]*?translateY/);
    });

    it('keeps idle timer configuration stable and renders the timer ring as SVG', () => {
        const timelineViewSource = readTimelineViewSource();
        const indicatorsCss = readIndicatorsCss();

        expect(timelineViewSource).not.toContain("applyTooltip(sessionBtn, 'Start writing session'");
        expect(timelineViewSource).not.toContain("sessionPanel.setAttribute('aria-label', 'Writing session')");
        expect(timelineViewSource).not.toContain('applyTooltip(presetButton');
        expect(timelineViewSource).not.toContain("goalInput.setAttribute('aria-label'");
        expect(timelineViewSource).not.toContain("presetButton.setAttribute('aria-label'");
        expect(timelineViewSource).toContain("goalInput.step = '1'");
        expect(timelineViewSource).toContain("settingsTab?.revealSettingsSection('core', 'goals-sessions', { force: true })");
        expect(timelineViewSource).toContain("setting.openTabById('radial-timeline')");
        expect(timelineViewSource).toContain('<svg xmlns="http://www.w3.org/2000/svg">${ringSvg}</svg>');
        expect(timelineViewSource).toContain('getSessionRingElapsedMs');
        expect(timelineViewSource).toContain('elapsed-second-');
        expect(timelineViewSource).toContain('writingSessionRingRenderKey');
        expect(timelineViewSource).toContain('SESSION_TIMER_RING_PROGRESS_WIDTH_ANCHOR');
        expect(timelineViewSource).toContain('SESSION_TIMER_RING_PROGRESS_RADIUS_OFFSET_ANCHOR');
        expect(timelineViewSource).toContain('syncOpenWritingSessionPanel');
        expect(timelineViewSource).toContain('syncActiveWritingSessionPanelClock');
        expect(timelineViewSource).toContain('resolveWritingSessionStageSelection');
        expect(timelineViewSource).toContain("mode === 'drafting' && stage === 'auto'");
        expect(timelineViewSource).toContain("return 'Zero'");
        expect(timelineViewSource).toContain("stageSelect.value = 'Zero'");
        expect(timelineViewSource).toContain("mode === 'drafting' ? service.setDefaultStage('Zero') : Promise.resolve()");
        expect(timelineViewSource).toContain('goalMet: true');
        expect(timelineViewSource).toContain("is-goal-met");
        expect(indicatorsCss).toContain('stroke-width: 11px;');
        expect(indicatorsCss).toContain('stroke-width: 7px;');
        expect(indicatorsCss).not.toContain('.ert-timeline-session-ring.is-counterclockwise .ert-timeline-session-ring__track');
        expect(indicatorsCss).toContain('ert-timeline-session-ring-count-pulse');
        expect(indicatorsCss).not.toContain('stroke: var(--color-red, red)');
    });

    it('keeps active popover copy lean and labels action buttons directly', () => {
        const timelineViewSource = readTimelineViewSource();
        const timelineCss = readTimelineCss();

        expect(timelineViewSource).not.toContain("'square', 'Stop and save session'");
        expect(timelineViewSource).toContain("'save', 'Save'");
        expect(timelineViewSource).toContain("'pause', 'Pause'");
        expect(timelineViewSource).toContain("'play', 'Continue'");
        expect(timelineViewSource).toContain("'trash-2', 'Cancel'");
        expect(timelineViewSource).toContain('return `Save ${details}?`');
        expect(timelineViewSource).toContain('const countdownElapsedMs = this.getCountdownSegmentElapsedMs(active, elapsedMs)');
        expect(timelineViewSource).toContain('await service.continueCountdown()');
        expect(timelineViewSource).toContain('is-save-ready');
        expect(timelineCss).toContain('.ert-timeline-session-panel__primary.is-save-ready');
        expect(timelineCss).toContain('background: var(--text-success)');
        expect(timelineViewSource).not.toContain("button.setAttribute('title', label)");
        expect(timelineViewSource).not.toContain("settingsBtn.setAttribute('title'");
        expect(timelineViewSource).toContain('formatCompletedSessionSummary');
        // Live tracking is a single compact clock line ("0/400w 31m") with no
        // meta paragraph under it; only the complete summary may wrap.
        expect(timelineViewSource).toContain('${typedWords}/${goalWords}w ${minutes}m');
        expect(timelineViewSource).not.toContain("cls: 'ert-timeline-session-panel__meta'");
        expect(readRuleBlock(timelineCss, '.ert-timeline-session-panel__clock:not(.is-complete) .ert-timeline-session-panel__clock-value')).toContain('white-space: nowrap');
        expect(timelineViewSource).not.toContain("? 'Session Complete'");
        expect(timelineViewSource).not.toContain("active.pausedAt ? 'Paused' : 'Running'");
    });
});
