import { describe, expect, it } from 'vitest';
import { cueMarkerLabel, cueState, durationSegment, maskNonProse, resolveSceneTime, scanSceneTime, type TimeDecision } from './model';

describe('scene time detection', () => {
    it.each([
        ['thirty-one days', 31 * 1440],
        ['Thirty-One days', 31 * 1440],
        ['thirty‐one days', 31 * 1440],
        ['thirty‑one days', 31 * 1440],
        ['thirty one days', 31 * 1440],
        ['twenty-four hours', 24 * 60],
        ['forty-five minutes', 45],
        ['ninety-nine seconds', 99 / 60],
        ['thirteen days', 13 * 1440],
        ['seventy hours', 70 * 60],
        ['twenty-one day', 21 * 1440]
    ])('reads the whole written quantity: %s', (phrase, minutes) => {
        const source = `Period covered, ${phrase}.`;
        const scan = scanSceneTime(source);
        expect(scan.cues).toHaveLength(1);
        expect(scan.cues[0]).toMatchObject({ quote: phrase, suggestedMinutes: minutes, kind: 'uncertain' });
        expect(source.slice(scan.cues[0].from, scan.cues[0].to)).toBe(phrase);
        expect(resolveSceneTime(scan, {}).elapsed).toBe(0);
    });
    it('keeps compound advances and checkpoints distinct from bare occasions', () => {
        const scan = scanSceneTime('Twenty-one days later.\nThirty-one days had passed since departure.\nOne day, she returned.');
        expect(scan.cues.map(cue => [cue.kind, cue.suggestedMinutes])).toEqual([
            ['advance', 21 * 1440], ['checkpoint', 31 * 1440], ['uncertain', null]
        ]);
        expect(cueMarkerLabel(resolveSceneTime(scan, {}).cues[0])).toBe('+504h');
    });
    it.each(['one-hundred-and-one days', 'one hundred and one days', 'one hundred thirty-one days'])('does not salvage a misleading suffix from unsupported quantities: %s', phrase => {
        expect(scanSceneTime(phrase).cues).toHaveLength(0);
    });
    it('does not reuse an old partial-match decision for the corrected duration', () => {
        const source = 'Period covered, thirty-one days.';
        const oldKey = JSON.stringify([source, source.indexOf('one days'), 'one days']);
        const result = resolveSceneTime(scanSceneTime(source), { [oldKey]: { action: 'add', minutes: 1440 } });
        expect(result.cues[0].quote).toBe('thirty-one days');
        expect(cueMarkerLabel(result.cues[0])).toBe('+744h');
        expect(result.cues[0].decision).toBeUndefined();
        expect(result.elapsed).toBe(0);
    });
    it.each([
        'One day, the timeouts rolled over instead of expiring.',
        'One day he left the city.',
        'Perhaps one day she would return.',
        'Five years ago, he nearly died. One day, the timeouts rolled over.'
    ])('does not quantify an unspecified occasion: %s', source => {
        const scan = scanSceneTime(source);
        expect(scan.cues).toHaveLength(1);
        expect(scan.cues[0]).toMatchObject({ kind: 'uncertain', suggestedMinutes: null });
        const snapshot = resolveSceneTime(scan, {}, '2085-04-21T17:00:00');
        expect(cueMarkerLabel(snapshot.cues[0])).toBeNull();
        expect(snapshot.elapsed).toBe(0);
        expect(snapshot.cues[0].clockLabel).toBe('5pm');
    });
    it.each([
        ['One day later, he returned.', 'advance'],
        ['One day earlier, he left.', 'backward'],
        ['One day had passed since departure.', 'checkpoint'],
        ['She waited for one day.', 'advance'],
        ['They leave in one day.', 'uncertain'],
        ['The journey took one day.', 'uncertain']
    ])('keeps explicitly quantified days: %s', (source, kind) => {
        const cues = scanSceneTime(source).cues;
        expect(cues).toHaveLength(1);
        expect(cues[0]).toMatchObject({ kind, suggestedMinutes: 1440 });
    });
    it('preserves an author decision for an unquantified occasion', () => {
        const scan = scanSceneTime('One day, he returned.');
        const result = resolveSceneTime(scan, { [scan.cues[0].key]: { action: 'exclude', minutes: 0 } });
        expect(result.cues[0].decision?.action).toBe('exclude');
        expect(result.elapsed).toBe(0);
        expect(cueMarkerLabel(result.cues[0])).toBeNull();
    });
    it('keeps quantified marker labels independent of start time and inferred clock', () => {
        const scan = scanSceneTime('Three hours later, she leaves.');
        const decisions = { [scan.cues[0].key]: { action: 'add' as const, minutes: 180 } };
        for (const when of [undefined, '2085-04-21', '2085-04-21T17:00:00']) {
            expect(cueMarkerLabel(resolveSceneTime(scan, decisions, when).cues[0])).toBe('+3h');
        }
        const unknown = resolveSceneTime(scanSceneTime('A few minutes later, she leaves.'), {});
        expect(cueMarkerLabel(unknown.cues[0])).toBeNull();
        const clock = resolveSceneTime(scanSceneTime('It is 3 am.'), {});
        expect(cueMarkerLabel(clock.cues[0])).toBe('3am');
    });
    it('shows the story clock after confirmed advances and midnight rollover', () => {
        const scan = scanSceneTime('Three hours later, she leaves.\nShe sleeps for six hours.');
        const result = resolveSceneTime(scan, Object.fromEntries(scan.cues.map(cue => [cue.key, { action: 'add', minutes: cue.suggestedMinutes! }])), '2085-04-21T17:00:00');
        expect(result.cues.map(cue => cue.clockLabel)).toEqual(['8pm', '2am']);
        expect(result.cues.every(cue => !cue.clockEstimated)).toBe(true);
    });
    it('estimates forward from explicit clock anchors without changing confirmed accounting', () => {
        const scan = scanSceneTime('It is 3 am.\nTwo hours later, she leaves.');
        const result = resolveSceneTime(scan, {}, '2085-04-21T17:00:00');
        expect(result.cues.map(cue => cue.clockLabel)).toEqual(['3am', '5am']);
        expect(result.cues[1].clockEstimated).toBe(true);
        expect(result.elapsed).toBe(0);
    });
    it('does not invent a clock for a date-only start or dawn', () => {
        expect(resolveSceneTime(scanSceneTime('Two hours later, she leaves.'), {}, '2085-04-21').cues[0].clockLabel).toBeUndefined();
        const result = resolveSceneTime(scanSceneTime('Dawn. Two hours later, she leaves.'), {}, '2085-04-21T17:00:00');
        expect(result.cues.every(cue => cue.clockLabel === undefined)).toBe(true);
    });
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
    it('estimates a provisional total from unconfirmed forward cues', () => {
        const result = resolveSceneTime(scanSceneTime('She waited for thirty minutes.\n\nThree days earlier, he left.\n\nIn two hours the ship docks.'), {});
        expect(result.elapsed).toBe(0);
        expect(result.estimated).toBe(150);
    });
    it('reconciles unconfirmed estimates with confirmed decisions', () => {
        const scan = scanSceneTime(source);
        const result = resolveSceneTime(scan, { [scan.cues[0].key]: { action: 'add', minutes: 120 } });
        expect(result.elapsed).toBe(120);
        expect(result.estimated).toBe(480);
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

describe('declared duration line', () => {
    const source = 'Two hours later, she arrives.\n\nShe sleeps for six hours.\n\nThe ship docks.';
    it('stops at the first cue whose running total passes the declared duration', () => {
        const scan = scanSceneTime(source);
        const snapshot = resolveSceneTime(scan, {}, undefined, '3 hours');
        expect(snapshot.cues.map(cue => cue.estimated)).toEqual([120, 480]);
        expect(snapshot.duration).toEqual({ planned: 180, status: 'over', stop: { line: 2, from: scan.cues[1].from } });
        expect(durationSegment(snapshot, 0, 0)).toMatchObject({ status: 'over', stopFrom: null, shortfall: null });
        expect(durationSegment(snapshot, 2, 2)).toMatchObject({ status: 'over', stopFrom: scan.cues[1].from });
        expect(durationSegment(snapshot, 4, 4)).toBeNull();
    });
    it('runs the full rail and reports the shortfall at the last prose line when the prose falls short', () => {
        const snapshot = resolveSceneTime(scanSceneTime(source), {}, undefined, '10 hours');
        expect(snapshot.duration).toMatchObject({ status: 'short', stop: null });
        expect(durationSegment(snapshot, 0, 0)).toMatchObject({ status: 'short', stopFrom: null, shortfall: null });
        expect(durationSegment(snapshot, 4, 4)).toMatchObject({ planned: 600, shortfall: 120 });
    });
    it('matches exactly without a stop or an arrow', () => {
        const snapshot = resolveSceneTime(scanSceneTime(source), {}, undefined, '8 hours');
        expect(snapshot.duration).toMatchObject({ status: 'match', stop: null });
        expect(durationSegment(snapshot, 4, 4)).toMatchObject({ stopFrom: null, shortfall: null });
    });
    it('measures confirmed decisions, not the detected suggestion they replace', () => {
        const scan = scanSceneTime(source);
        const snapshot = resolveSceneTime(scan, { [scan.cues[1].key]: { action: 'add', minutes: 30 } }, undefined, '3 hours');
        expect(snapshot.duration).toMatchObject({ status: 'short', stop: null });
    });
    it.each([undefined, '', '0', 'soon', 120])('draws no line without a positive declared duration: %s', duration => {
        const snapshot = resolveSceneTime(scanSceneTime(source), {}, undefined, duration);
        expect(snapshot.duration).toBeNull();
        expect(durationSegment(snapshot, 0, 4)).toBeNull();
    });
});
