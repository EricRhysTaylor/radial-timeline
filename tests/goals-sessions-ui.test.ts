import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Goals & Sessions settings UI', () => {
    const readRuleBlock = (css: string, selector: string): string => {
        const start = css.indexOf(selector);
        if (start === -1) return '';
        const open = css.indexOf('{', start);
        const close = css.indexOf('}', open);
        return open === -1 || close === -1 ? '' : css.slice(open + 1, close);
    };

    it('uses the standard section-heading icon treatment for Writing stats', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/GoalsSessionsSection.ts'), 'utf8');
        const css = readFileSync(resolve(process.cwd(), 'src/styles/rt-ui.css'), 'utf8');
        const iconBlock = readRuleBlock(css, '.ert-ui.ert-scope--settings .ert-goals-stats-summary__icon');

        expect(source).toContain("cls: 'ert-goals-stats-summary__icon ert-setting-heading-icon'");
        expect(source).toContain("setIcon(headingIcon, 'chart-column')");
        expect(source).not.toContain("setIcon(headingIcon, 'bar-chart-3')");
        expect(iconBlock).not.toContain('border:');
        expect(iconBlock).not.toContain('border-radius');
        expect(iconBlock).not.toContain('background:');
        expect(iconBlock).not.toContain('color:');
    });

    it('keeps writing stat tiles compact enough for short labels', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/GoalsSessionsSection.ts'), 'utf8');
        const css = readFileSync(resolve(process.cwd(), 'src/styles/rt-ui.css'), 'utf8');
        const statBlock = readRuleBlock(css, '.ert-ui.ert-scope--settings .ert-goals-stat {');
        const headBlock = readRuleBlock(css, '.ert-ui.ert-scope--settings .ert-goals-stat__head');
        const valueBlock = readRuleBlock(css, '.ert-ui.ert-scope--settings .ert-goals-stat__value');
        const labelBlock = readRuleBlock(css, '.ert-ui.ert-scope--settings .ert-goals-stat__label');

        expect(source).toContain("return `${hours}:${String(remainder).padStart(2, '0')}`");
        expect(source).toContain("metric.createDiv({ cls: 'ert-goals-stat__label', text: label })");
        expect(source).toContain("if (unit) head.createDiv({ cls: 'ert-goals-stat__unit', text: unit })");
        expect(source).toContain("'written', String(stats.wordsDrafted), 'draft', 'w'");
        expect(source).toContain("targetDays ? 'd' : undefined");
        expect(source).toContain("'draft', String(stats.freshScenesCompleted), 'fresh', 's'");
        expect(source).toContain("'revisions', String(stats.revisionScenesCompleted), 'revision', 's'");
        expect(statBlock).toContain('grid-template-rows: auto auto');
        expect(headBlock).toContain('align-items: flex-start');
        expect(valueBlock).toContain('font-size: var(--font-ui-medium)');
        expect(valueBlock).toContain('white-space: nowrap');
        expect(labelBlock).toContain('white-space: nowrap');
    });

    it('uses a flat chevron expander for writing stats', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/GoalsSessionsSection.ts'), 'utf8');
        const css = readFileSync(resolve(process.cwd(), 'src/styles/rt-ui.css'), 'utf8');
        const chevronBlock = readRuleBlock(css, '.ert-ui.ert-scope--settings .ert-goals-stats-summary__chevron.ert-iconBtn');
        const markerBlock = readRuleBlock(css, '.ert-ui.ert-scope--settings .ert-goals-stats-summary::marker');

        expect(source).toContain("cls: 'ert-iconBtn ert-goals-stats-summary__chevron'");
        expect(source).toContain("setIcon(chevron, details.open ? 'chevron-down' : 'chevron-right')");
        expect(source).toContain("details.open = !details.open");
        expect(source).toContain('details.open = plugin.getWritingSessionService().getSettings().defaults.writingStatsOpen === true');
        expect(source).toContain('settings.defaults.writingStatsOpen = details.open');
        expect(source).toContain("chevron.setAttribute('aria-expanded'");
        expect(chevronBlock).toContain('margin-left: var(--ert-gap-xs)');
        expect(markerBlock).toContain("content: ''");
        expect(css).not.toContain('.ert-goals-stats-details[open] .ert-goals-stats-summary__chevron svg');
        expect(css).not.toContain('transform: rotate(180deg)');
    });

    it('adds a weekly writing goal setting above stats', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/GoalsSessionsSection.ts'), 'utf8');
        const locale = readFileSync(resolve(process.cwd(), 'src/i18n/locales/en.ts'), 'utf8');

        expect(source.indexOf("settings.goalsSessions.weeklyGoalDays.name")).toBeLessThan(source.indexOf('renderWritingStatsPanel(plugin, body)'));
        expect(source).toContain('max: 7');
        expect(source).toContain('min: 1');
        expect(source).toContain('settings.defaults.weeklyGoalDays');
        expect(locale).toContain("name: 'Weekly writing goal'");
        expect(locale).toContain('title-bar timer, count ring, daily goal stats, and planning estimates');
        expect(locale).toContain('session timer target');
    });
});
