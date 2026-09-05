import type { InquiryFinding, InquiryRoleValidation, InquirySelectionMode } from '../state';
import { stripInquiryReferenceArtifacts } from './inquiryViewText';

export type InquiryDossierPresentation = {
    title: string;
    anchorLine: string;
    bodyLines: string[];
    metaLine?: string;
    sourceLabel?: string;
};

export type InquiryDossierPresentationInput = {
    finding: InquiryFinding;
    sceneNumber?: number | null;
    sceneTitle?: string;
    fallbackTitle?: string;
    runId?: string;
    selectionMode?: InquirySelectionMode;
    roleValidation?: InquiryRoleValidation;
};

const FALLBACK_TITLE = 'Scene';
const FALLBACK_TEXT = 'Finding text unavailable.';

export function buildInquiryDossierPresentation(
    input: InquiryDossierPresentationInput
): InquiryDossierPresentation {
    const title = buildTitle(input);
    const headline = sanitizeLine(input.finding.headline);
    const bulletLines = (input.finding.bullets || [])
        .map(entry => normalizeSentence(sanitizeLine(entry)))
        .filter(Boolean)
        .slice(0, 2);

    const anchorSource = headline || bulletLines[0] || '';
    const anchorLine = cleanAnchorLine(anchorSource) || 'Finding';

    const bodyLines = bulletLines.length
        ? bulletLines
        : deriveFallbackBodyLines(headline, anchorLine);

    const metaLine = buildMetaLine(input.finding, input.selectionMode, input.roleValidation);
    const sourceLabel = buildSourceLabel(input.runId);

    return {
        title,
        anchorLine,
        bodyLines: bodyLines.length ? bodyLines : [FALLBACK_TEXT],
        ...(metaLine ? { metaLine } : {}),
        ...(sourceLabel ? { sourceLabel } : {})
    };
}

function buildTitle(input: InquiryDossierPresentationInput): string {
    const sceneNumber = Number.isFinite(input.sceneNumber) ? Math.max(1, Math.floor(input.sceneNumber as number)) : null;
    const sceneTitle = sanitizeTitle(input.sceneTitle);
    const fallbackTitle = sanitizeTitle(input.fallbackTitle);

    if (sceneNumber !== null && sceneTitle) {
        return `${sceneNumber} ${sceneTitle}`;
    }
    if (sceneNumber !== null) {
        return `Scene ${sceneNumber}`;
    }
    if (fallbackTitle) {
        return fallbackTitle;
    }
    return FALLBACK_TITLE;
}

function deriveFallbackBodyLines(headline: string, anchorLine: string): string[] {
    const bodySource = headline || anchorLine;
    if (!bodySource || bodySource === 'Finding') {
        return [FALLBACK_TEXT];
    }
    return [normalizeSentence(bodySource)];
}

function buildMetaLine(
    finding: InquiryFinding,
    selectionMode?: InquirySelectionMode,
    roleValidation?: InquiryRoleValidation
): string {
    const parts = [`Role ${formatEnumLabel(finding.role || 'context')}`];
    if (selectionMode === 'focused' && roleValidation === 'missing-target-roles') {
        parts.unshift('Validation Incomplete');
    }
    if (finding.lens) {
        parts.push(`Lens ${finding.lens === 'both' ? 'Flow + Depth' : formatEnumLabel(finding.lens)}`);
    }
    return parts.join(' · ');
}

function buildSourceLabel(runId?: string): string | undefined {
    const normalized = typeof runId === 'string' ? runId.trim() : '';
    if (!normalized || /^run-\d+$/i.test(normalized)) return undefined;
    return `Source: Inquiry ${normalized}`;
}

function formatEnumLabel(value?: string): string {
    if (!value) return 'Unknown';
    return value
        .replace(/_/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

function sanitizeTitle(value?: string): string {
    return collapseWhitespace(value)
        .replace(/^(?:scene\s*)?\d+\s*[-:–—.)]?\s*/i, '')
        .trim();
}

function sanitizeLine(value?: string): string {
    return collapseWhitespace(stripInquiryReferenceArtifacts(value))
        .replace(/^[•*-]\s*/, '')
        .replace(/^(?:[SB]\d+|Scene\s+\d+)\s*[:\-–—.)]\s*/i, '')
        .replace(/\s+([,.;:!?…])/g, '$1')
        .trim();
}

function cleanAnchorLine(value?: string): string {
    return sanitizeLine(value)
        .replace(/[|/\\]+$/g, '')
        .replace(/[\s,;:–—-]+$/g, '')
        .trim();
}

function normalizeSentence(value?: string): string {
    const trimmed = cleanAnchorLine(value);
    if (!trimmed) return '';
    if (/[.!?…]$/.test(trimmed)) return trimmed;
    return `${trimmed}.`;
}

function collapseWhitespace(value?: string): string {
    if (!value) return '';
    return String(value).replace(/\s+/g, ' ').trim();
}
