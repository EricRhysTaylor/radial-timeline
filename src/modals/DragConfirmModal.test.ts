import { describe, expect, it } from 'vitest';
import { formatRippleRenameImpact } from './DragConfirmModal';

describe('formatRippleRenameImpact', () => {
    it('says how many other scene files the ripple rename renames', () => {
        expect(formatRippleRenameImpact(14)).toBe('Ripple rename: also renames 14 other scene files');
        expect(formatRippleRenameImpact(1)).toBe('Ripple rename: also renames 1 other scene file');
    });

    it('says when it renames no other file', () => {
        expect(formatRippleRenameImpact(0)).toBe('Ripple rename: no other files to rename');
    });
});
