import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('estimated completion tick rotation layer', () => {
    it('renders the estimate tick outside the rotatable timeline group', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/renderer/TimelineRenderer.ts'), 'utf8');
        const closeRotatableIndex = source.indexOf('// Close rotatable container');
        const estimateTickIndex = source.indexOf('renderEstimatedDateElements({ estimate: estimateResult, progressRadius })');

        expect(closeRotatableIndex).toBeGreaterThan(-1);
        expect(estimateTickIndex).toBeGreaterThan(closeRotatableIndex);
    });

    it('does not counter-rotate estimate tick elements in the rotation controller', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/view/interactions/RotationController.ts'), 'utf8');

        expect(source).not.toContain("'.rt-estimate-tick-group'");
        expect(source).not.toContain("'.estimated-date-tick'");
        expect(source).not.toContain("'.estimated-date-dot'");
    });
});
