import { describe, expect, it } from 'vitest';
import { composeEnvelope } from './composeEnvelope';

describe('composeEnvelope', () => {
    it('places Inquiry userQuestion after feature instructions and at prompt end', () => {
        const result = composeEnvelope({
            roleTemplateName: 'Test Role',
            roleTemplateText: 'Role body',
            projectContext: 'Book: B1',
            featureModeInstructions: 'Feature instructions',
            userInput: 'Evidence payload',
            userQuestion: 'Where does momentum shift most right now?',
            outputRules: 'Return JSON',
            placeUserQuestionLast: true
        });

        const featureIdx = result.userPrompt.indexOf('Feature Mode Instructions:');
        const questionIdx = result.userPrompt.indexOf('User Question (highest priority):');
        expect(featureIdx).toBeGreaterThanOrEqual(0);
        expect(questionIdx).toBeGreaterThan(featureIdx);
        expect(
            result.userPrompt.trim().endsWith(
                'User Question (highest priority):\nWhere does momentum shift most right now?'
            )
        ).toBe(true);
    });
});
