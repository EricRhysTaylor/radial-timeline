import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('obsidian', () => ({ Platform: {} }));

import { BUG_FORM_FIELDS, BUG_FORM_TEMPLATE, buildIssueUrl, buildMailtoUrl, type BugReportPayload } from './bugReport';

const payload = (extra: Partial<BugReportPayload> = {}): BugReportPayload => ({
    description: 'Timeline goes blank after switching books\nSecond line',
    errorText: '',
    env: { pluginVersion: '7.3.2', obsidianVersion: '1.9.12', platform: 'macOS', source: 'rt' },
    hasScreenshot: false,
    ...extra,
});

describe('buildIssueUrl', () => {
    it('opens the bug form (blank issues are disabled) with its fields prefilled by id', () => {
        const url = new URL(buildIssueUrl(payload()));
        expect(`${url.origin}${url.pathname}`).toBe('https://github.com/EricRhysTaylor/Radial-Timeline/issues/new');
        const q = url.searchParams;
        expect(q.get('template')).toBe('bug_report.yml');
        expect(q.get('title')).toBe('[Bug]: Timeline goes blank after switching books');
        expect(q.get('what-happened')).toBe('Timeline goes blank after switching books\nSecond line');
        expect(q.get('plugin-version')).toBe('7.3.2');
        expect(q.get('obsidian-version')).toBe('1.9.12');
        expect(q.get('platform')).toBe('macOS');
        expect(q.get('where')).toBe('Radial Timeline view');
        // The form's own labels apply; a free-form body would be ignored by a form.
        expect(q.has('body')).toBe(false);
        expect(q.has('labels')).toBe(false);
        expect(q.has('logs')).toBe(false);
        expect(q.has('screenshot')).toBe(false);
    });

    it('carries the log and the screenshot note only when there is one', () => {
        const q = new URL(buildIssueUrl(payload({
            errorText: '  TypeError: x is undefined  ',
            hasScreenshot: true,
            env: { pluginVersion: '7.3.2', obsidianVersion: 'unknown', platform: 'Windows', source: 'inquiry' },
        }))).searchParams;
        expect(q.get('logs')).toBe('TypeError: x is undefined');
        expect(q.get('screenshot')).toContain('paste it here');
        expect(q.get('where')).toBe('Inquiry view');
    });

    it('names only fields that exist in .github/ISSUE_TEMPLATE/bug_report.yml', () => {
        const form = readFileSync(resolve(__dirname, '../../.github/ISSUE_TEMPLATE', BUG_FORM_TEMPLATE), 'utf8');
        const ids = new Set([...form.matchAll(/^\s+id:\s*([\w-]+)\s*$/gm)].map((m) => m[1]));
        for (const id of Object.values(BUG_FORM_FIELDS)) expect(ids.has(id), id).toBe(true);
        const config = readFileSync(resolve(__dirname, '../../.github/ISSUE_TEMPLATE/config.yml'), 'utf8');
        expect(config).toMatch(/^blank_issues_enabled: false$/m);
    });
});

describe('buildMailtoUrl', () => {
    it('keeps the email route with the environment in the body', () => {
        const url = buildMailtoUrl(payload());
        expect(url.startsWith('mailto:bug@radialtimeline.com?')).toBe(true);
        const body = decodeURIComponent(url.split('body=')[1]);
        expect(body).toContain('- Plugin version: 7.3.2');
        expect(body).toContain('- Reported from: Radial Timeline view');
    });
});
