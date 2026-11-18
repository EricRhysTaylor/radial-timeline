/*
 * The missing-font message, drawn once for every surface that blocks on it.
 *
 * The export dialog (Export checks) and the PDF design wizard (Save) apply
 * the same rule — a font XeLaTeX cannot load stops the action — so they show
 * the same words: what is missing, how to install it for this operating
 * system, and a download link when there is one.
 */
import { t } from '../i18n';
import type { FontDiagnostic } from '../utils/exportFormats';

/** The one-line headline: which font is missing. */
export function getFontDiagnosticHeadline(diag: FontDiagnostic): string {
    if (diag.state === 'missing-bundled') {
        return diag.installHint?.message || t('ui.manuscriptOptionsModal.bundledFontsMissing');
    }
    return t('ui.manuscriptOptionsModal.fontNotInstalled', { font: diag.primaryFontName });
}

/**
 * Append the full message for a diagnostic that is not 'ok': the headline,
 * then (for a font the author must install) the install hint, the download
 * link and the short steps.
 */
export function renderFontDiagnosticMessage(parent: HTMLElement, diag: FontDiagnostic): void {
    if (diag.state === 'ok') return;
    parent.createDiv({ cls: 'ert-pdf-output-line', text: getFontDiagnosticHeadline(diag) });
    if (diag.state === 'missing-bundled') return;

    const hint = diag.installHint;
    if (!hint) return;
    const hintLine = parent.createDiv({ cls: 'ert-pdf-output-line' });
    hintLine.appendText(`${hint.message} `);
    if (hint.url) {
        const link = hintLine.createEl('a', {
            cls: 'ert-link-accent',
            text: t('ui.manuscriptOptionsModal.openGoogleFonts'),
        });
        link.setAttribute('href', hint.url);
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener');
    }
    if (hint.steps && hint.steps.length > 0) {
        const list = parent.createEl('ul', { cls: 'ert-pdf-output-steps' });
        for (const step of hint.steps) {
            list.createEl('li', { cls: 'ert-pdf-output-line is-status', text: step });
        }
    }
}
