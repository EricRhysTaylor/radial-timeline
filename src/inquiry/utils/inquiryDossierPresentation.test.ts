import { describe, expect, it } from 'vitest';
import { buildInquiryDossierPresentation } from './inquiryDossierPresentation';

describe('buildInquiryDossierPresentation', () => {
    it('includes the finding role in dossier metadata', () => {
        const dossier = buildInquiryDossierPresentation({
            finding: {
                refId: 'scn_001',
                kind: 'continuity',
                headline: 'Target finding',
                bullets: ['A supporting note'],
                related: [],
                evidenceType: 'scene',
                lens: 'flow',
                role: 'target'
            },
            sceneNumber: 12,
            sceneTitle: 'Midpoint',
            selectionMode: 'focused',
            roleValidation: 'missing-target-roles'
        });

        expect(dossier.metaLine).toContain('Validation Incomplete');
        expect(dossier.metaLine).toContain('Role Target');
    });
});
