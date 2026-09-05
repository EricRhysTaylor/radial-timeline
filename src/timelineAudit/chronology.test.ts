import { makeFile } from '../../tests/helpers/obsidianFixtures';
import { describe, expect, it } from 'vitest';
import { collectChronologueSceneEntries } from '../renderer/components/ChronologueTimeline';
import { buildChronologyEntries } from './chronology';
import type { TimelineAuditSceneInput } from './types';

function makeInput(path: string, manuscriptOrderIndex: number, rawWhen: string | null): TimelineAuditSceneInput {
    return {
        file: makeFile(path),
        sceneId: path,
        title: path,
        path,
        manuscriptOrderIndex,
        rawWhen,
        parsedWhen: rawWhen ? new Date(rawWhen.replace(' ', 'T')) : null,
        whenValid: Boolean(rawWhen),
        whenParseIssue: rawWhen ? null : 'missing_when',
        summary: '',
        synopsis: '',
        bodyExcerpt: ''
    };
}

describe('timeline audit chronology helper', () => {
    it('matches Chronologue ordering for valid When scenes with manuscript-order tie breaks', () => {
        const inputs = [
            makeInput('Story/2 Scene Two.md', 0, '2026-01-02 09:00'),
            makeInput('Story/3 Scene Three.md', 1, '2026-01-03 09:00'),
            makeInput('Story/1 Scene One.md', 2, '2026-01-02 09:00'),
            makeInput('Story/4 Missing.md', 3, null)
        ];

        const chronologyOrder = buildChronologyEntries(inputs).map((entry) => entry.input.path);

        const chronologueOrder = collectChronologueSceneEntries(inputs.map((input) => ({
            title: input.title,
            path: input.path,
            when: input.parsedWhen ?? undefined,
            date: input.rawWhen ?? ''
        })))
            .slice()
            .sort((a, b) => a.date.getTime() - b.date.getTime() || a.sourceIndex - b.sourceIndex)
            .map((entry) => entry.scene.path);

        expect(chronologyOrder).toEqual(chronologueOrder);
    });
});
