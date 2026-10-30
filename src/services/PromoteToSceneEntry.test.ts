import { describe, expect, it } from 'vitest';
import { promotionAnchors } from './PromoteToSceneEntry';
import type { TimelineItem } from '../types';

const scene = (title: string, subplot: string): TimelineItem =>
    ({ itemType: 'Scene', title, path: `Book/${title}.md`, subplot } as unknown as TimelineItem); // SAFE: test fixture with only the fields promotionAnchors reads

describe('promotionAnchors', () => {
    it('offers each scene once, in reading order, however many rings it is in', () => {
        // getSceneData groups by ring, so scenes repeat and arrive out of order.
        const data = [
            scene('3 First Ball', 'Main Plot'), scene('2 Mr Bennet Visits', 'Main Plot'),
            scene('61 Happy Marriages', 'Main Plot'), scene('10 Evening Conversations', 'Class and Manners'),
            scene('61 Happy Marriages', 'Class and Manners'), scene('5.5 Charlotte Warns Elizabeth', 'Main Plot'),
            scene('61 Happy Marriages', 'Jane-Bingley Romance'), scene('5 Lucas Visit', 'Main Plot'),
            { itemType: 'Beat', title: '5.01 Theme Stated', path: 'Book/5.01 Theme Stated.md' } as unknown as TimelineItem, // SAFE: beat fixture
        ];
        expect(promotionAnchors(data).map(anchor => anchor.label)).toEqual([
            '2 Mr Bennet Visits', '3 First Ball', '5 Lucas Visit', '5.5 Charlotte Warns Elizabeth',
            '10 Evening Conversations', '61 Happy Marriages',
        ]);
    });
});
