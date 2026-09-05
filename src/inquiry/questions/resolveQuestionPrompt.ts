import type { InquirySelectionMode } from '../state';

export type InquiryQuestionPromptForm = 'standard' | 'focused';

export type ResolvableInquiryQuestion = {
    standardPrompt: string;
    focusedPrompt?: string;
};

export function buildFocusedCustomPrompt(standardPrompt: string): string {
    const trimmed = standardPrompt.trim();
    if (!trimmed) return '';
    const firstChar = trimmed.charAt(0);
    const focusedLead = firstChar.toLowerCase() === firstChar
        ? trimmed
        : `${firstChar.toLowerCase()}${trimmed.slice(1)}`;
    return `Within these Target Scenes, ${focusedLead}`;
}

export function resolveQuestionPromptForm(
    question: ResolvableInquiryQuestion,
    selectionMode: InquirySelectionMode,
    override?: InquiryQuestionPromptForm
): InquiryQuestionPromptForm {
    if (override === 'standard') return 'standard';
    if (override === 'focused') {
        return question.focusedPrompt?.trim().length ? 'focused' : 'standard';
    }
    if (selectionMode === 'focused') {
        return question.focusedPrompt?.trim().length ? 'focused' : 'standard';
    }
    return 'standard';
}

export function resolveQuestionPrompt(
    question: ResolvableInquiryQuestion,
    selectionMode: InquirySelectionMode,
    override?: InquiryQuestionPromptForm
): string {
    const promptForm = resolveQuestionPromptForm(question, selectionMode, override);
    return promptForm === 'focused'
        ? question.focusedPrompt ?? question.standardPrompt
        : question.standardPrompt;
}
