import { describe, expect, it } from 'vitest';
import {
    buildFocusedCustomPrompt,
    resolveQuestionPrompt,
    resolveQuestionPromptForm
} from './resolveQuestionPrompt';

describe('resolveQuestionPrompt', () => {
    const dualQuestion = {
        standardPrompt: 'Where does the material shift momentum most right now?',
        focusedPrompt: 'Across these Target Scenes, does pressure escalate logically from one scene to the next?'
    };

    it('uses focusedPrompt in focused mode when available', () => {
        expect(resolveQuestionPrompt(dualQuestion, 'focused')).toBe(dualQuestion.focusedPrompt);
        expect(resolveQuestionPromptForm(dualQuestion, 'focused')).toBe('focused');
    });

    it('falls back to standardPrompt in focused mode when focusedPrompt is missing', () => {
        expect(resolveQuestionPrompt({ standardPrompt: dualQuestion.standardPrompt }, 'focused'))
            .toBe(dualQuestion.standardPrompt);
        expect(resolveQuestionPromptForm({ standardPrompt: dualQuestion.standardPrompt }, 'focused'))
            .toBe('standard');
    });

    it('always uses standardPrompt in discover mode', () => {
        expect(resolveQuestionPrompt(dualQuestion, 'discover')).toBe(dualQuestion.standardPrompt);
        expect(resolveQuestionPromptForm(dualQuestion, 'discover')).toBe('standard');
    });

    it('honors right-click overrides', () => {
        expect(resolveQuestionPrompt(dualQuestion, 'discover', 'focused')).toBe(dualQuestion.focusedPrompt);
        expect(resolveQuestionPrompt(dualQuestion, 'focused', 'standard')).toBe(dualQuestion.standardPrompt);
        expect(resolveQuestionPromptForm(dualQuestion, 'discover', 'focused')).toBe('focused');
        expect(resolveQuestionPromptForm(dualQuestion, 'focused', 'standard')).toBe('standard');
    });

    it('builds a focused framing for custom questions', () => {
        expect(buildFocusedCustomPrompt('What breaks in this exchange?'))
            .toBe('Within these Target Scenes, what breaks in this exchange?');
    });
});
