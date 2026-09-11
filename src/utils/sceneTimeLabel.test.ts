import { describe, expect, it } from 'vitest';
import { sceneTimeLabel } from './sceneTimeLabel';

describe('scene time header label', () => {
    it('shows clock timing and a derived end time', () => {
        const label = sceneTimeLabel('2085-04-13T03:12:00', '25 min');
        expect(label.text).toContain('☾');
        expect(label.text).toContain('3:12');
        expect(label.text).toContain('25 min →');
        expect(label.text).toContain('3:37');
        expect(label.description).toContain('2085-04-13');
    });
    it('makes midnight rollover explicit', () => {
        expect(sceneTimeLabel('2085-04-13T23:50:00', '25 min').text).toContain('(2085-04-14)');
    });
    it.each(['2085', 'April 2085', '2085-04-13'])('preserves date precision for %s', when => {
        expect(sceneTimeLabel(when, '25 min').text).toBe(`${when} · 25 min`);
    });
    it('preserves ongoing or unrecognized durations without calculating an end', () => {
        expect(sceneTimeLabel('2085-04-13T12:00:00', 'ongoing').text).not.toContain('→');
        expect(sceneTimeLabel('2085-04-13T12:00:00', 'a while').text).toContain('a while');
    });
    it('shows missing timing explicitly and preserves unparsed dates', () => {
        expect(sceneTimeLabel(undefined, undefined).text).toBe('When not set · Duration not set');
        expect(sceneTimeLabel('tomorrow', '2 hours').text).toBe('tomorrow · 2 hours');
    });
    it('handles zero duration and retains seconds', () => {
        expect(sceneTimeLabel('2085-04-13T12:00:15', 0).text).toContain('0 →');
        expect(sceneTimeLabel('2085-04-13T12:00:15', '45 seconds').text).toContain('12:01');
    });
});
