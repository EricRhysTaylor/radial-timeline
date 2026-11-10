import { describe, expect, it } from 'vitest';
import { readTimeReferences } from './model';
import { popoverPosition, readableReferenceSpan, referencePopoverContent, sourcePopoverContent } from './popover';

const refs = readTimeReferences([
    { Label: 'Old Mr. Darcy dies', When: '1807', Kind: 'recollection', Passage: 'My excellent father died about five years ago' },
    { Label: 'Ramsgate', When: '1811-07', End: '1811-08', Kind: 'recollection' },
    { Label: 'Bingley leaves for London', When: '1811-11-27', Kind: 'recollection' },
    { Label: 'Jane in town, unseen', When: '1812-01', End: '1812-03', Kind: 'recollection' },
    { Label: 'Ramsgate, as Lady Catherine tells it', When: '1811-07', End: '1811-08', Kind: 'mention' },
], 'Pride & Prejudice/35 Darcy\'s Letter.md').references;
const [father, ramsgate, bingley, jane, ramsgateMention] = refs;
const row = (reference: typeof refs[number], source = '35 · Darcy’s Letter') => ({ reference, source });

describe('time reference popover', () => {
    it('writes dates as a reader would', () => {
        expect(readableReferenceSpan(father)).toBe('1807');
        expect(readableReferenceSpan(bingley)).toBe('Nov 27, 1811');
        expect(readableReferenceSpan(ramsgate)).toBe('Jul – Aug 1811');
        expect(readableReferenceSpan(jane)).toBe('Jan – Mar 1812');
    });
    it('heads a group with its side of the timeline and how many dates, without telling you to choose', () => {
        const content = referencePopoverContent('earlier', [row(father), row(ramsgate), row(ramsgateMention, '37 · Last Days at Hunsford')], { clipped: false, planetCalendar: false });
        expect(content.heading).toBe('Earlier · 2 dates');
        expect(content.heading).not.toMatch(/choose/i);
        expect(content.rows.map(item => item.source)).toEqual(['35 · Darcy’s Letter', '35 · Darcy’s Letter', '37 · Last Days at Hunsford']);
        expect(content.notes).toEqual([]);
    });
    it('heads one reference with its date, and two on one date with how many there are', () => {
        expect(referencePopoverContent('within', [row(bingley)], { clipped: false, planetCalendar: false }).heading).toBe('Nov 27, 1811');
        expect(referencePopoverContent('earlier', [row(ramsgate), row(ramsgateMention)], { clipped: false, planetCalendar: false }).heading).toBe('Earlier · Jul – Aug 1811 · 2 references');
    });
    it('heads a source circle\'s popover with its scene, and leaves the scene out of each row', () => {
        const content = sourcePopoverContent('35 · Darcy’s Letter', [father, ramsgate, bingley], { planetCalendar: false });
        expect(content.heading).toBe('35 · Darcy’s Letter · 3 references');
        expect(content.rows.map(item => item.reference.label)).toEqual(['Old Mr. Darcy dies', 'Ramsgate', 'Bingley leaves for London']);
        expect(content.rows.every(item => item.source === '')).toBe(true);
        expect(sourcePopoverContent('35 · Darcy’s Letter', [bingley], { planetCalendar: true })).toEqual({
            heading: '35 · Darcy’s Letter', rows: [{ reference: bingley, source: '' }], notes: ['Earth calendar'] });
    });
    it('notes an overlap with the displayed period, and the Earth calendar only while a planet calendar is on', () => {
        expect(referencePopoverContent('within', [row(jane)], { clipped: true, planetCalendar: true }).notes).toEqual(['Overlaps the displayed period', 'Earth calendar']);
    });
    it('opens level with its marker, just outside the timeline on the marker\'s side, inside the window', () => {
        const size = { width: 300, height: 200 }, viewport = { width: 1600, height: 1000 }, center = { x: 800, y: 500 }, radius = 400;
        expect(popoverPosition({ left: 1100, top: 400, right: 1110, bottom: 410 }, center, radius, size, viewport)).toEqual({ left: 1212, top: 305 });
        expect(popoverPosition({ left: 700, top: 120, right: 710, bottom: 130 }, center, radius, size, viewport)).toEqual({ left: 88, top: 25 });
        // A window too narrow for it outside the timeline keeps it inside the window.
        expect(popoverPosition({ left: 1100, top: 5, right: 1110, bottom: 15 }, center, radius, size, { width: 1300, height: 1000 })).toEqual({ left: 992, top: 8 });
    });
});
