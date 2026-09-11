import { describe, expect, it } from 'vitest';
import { cueState, maskNonProse, resolveSceneTime, scanSceneTime, type TimeDecision } from './model';

describe('scene time detection', () => {
    it('anchors paragraph highlighting to the exact occurrence of a repeated phrase', () => {
        const source = 'Two hours later, she waits. Two hours later, she leaves.';
        const { cues } = scanSceneTime(source);
        expect(cues).toHaveLength(2);
        expect(cues[0].contextOffset).toBe(0);
        expect(cues[1].contextOffset).toBe(source.lastIndexOf('Two hours later'));
        for (const cue of cues) expect(cue.context.slice(cue.contextOffset, cue.contextOffset + cue.quote.length)).toBe(cue.quote);
    });
    it('retains every occurrence in prose order, including identical phrases', () => {
        const source = 'Two hours later, they arrive.\n\nShe sleeps for six hours.\n\nTwo hours later, she leaves.';
        const cues = scanSceneTime(source).cues;
        expect(cues.map(cue => cue.suggestedMinutes)).toEqual([120, 360, 120]);
        expect(cues.map(cue => cue.line)).toEqual([0, 2, 4]);
        cues.forEach(cue => expect(source.slice(cue.from, cue.to)).toBe(cue.quote));
    });
    it('does not turn plans, backward references or vague wording into confirmed time', () => {
        const scan = scanSceneTime('“We leave in two hours.”\nTwo hours earlier, he fell.\nA few hours later, she wakes.\nAt midnight, the bell rings.');
        expect(scan.cues.map(cue => cue.kind)).toEqual(['uncertain', 'backward', 'uncertain', 'clock']);
        const result = resolveSceneTime(scan, {});
        expect(result.elapsed).toBe(0);
        expect(result.pending).toBe(4);
    });
    it('recognizes cumulative checkpoints without also matching their duration', () => {
        const scan = scanSceneTime('Eight hours had passed since departure.');
        expect(scan.cues).toHaveLength(1);
        expect(scan.cues[0]).toMatchObject({ kind: 'checkpoint', suggestedMinutes: 480 });
    });
    it('handles numeric, fractional, written and zero durations', () => {
        const scan = scanSceneTime('2.5 hours later.\nHalf an hour later.\nAn hour later.\n0 minutes later.\n45 seconds later.');
        expect(scan.cues.map(cue => cue.suggestedMinutes)).toEqual([150, 30, 60, 0, 0.75]);
    });
    it('ignores frontmatter, comments, headings, links and fenced code while preserving offsets', () => {
        const source = '---\nSynopsis: Two hours later\n---\n# Six hours later\n%% Two hours later %%\n<!-- 3 hours later -->\n```text\n4 hours later\n```\n[5 hours later](elsewhere)\n`7 hours later`\n\nTwo hours later, she leaves.\n';
        const masked = maskNonProse(source);
        expect(masked.length).toBe(source.length);
        const scan = scanSceneTime(source);
        expect(scan.cues).toHaveLength(1);
        expect(scan.firstLine).toBe(12);
        expect(scan.lastLine).toBe(12);
        expect(source.slice(scan.cues[0].from, scan.cues[0].to)).toBe('Two hours later');
    });
    it('ignores an unfinished fenced block while an author is typing', () => {
        expect(scanSceneTime('Prose.\n```\nTwo hours later.').cues).toHaveLength(0);
    });
    it('does not drop the same words inside two different paragraphs', () => {
        const scan = scanSceneTime('Two hours later, she leaves.\n\nTwo hours later, he leaves.');
        expect(scan.cues[0].key).not.toBe(scan.cues[1].key);
        expect(scan.cues.every(cue => !cue.duplicate)).toBe(true);
    });
});

describe('author controlled elapsed time', () => {
    const source = 'Two hours later, she arrives.\n\nShe sleeps for six hours.\n\nEight hours had passed since departure.';
    it('adds advances but reconciles a checkpoint without double counting', () => {
        const scan = scanSceneTime(source);
        const decisions: Record<string, TimeDecision> = {
            [scan.cues[0].key]: { action: 'add', minutes: 120 },
            [scan.cues[1].key]: { action: 'add', minutes: 360 },
            [scan.cues[2].key]: { action: 'checkpoint', minutes: 480 }
        };
        const result = resolveSceneTime(scan, decisions);
        expect(result.elapsed).toBe(480);
        expect(result.pending).toBe(0);
        expect(result.conflict).toBe(false);
        expect(result.cues.map(cue => cue.elapsed)).toEqual([120, 480, 480]);
    });
    it('flags a backward checkpoint rather than silently subtracting elapsed time', () => {
        const scan = scanSceneTime(source);
        const result = resolveSceneTime(scan, {
            [scan.cues[0].key]: { action: 'add', minutes: 120 },
            [scan.cues[2].key]: { action: 'checkpoint', minutes: 60 }
        });
        expect(result.elapsed).toBe(120);
        expect(result.conflict).toBe(true);
        expect(cueState(result.cues[2])).toBe('conflict');
    });
    it('ignores excluded cues and keeps remaining cues pending', () => {
        const scan = scanSceneTime(source);
        const result = resolveSceneTime(scan, { [scan.cues[0].key]: { action: 'exclude', minutes: 0 } });
        expect(result.elapsed).toBe(0);
        expect(result.confirmed).toBe(0);
        expect(result.pending).toBe(2);
        expect(cueState(result.cues[0])).toBe('excluded');
    });
    it('retains decisions when paragraphs move but invalidates changed context', () => {
        const scan = scanSceneTime(source);
        const decisions = { [scan.cues[0].key]: { action: 'add' as const, minutes: 120 } };
        expect(resolveSceneTime(scanSceneTime(`New paragraph.\n\n${source}`), decisions).elapsed).toBe(120);
        expect(resolveSceneTime(scanSceneTime(source.replace('she arrives', 'he arrives')), decisions).elapsed).toBe(0);
    });
    it('does not attach one saved confirmation to duplicate identical paragraphs', () => {
        const scan = scanSceneTime('Two hours later.\n\nTwo hours later.');
        expect(scan.cues.every(cue => cue.duplicate)).toBe(true);
        expect(resolveSceneTime(scan, { [scan.cues[0].key]: { action: 'add', minutes: 120 } }).elapsed).toBe(0);
    });
    it('treats an empty scene as no prose and no evidence, not a duration mismatch', () => {
        expect(scanSceneTime('---\nClass: Scene\n---\n')).toMatchObject({ firstLine: -1, lastLine: -1, cues: [] });
    });
});
