import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('writing session completion modal', () => {
    const readRuleBlock = (css: string, selector: string): string => {
        const start = css.indexOf(selector);
        if (start === -1) return '';
        const open = css.indexOf('{', start);
        const close = css.indexOf('}', open);
        return open === -1 || close === -1 ? '' : css.slice(open + 1, close);
    };

    it('uses a wider, shorter completion layout without the pages edited field', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/modals/WritingSessionCompletionModal.ts'), 'utf8');
        const css = readFileSync(resolve(process.cwd(), 'src/styles/rt-ui.css'), 'utf8');
        const modalBlock = readRuleBlock(css, '.ert-ui.ert-modal--writing-session.modal');
        const sectionBlock = readRuleBlock(css, '.ert-ui .ert-writing-session-section');
        const gridBlock = readRuleBlock(css, '.ert-ui .ert-writing-session-grid');
        const wordsGridBlock = readRuleBlock(css, '.ert-ui .ert-writing-session-grid--words');
        const scenesListBlock = readRuleBlock(css, '.ert-ui .ert-writing-session-scenes__list');
        const compactSettingBlock = readRuleBlock(css, '.ert-ui .ert-writing-session-compact-setting.setting-item');
        const compactInfoBlock = readRuleBlock(css, '.ert-ui .ert-writing-session-compact-setting .setting-item-info {');
        const compactControlBlock = readRuleBlock(css, '.ert-ui .ert-writing-session-compact-setting .setting-item-control');
        const noteSettingBlock = readRuleBlock(css, '.ert-ui .ert-writing-session-note.setting-item');
        const dateInputBlock = readRuleBlock(css, '.ert-ui input[type="date"].ert-writing-session-date-input');

        expect(modalBlock).toContain('width: 680px');
        expect(sectionBlock).toContain('display: flex');
        expect(gridBlock).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto');
        expect(gridBlock).toContain('align-items: start');
        expect(wordsGridBlock).toContain('border-top: 1px solid var(--background-modifier-border)');
        expect(scenesListBlock).toContain('overflow-y: auto');
        expect(scenesListBlock).toContain('max-height: min(28vh, 220px)');
        expect(compactSettingBlock).toContain('border-top: none');
        expect(compactSettingBlock).toContain('display: contents');
        expect(compactInfoBlock).toContain('align-self: start');
        expect(compactControlBlock).toContain('align-self: start');
        expect(compactControlBlock).toContain('justify-self: end');
        expect(noteSettingBlock).toContain('border-top: none');
        expect(dateInputBlock).toContain('width: 13.5ch');
        expect(source).toContain('private formatHeaderMeta()');
        expect(source).toContain("const badge = header.createSpan({ cls: 'ert-modal-badge', text: badgeBaseText })");
        expect(source).toContain('Review word counts, confirm touched scenes, choose the writing day, then save this session record.');
        expect(source).toContain("cls: 'ert-writing-session-section ert-writing-session-section--words'");
        expect(source).toContain("cls: 'ert-writing-session-grid ert-writing-session-grid--words'");
        expect(source).toContain("cls: 'ert-writing-session-grid ert-writing-session-grid--work'");
        expect(source).toContain("cls: 'ert-writing-session-grid ert-writing-session-grid--session'");
        expect(source).toContain(".setName('Session date')");
        expect(source).toContain("text.inputEl.type = 'date'");
        expect(source).toContain("text.inputEl.addClass('ert-input--md', 'ert-writing-session-date-input')");
        expect(source).toContain('sessionDateFromStartedAt(this.active.startedAt)');
        expect(source).toContain("cls: 'ert-writing-session-scenes__list'");
        expect(source).toContain("noteSetting.settingEl.addClass('ert-writing-session-note')");
        expect(source).not.toContain(".setName('Pages edited')");
        expect(source).not.toContain('pagesEdited,');
    });
});
