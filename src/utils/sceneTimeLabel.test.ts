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
    it('places the start weekday before the duration separator', () => {
        const when = '2085-04-21T17:00:00';
        const weekday = new Date(2085, 3, 21).toLocaleDateString([], { weekday: 'short' });
        expect(sceneTimeLabel(when, '31 hours').text).toContain(`${weekday} · 31 hours`);
    });
    it.each(['2085', '2085-04', 'April 2085'])('preserves date precision for %s', when => {
        expect(sceneTimeLabel(when, '25 min').text).toBe(`${when} · 25 min`);
    });
    it('reads a date-only When as the scene date, with no clock or end time', () => {
        expect(sceneTimeLabel('1811-10-09', '3 hours').text).toBe('Wed Oct 9, 1811 · 3 hours');
    });
    it.each(['1811-10-09', '1811/10/09', '10/9/1811', 'October 9, 1811', '9 October 1811'])('reads %s as the same day', when => {
        expect(sceneTimeLabel(when, undefined).text).toBe('Wed Oct 9, 1811');
    });
    it('leaves an empty Duration out of the bar and names it in the description', () => {
        const label = sceneTimeLabel('1811-10-09', undefined);
        expect(label.text).toBe('Wed Oct 9, 1811');
        expect(label.description).toBe('When: 1811-10-09 · Duration: Not set');
        expect(sceneTimeLabel('2085-04-13T20:00:00', '').text).not.toContain('·');
    });
    it('preserves ongoing or unrecognized durations without calculating an end', () => {
        expect(sceneTimeLabel('2085-04-13T12:00:00', 'ongoing').text).not.toContain('→');
        expect(sceneTimeLabel('2085-04-13T12:00:00', 'a while').text).toContain('a while');
    });
    it('shows missing timing explicitly and preserves unparsed dates', () => {
        expect(sceneTimeLabel(undefined, undefined).text).toBe('When not set');
        expect(sceneTimeLabel(undefined, '2 hours').text).toBe('When not set · 2 hours');
        expect(sceneTimeLabel('tomorrow', '2 hours').text).toBe('tomorrow · 2 hours');
    });
    it('handles zero duration and retains seconds', () => {
        expect(sceneTimeLabel('2085-04-13T12:00:15', 0).text).toContain('0 →');
        expect(sceneTimeLabel('2085-04-13T12:00:15', '45 seconds').text).toContain('12:01');
    });
});
