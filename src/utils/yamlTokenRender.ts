/*
 * Renders text with backtick-wrapped tokens as styled YAML field chips.
 * Example: "Existing `When` dates are preserved" → "Existing [When-chip] dates are preserved"
 */

export function renderWithYamlTokens(target: HTMLElement, text: string): void {
    text
        .split(/(`[^`]+`)/g)
        .filter(Boolean)
        .forEach(part => {
            if (part.startsWith('`') && part.endsWith('`')) {
                target.createEl('code', {
                    cls: 'ert-yaml-token',
                    text: part.slice(1, -1)
                });
            } else {
                target.appendText(part);
            }
        });
}
