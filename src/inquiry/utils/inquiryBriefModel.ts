/**
 * Pure brief / dossier model-building helpers extracted from InquiryView
 * (R1 brief/dossier chunk B1). Smallest, fully-pure seam: no DOM, no
 * timers, no session-store, no instance state. InquiryView keeps thin
 * wrappers delegating here so all call sites are unchanged.
 */
import type { FindingRole, InquiryFinding, InquiryLens, InquiryResult, InquirySelectionMode, InquiryZone } from '../state';
import type { InquiryCorpusItem } from '../services/InquiryCorpusResolver';
import type { InquiryBriefModel, InquirySceneDossier } from '../types/inquiryViewTypes';
import { buildInquirySourcesViewModel } from '../services/inquirySources';
import { computeCitationIntegritySummary } from '../state';
import { getModelDisplayName } from '../../utils/modelResolver';
import {
    buildSceneDossierBodyLines,
    buildSceneDossierHeader,
    formatBriefLabel,
    formatInquiryBriefTimestamp,
    getSceneNoteSortOrder,
    normalizeInquiryHeadline,
    parseCorpusLabelNumber,
    replaceInquiryReferenceTokens,
    resolveFindingChipLabel,
    sanitizeDossierText,
    sanitizeInquirySummary,
    stripNumericTitlePrefix
} from './inquiryViewText';
import { buildInquiryDossierPresentation } from './inquiryDossierPresentation';
import { DEPTH_FINDING_ORDER, FLOW_FINDING_ORDER } from '../constants/inquiryLayout';

/**
 * Display label for the model that produced an Inquiry result. Reads
 * solely from the result's provider/model fields. Returns null when no
 * model id is recorded or the resolved label trims to empty.
 */
export function getBriefModelLabel(result: InquiryResult): string | null {
    const raw = result.aiModelResolved || result.aiModelRequested;
    if (!raw) return null;
    const label = getModelDisplayName(raw.replace(/^models\//, ''));
    return label.replace(/\s*\(.*\)\s*$/, '').trim() || null;
}

/**
 * Stable hover-key for a scene-dossier popover, composed of corpus-item
 * id, scene id, label, and the finding's refId + headline. Missing
 * string fields become empty segments — preserves segment positions so
 * keys remain comparable across calls. Identical inputs always produce
 * an identical key.
 */
export function buildSceneDossierHoverKey(
    item: InquiryCorpusItem,
    label: string,
    finding: InquiryFinding
): string {
    return [
        item.id,
        item.sceneId ?? '',
        label,
        finding.refId ?? '',
        finding.headline ?? ''
    ].join('::');
}

/**
 * Stable scene-anchor id used by Inquiry brief deep-links. Composes the
 * `inquiry-` prefix with a caller-supplied non-cryptographic hash of
 * `source` (or the literal `'scene'` when source is empty/falsy).
 */
export function getBriefSceneAnchorId(
    source: string,
    hashString: (value: string) => string
): string {
    return `inquiry-${hashString(source || 'scene')}`;
}

/**
 * Results hero text for an Inquiry result. Appends a trailing ` *`
 * marker when any scene references were normalized from non-standard
 * formats. Caller supplies the per-mode summary resolver.
 */
export function buildResultsHeroText(
    result: InquiryResult,
    mode: InquiryLens,
    getResultSummaryForMode: (result: InquiryResult, mode: InquiryLens) => string
): string {
    const summary = getResultSummaryForMode(result, mode);
    if ((result.refNormalizationCount ?? 0) > 0) {
        return summary + ' *';
    }
    return summary;
}

/**
 * Results meta-line text — `ZONE · SELECTION · FLOW N · DEPTH N` (or
 * `DEPTH/FLOW` swapped depending on the active lens), uppercased.
 * Caller injects metric formatter and selection-mode resolver so this
 * stays free of instance state.
 */
export function buildResultsMetaText(
    result: InquiryResult,
    mode: InquiryLens,
    zone: InquiryZone,
    formatMetricDisplay: (value: number) => string,
    getResultSelectionMode: (result: InquiryResult | null | undefined) => InquirySelectionMode
): string {
    const zoneLabel = zone === 'setup' ? 'Setup' : zone === 'pressure' ? 'Pressure' : 'Payoff';
    const selectionText = getResultSelectionMode(result) === 'focused' ? 'Focused' : 'Discover';
    const flowText = `Flow ${formatMetricDisplay(result.verdict.flow)}`;
    const depthText = `Depth ${formatMetricDisplay(result.verdict.depth)}`;
    const ordered = mode === 'flow' ? [flowText, depthText] : [depthText, flowText];
    return `${zoneLabel} · ${selectionText} · ${ordered.join(' · ')}`.toUpperCase();
}

/**
 * Resolves the brief's zone label from a result. `result.questionZone`
 * wins when present (avoids the registry callback); otherwise the caller
 * provides a `findPromptZoneById` lookup; ultimate fallback is `'Setup'`.
 */
export function resolveInquiryBriefZoneLabel(
    result: InquiryResult,
    findPromptZoneById: (questionId: string) => InquiryZone | null
): string {
    const zone = result.questionZone ?? findPromptZoneById(result.questionId) ?? 'setup';
    return zone === 'setup' ? 'Setup' : zone === 'pressure' ? 'Pressure' : 'Payoff';
}

/**
 * Build the scene-dossier presentation model from a corpus item +
 * finding + result. The caller injects `getMinimapItemTitle` (corpus
 * item title resolver) — invoked exactly twice here (once for the
 * fallback header, once for the stripped scene title) to preserve the
 * original method's call-count behavior.
 */
export function buildSceneDossierModel(
    item: InquiryCorpusItem,
    label: string,
    hoverLabel: string,
    finding: InquiryFinding,
    result: InquiryResult,
    getMinimapItemTitle: (item: InquiryCorpusItem) => string
): InquirySceneDossier {
    const fallbackTitle = buildSceneDossierHeader({
        label,
        itemDisplayLabel: item.displayLabel,
        itemTitle: getMinimapItemTitle(item),
        hoverLabel
    });
    return buildInquiryDossierPresentation({
        finding,
        sceneNumber: parseCorpusLabelNumber(item.displayLabel) ?? parseCorpusLabelNumber(label),
        sceneTitle: stripNumericTitlePrefix(getMinimapItemTitle(item)),
        fallbackTitle,
        runId: result.runId,
        selectionMode: result.selectionMode,
        roleValidation: result.roleValidation
    });
}

/**
 * Assemble the brief title string. Caller pre-resolves the impure bits
 * (timestamp source, zone label, lens label, question prefix); this
 * helper is a pure string assembler. Saga scope prepends `'Saga'`; a
 * non-null `questionPrefix` wins over zone+lens.
 */
export function formatInquiryBriefTitle(
    result: InquiryResult,
    timestampSource: Date,
    zoneLabel: string,
    lensLabel: string,
    questionPrefix: string | null
): string {
    const timestamp = formatInquiryBriefTimestamp(timestampSource);
    const parts: string[] = [];
    if (result.scope === 'saga') {
        parts.push('Saga');
    }
    if (questionPrefix) {
        parts.push(questionPrefix);
    } else {
        parts.push(zoneLabel, lensLabel);
    }
    return `Inquiry Brief — ${parts.join(' · ')} ${timestamp}`;
}

/**
 * A finding counts as a "hit" (worth surfacing in the brief) when its
 * kind is not `'none'`. Strength findings are evidence observations:
 * they surface in findings/scene notes, but do not generate actions.
 */
export function isFindingHit(finding: InquiryFinding): boolean {
    return finding.kind !== 'none';
}

/**
 * Normalize a finding's role to the binary brief value: `'target'` only
 * when explicitly set, `'context'` otherwise. Pure.
 */
export function getFindingRole(finding: InquiryFinding): FindingRole {
    return finding.role === 'target' ? 'target' : 'context';
}

/**
 * Per-mode summary text for the brief, drawn from the result. Falls
 * back from the mode-specific summary to the generic `result.summary`,
 * then through `sanitizeInquirySummary` (which yields a friendly
 * fallback string when nothing usable is present). Pure.
 */
export function getResultSummaryForMode(result: InquiryResult, mode: InquiryLens): string {
    const raw = mode === 'flow'
        ? (result.summaryFlow || result.summary)
        : (result.summaryDepth || result.summary);
    return sanitizeInquirySummary(raw);
}

/**
 * Stable finding ordering for the brief, by the active mode. Filters
 * out non-hits (folded local `isFindingHit` keeps the dependency pure)
 * then sorts by role (target first) → lens fit → kind index from the
 * mode-specific order constant → headline tiebreaker.
 */
export function getOrderedFindings(result: InquiryResult, mode: InquiryLens): InquiryFinding[] {
    const findings = result.findings.filter(finding => isFindingHit(finding));
    const order = mode === 'flow' ? FLOW_FINDING_ORDER : DEPTH_FINDING_ORDER;
    const rankForRole = (role: InquiryFinding['role'] | undefined): number => role === 'target' ? 0 : 1;
    const rankForLens = (lens: InquiryFinding['lens'] | undefined): number => {
        if (!lens) return 2;
        if (lens === 'both') return 1;
        return lens === mode ? 0 : 3;
    };
    const rankForKind = (kind: InquiryFinding['kind']): number => {
        const idx = order.indexOf(kind);
        return idx >= 0 ? idx : order.length + 1;
    };
    return findings.slice().sort((a, b) => {
        const roleDelta = rankForRole(a.role) - rankForRole(b.role);
        if (roleDelta !== 0) return roleDelta;
        const lensDelta = rankForLens(a.lens) - rankForLens(b.lens);
        if (lensDelta !== 0) return lensDelta;
        const kindDelta = rankForKind(a.kind) - rankForKind(b.kind);
        if (kindDelta !== 0) return kindDelta;
        return normalizeInquiryHeadline(a.headline).localeCompare(normalizeInquiryHeadline(b.headline));
    });
}

/**
 * Scene-order index for a finding, used to sort brief sections by
 * manuscript order. Matches refId case-insensitively against item
 * displayLabel/id/sceneId/filePaths; falls back to S-number parsing
 * via `getSceneNoteSortOrder`; unresolved → MAX_SAFE_INTEGER so
 * scene-less findings sink to the end.
 */
export function getFindingSceneOrder(
    finding: InquiryFinding,
    items: InquiryCorpusItem[]
): number {
    const refId = finding.refId?.trim().toLowerCase();
    if (!refId) return Number.MAX_SAFE_INTEGER;
    const idx = items.findIndex(item => {
        if (item.displayLabel.toLowerCase() === refId) return true;
        if (item.id.toLowerCase() === refId) return true;
        if (item.sceneId && item.sceneId.toLowerCase() === refId) return true;
        return item.filePaths?.some(path => path.toLowerCase() === refId) ?? false;
    });
    if (idx >= 0) return idx;
    return getSceneNoteSortOrder(finding.refId?.trim() ?? '');
}

/**
 * Brief-text normalizer: replaces inline reference tokens with their
 * resolved labels. Thin pure wrapper over `replaceInquiryReferenceTokens`.
 */
export function normalizeInquiryBriefText(
    value: string | undefined,
    referenceLabels: ReadonlyMap<string, string>
): string {
    return replaceInquiryReferenceTokens(value, referenceLabels);
}

/**
 * Build a `Map<string,string>` from corpus items → display label, with
 * keys lowercased + trimmed. First-write-wins: when two items would
 * register the same key, the earlier item's display is preserved.
 * Each item registers its `displayLabel`, `id`, `sceneId`, and every
 * `filePaths` entry as keys. Falsy/empty keys are skipped.
 * `formatReferenceDisplay` is called exactly once per item.
 */
export function buildInquiryReferenceLabelMap(
    items: InquiryCorpusItem[],
    formatReferenceDisplay: (item: InquiryCorpusItem) => string
): Map<string, string> {
    const labels = new Map<string, string>();
    const add = (raw: string | undefined, display: string): void => {
        const key = raw?.trim().toLowerCase();
        if (!key || labels.has(key)) return;
        labels.set(key, display);
    };
    items.forEach(item => {
        const display = formatReferenceDisplay(item);
        add(item.displayLabel, display);
        add(item.id, display);
        add(item.sceneId, display);
        item.filePaths?.forEach(path => add(path, display));
    });
    return labels;
}

/**
 * Build the scene-reference index used by the brief: one `{label,
 * anchorId}` entry per item, in input order. Both callbacks are
 * invoked exactly once per item; an `undefined` anchor id propagates
 * unchanged (the caller's wrapper owns any fallback chain).
 */
export function buildInquirySceneReferenceIndex(
    items: InquiryCorpusItem[],
    formatReferenceDisplay: (item: InquiryCorpusItem) => string,
    resolveAnchorIdForItem: (item: InquiryCorpusItem) => string | undefined
): Array<{ label: string; anchorId?: string }> {
    return items.map(item => ({
        label: formatReferenceDisplay(item),
        anchorId: resolveAnchorIdForItem(item)
    }));
}

function normalizeActionComparisonText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Action text for a single finding (the per-finding label used in
 * brief pending-action entries). Non-hit kinds (`'none'`, `'strength'`)
 * yield null. Findings must carry a dedicated recommendedAction; brief
 * actions are no longer synthesized from finding headlines because that
 * duplicates the report instead of producing author work.
 */
export function getInquiryActionText(
    finding: InquiryFinding,
    referenceLabels: ReadonlyMap<string, string>
): string | null {
    if (finding.kind === 'none' || finding.kind === 'strength') return null;
    const action = normalizeInquiryBriefText(
        finding.recommendedAction || '',
        referenceLabels
    ).trim();
    if (!action) return null;

    const headline = normalizeInquiryBriefText(
        normalizeInquiryHeadline(finding.headline),
        referenceLabels
    ).trim();
    if (normalizeActionComparisonText(action) === normalizeActionComparisonText(headline)) return null;
    if (normalizeActionComparisonText(action) === 'finding') return null;
    return action;
}

/**
 * Single pending action for one finding, or null when no action text
 * is producible. `targetLabel` comes from the corpus-aware
 * `resolveFindingChipLabel`, with a fallback to the uppercased
 * `refId` when it matches the simple `S<digits>` form. Pure-over-args.
 */
export function buildInquiryPendingAction(
    finding: InquiryFinding,
    result: InquiryResult,
    items: InquiryCorpusItem[],
    referenceLabels: ReadonlyMap<string, string>
): { targetLabel?: string; text: string } | null {
    const text = getInquiryActionText(finding, referenceLabels);
    if (!text) return null;
    const targetLabel = resolveFindingChipLabel(finding, result, items)
        ?? (finding.refId && /^s\d+$/i.test(finding.refId.trim()) ? finding.refId.trim().toUpperCase() : undefined);
    return {
        targetLabel,
        text
    };
}

/**
 * Pending actions list for the brief. Filters non-hits, skips null
 * actions, and dedupes by `<targetLabel>::<text>` (empty label
 * normalized to '' for the key). Preserves first-occurrence order.
 */
export function buildBriefPendingActions(
    result: InquiryResult,
    items: InquiryCorpusItem[],
    referenceLabels: ReadonlyMap<string, string>
): Array<{ targetLabel?: string; text: string }> {
    const actions: Array<{ targetLabel?: string; text: string; order: number }> = [];
    const seen = new Set<string>();
    result.findings.forEach(finding => {
        if (!isFindingHit(finding)) return;
        const action = buildInquiryPendingAction(finding, result, items, referenceLabels);
        if (!action) return;
        const key = `${action.targetLabel ?? ''}::${action.text}`;
        if (seen.has(key)) return;
        seen.add(key);
        actions.push({ ...action, order: getFindingSceneOrder(finding, items) });
    });
    actions.sort((a, b) => a.order - b.order);
    return actions.map(({ targetLabel, text }) => ({ targetLabel, text }));
}

/**
 * Scene-note clusters for the brief, book-scope only. Verbatim
 * extraction — preserves the original semantics exactly:
 *  - Saga / non-book scope → empty array.
 *  - Findings ordered via getOrderedFindings; non-hits skipped.
 *  - Label: resolveFindingChipLabel, fallback uppercased `S<digits>` refId,
 *    else skip.
 *  - Item match: case-insensitive across displayLabel / id / sceneId /
 *    filePaths.
 *  - Anchor source fallback chain: matched
 *      → getMinimapItemFilePath(match) || match.id || label
 *    unmatched → label.
 *  - Header: matched → formatReferenceDisplay(match, label); else label.toUpperCase().
 *  - Clustering: multiple findings under the same label merge into one
 *    note with multiple entries.
 *  - Sort: by `order` (items.indexOf when matched, else getSceneNoteSortOrder;
 *    negatives → MAX_SAFE_INTEGER), then locale-aware numeric label.
 *  - Bullets: buildSceneDossierBodyLines → normalize → filter `startsWith('• ')`
 *    → strip prefix. (Pre-existing quirk preserved verbatim — see B4d scoping note.)
 *  - Entry line: the finding HEADLINE (sanitized/normalized) so per-scene
 *    notes read as a scene-local diagnosis; falls back to
 *    `'Finding text unavailable.'`. The prescription (recommendedAction)
 *    lives in Pending Author Actions, not here. Lens `'both'` →
 *    `'Flow / Depth'`.
 */
export function buildInquirySceneNotes(
    result: InquiryResult,
    items: InquiryCorpusItem[],
    referenceLabels: ReadonlyMap<string, string>,
    getMinimapItemFilePath: (item: InquiryCorpusItem) => string | undefined,
    getAnchorIdForSource: (source: string) => string,
    formatReferenceDisplay: (item: InquiryCorpusItem, fallbackLabel: string) => string
): Array<{
    label: string;
    header: string;
    anchorId?: string;
    entries: Array<{ headline: string; bullets: string[]; lens: string }>;
}> {
    if (result.scope !== 'book') return [];
    const orderedFindings = getOrderedFindings(result, result.mode);
    const notes = new Map<string, {
        label: string;
        header: string;
        anchorId?: string;
        order: number;
        entries: Array<{ headline: string; bullets: string[]; lens: string }>;
    }>();

    orderedFindings.forEach(finding => {
        if (!isFindingHit(finding)) return;
        const label = resolveFindingChipLabel(finding, result, items)
            ?? (finding.refId && /^s\d+$/i.test(finding.refId.trim()) ? finding.refId.trim().toUpperCase() : null);
        if (!label) return;
        const labelLower = label.toLowerCase();
        const match = items.find(item => {
            if (item.displayLabel.toLowerCase() === labelLower) return true;
            if (item.id.toLowerCase() === labelLower) return true;
            if (item.sceneId && item.sceneId.toLowerCase() === labelLower) return true;
            return item.filePaths?.some(path => path.toLowerCase() === labelLower) ?? false;
        });
        const anchorSource = match
            ? (getMinimapItemFilePath(match) || match.id || label)
            : label;
        const anchorId = anchorSource ? getAnchorIdForSource(anchorSource) : undefined;
        const existing = notes.get(label);
        const header = match
            ? formatReferenceDisplay(match, label)
            : label.toUpperCase();
        // Use the finding HEADLINE as the per-scene line: this section is the
        // scene-local diagnosis. The prescription (recommendedAction) is shown
        // separately in Pending Author Actions, so preferring it here would
        // just duplicate that section verbatim for every actionable finding.
        const entry = {
            headline: sanitizeDossierText(normalizeInquiryBriefText(finding.headline, referenceLabels))
                || 'Finding text unavailable.',
            bullets: buildSceneDossierBodyLines(finding)
                .map(line => normalizeInquiryBriefText(line, referenceLabels))
                .filter(line => line.startsWith('• '))
                .map(line => line.replace(/^•\s*/, '')),
            lens: finding.lens === 'both'
                ? 'Flow / Depth'
                : formatBriefLabel(finding.lens || result.mode || 'flow')
        };
        if (existing) {
            existing.entries.push(entry);
            return;
        }
        const order = match
            ? items.indexOf(match)
            : getSceneNoteSortOrder(label);
        notes.set(label, {
            label,
            header,
            anchorId,
            order: order >= 0 ? order : Number.MAX_SAFE_INTEGER,
            entries: [entry]
        });
    });

    return Array.from(notes.values())
        .sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
        })
        .map(entry => ({
            label: entry.label,
            header: entry.header,
            anchorId: entry.anchorId,
            entries: entry.entries
        }));
}

/**
 * Module-internal mirror of InquiryView's pure `formatMetricDisplay`.
 * Verbatim logic: NaN/non-finite → '0'; values > 1 treated as already
 * scaled (rounded); values ≤ 1 multiplied by 100. Not exported — kept
 * private to keep the module's public surface focused on B4e's scope.
 */
function formatMetricDisplay(value: number): string {
    if (!Number.isFinite(value)) return '0';
    if (value > 1) return String(Math.round(value));
    return String(Math.round(value * 100));
}

/**
 * Final brief-model composer — pure assembler over a result + a fully
 * pre-resolved options bag. Verbatim semantics from the original
 * InquiryView method: question title/text fallbacks, pills ordering,
 * per-mode summary fallbacks, findings transformation (incl. saga
 * subject/span context), sources mapping, conditional spreads for
 * unverifiedFindings / citationIntegrityWarnings / evidenceCompromised,
 * rawResponse only when error + non-empty trimmed text.
 *
 * The wrapper (InquiryView) owns every impure resolution (corpus,
 * questions registry, settings/books, log-title, error flag) and
 * passes pre-computed values here.
 */
export function buildInquiryBriefModel(
    result: InquiryResult,
    options: {
        items: InquiryCorpusItem[];
        referenceLabels: ReadonlyMap<string, string>;
        sceneNotes: InquiryBriefModel['sceneNotes'];
        sceneReferences: InquiryBriefModel['sceneReferences'];
        pendingActions: InquiryBriefModel['pendingActions'];
        promptLabel: string | null;
        questionTextById: string | null;
        scopeIndicator: string | null;
        logTitle: string;
        isError: boolean;
        rawResponse?: string | null;
    }
): InquiryBriefModel {
    const {
        items,
        referenceLabels,
        sceneNotes,
        sceneReferences,
        pendingActions,
        promptLabel,
        questionTextById,
        scopeIndicator,
        logTitle,
        isError,
        rawResponse
    } = options;

    const questionTitle = promptLabel || 'Inquiry Question';
    const questionTextRaw = result.questionText?.trim() || questionTextById;
    const questionText = questionTextRaw && questionTextRaw.trim().length > 0
        ? questionTextRaw
        : 'Question text unavailable.';

    const pills: string[] = [
        `Flow ${formatMetricDisplay(result.verdict.flow)}`,
        `Depth ${formatMetricDisplay(result.verdict.depth)}`,
        `Selection ${formatBriefLabel(result.selectionMode)}`
    ];

    if (result.mode) {
        pills.push(`Mode ${formatBriefLabel(result.mode)}`);
    }

    const modelLabel = getBriefModelLabel(result);
    if (modelLabel) pills.push(modelLabel);

    const flowSummary = normalizeInquiryBriefText(
        getResultSummaryForMode(result, 'flow') || 'No flow summary available.',
        referenceLabels
    );
    const depthSummary = normalizeInquiryBriefText(
        getResultSummaryForMode(result, 'depth') || 'No depth summary available.',
        referenceLabels
    );

    const orderedFindings = getOrderedFindings(result, result.mode);
    const sceneSortedFindings = orderedFindings.slice().sort((a, b) => {
        const roleDelta = (getFindingRole(a) === 'target' ? 0 : 1) - (getFindingRole(b) === 'target' ? 0 : 1);
        if (roleDelta !== 0) return roleDelta;
        return getFindingSceneOrder(a, items) - getFindingSceneOrder(b, items);
    });
    const findings = sceneSortedFindings
        .filter(finding => isFindingHit(finding))
        .map(finding => {
            const sagaContext = result.scope === 'saga'
                ? [finding.subject ? `Subject: ${finding.subject}` : '', finding.span ? `Span: ${finding.span}` : ''].filter(Boolean)
                : [];
            const sceneLabel = finding.refId
                ? referenceLabels.get(finding.refId.trim().toLowerCase())
                : undefined;
            return {
                headline: normalizeInquiryBriefText(normalizeInquiryHeadline(finding.headline), referenceLabels),
                ...(sceneLabel ? { sceneLabel } : {}),
                role: getFindingRole(finding),
                lens: finding.lens === 'both'
                    ? 'Flow / Depth'
                    : formatBriefLabel(finding.lens || result.mode || 'flow'),
                bullets: [...sagaContext, ...(finding.bullets || [])]
                    .filter(Boolean)
                    .slice(0, 3)
                    .map(entry => normalizeInquiryBriefText(entry, referenceLabels))
            };
        });

    const sourcesVM = buildInquirySourcesViewModel(result.citations, result.evidenceDocumentMeta, result.findings);
    const sources = sourcesVM.items.map(item => ({
        title: item.title,
        excerpt: item.excerpt,
        classLabel: item.classLabel,
        path: item.path,
        url: item.url,
        citationCount: item.citationCount
    }));

    const rawResponseText = typeof rawResponse === 'string' ? rawResponse.trim() : '';
    const includeRawResponse = rawResponseText.length > 0 && isError;

    const unverifiedFindings = (result.unverifiedFindings || []).map(item => ({
        headline: normalizeInquiryBriefText(
            normalizeInquiryHeadline(item.headline),
            referenceLabels
        ),
        bullets: (item.bullets || [])
            .filter(Boolean)
            .slice(0, 3)
            .map(entry => normalizeInquiryBriefText(entry, referenceLabels)),
        lens: item.lens === 'both'
            ? 'Flow / Depth'
            : formatBriefLabel(item.lens || result.mode || 'flow'),
        rawRefId: item.rawRefId,
        rawRefLabel: item.rawRefLabel,
        rawRefPath: item.rawRefPath,
        warning: item.warning
    }));

    const citationIntegrityWarnings = (result.citationIntegrityWarnings || []).map(entry => ({
        stage: entry.stage,
        message: entry.message
    }));

    const integritySummary = computeCitationIntegritySummary(result);

    // The "No Action Items" empty-state is a real result, so it may only show
    // for a usable, completed pass: not an error, not a simulated/stub run, and
    // not one whose evidence base is compromised. Otherwise the section stays
    // silent rather than implying a clean review happened.
    const isSimulated = result.aiReason === 'simulated' || result.aiReason === 'stub';
    const showNoActionItems = !isError && !isSimulated && !integritySummary.evidenceCompromised;

    return {
        questionTitle,
        questionText,
        scopeIndicator,
        mode: result.mode,
        selectionMode: result.selectionMode,
        roleValidation: result.roleValidation,
        pills,
        flowSummary,
        depthSummary,
        findings,
        sources,
        sceneNotes,
        sceneReferences,
        pendingActions,
        showNoActionItems,
        logTitle,
        rawResponse: includeRawResponse ? rawResponseText : null,
        refNormalized: (result.refNormalizationCount ?? 0) > 0,
        ...(citationIntegrityWarnings.length ? { citationIntegrityWarnings } : {}),
        ...(unverifiedFindings.length ? { unverifiedFindings } : {}),
        ...(integritySummary.evidenceCompromised ? { evidenceCompromised: true } : {})
    };
}
