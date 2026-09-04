import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('InquiryView payload accounting', () => {
    it('uses cleaned body content instead of raw file size for full-text estimates', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(source.includes('cleanEvidenceBody(raw).length')).toBe(true);
        expect(source.includes('file.stat.size')).toBe(false);
        expect(source.includes('cachedRead(file)')).toBe(true);
    });

    it('carries recommendedAction through the legacy result re-mapper (else pending actions vanish on every run)', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        // normalizeLegacyResult rebuilds findings field-by-field; recommendedAction
        // MUST be among the carried fields or the brief shows "No Action Items"
        // even when the model supplied concrete edits.
        expect(source.includes('recommendedAction: legacy.recommendedAction')).toBe(true);
    });

    it('renders selection mode from persisted result metadata instead of inferring from finding roles', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(source.includes("selectionMode: result.selectionMode === 'focused' ? 'focused' : 'discover'")).toBe(true);
        expect(source.includes('const selectionMode = this.getResultSelectionMode(result);')).toBe(true);
        expect(source.includes("result.findings.some(finding => this.getFindingRole(finding) === 'target')")).toBe(false);
    });

    it('persists focused role validation separately from selection mode truth', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const enLocale = readFileSync(resolve(process.cwd(), 'src/i18n/locales/en.ts'), 'utf8');
        // R1 findings-panel: computeRoleValidation logic moved to pure module.
        const fpSource = readFileSync(resolve(process.cwd(), 'src/inquiry/utils/inquiryFindingsPanel.ts'), 'utf8');
        expect(fpSource.includes("return findings.some(finding => finding.role === 'target') ? 'ok' : 'missing-target-roles';")).toBe(true);
        expect(source.includes("const roleValidation = this.getResultRoleValidation(result);")).toBe(true);
        // The validation copy lives in the i18n catalog now.
        expect(source.includes("t('inquiry.findings.validationMissingTargetRoles')")).toBe(true);
        expect(enLocale.includes('Warning: Focused run returned no target-specific findings.')).toBe(true);
    });

    it('matches latest saved inquiry seeds on book scope and normalized target selection', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(source.includes('const activeTargetKey = this.getTargetSceneKey(this.getActiveTargetSceneIds());')).toBe(true);
        expect(source.includes('return this.getTargetSceneKey(session.targetSceneIds) === activeTargetKey;')).toBe(true);
        expect(source.includes('latest saved inquiry for this selection')).toBe(true);
    });

    it('makes saga-scope minimap target authoring explicit instead of silently returning', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(source.includes("this.notifyInteraction(t('inquiry.interaction.targetScenesBookOnly'))")).toBe(true);
    });

    it('renders degraded focused target markers as amber F states in the minimap source', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const minimapSource = readFileSync(resolve(process.cwd(), 'src/inquiry/minimap/InquiryMinimapRenderer.ts'), 'utf8');
        const cssSource = readFileSync(resolve(process.cwd(), 'src/styles/inquiry.css'), 'utf8');
        expect(viewSource.includes("this.minimap.updateTargetStates(targetSceneIds, { selectionMode, roleValidation });")).toBe(true);
        expect(minimapSource.includes('is-target-role-validation-warning')).toBe(true);
        expect(minimapSource.includes('Incomplete Focused Analysis')).toBe(true);
        expect(cssSource.includes('.ert-inquiry-minimap-tick.is-target.is-target-role-validation-warning')).toBe(true);
    });

    it('suppresses minimap tooltips for cited scenes that open a dossier', () => {
        const minimapSource = readFileSync(resolve(process.cwd(), 'src/inquiry/minimap/InquiryMinimapRenderer.ts'), 'utf8');
        expect(minimapSource.includes("addTooltipData(tick, '', 'bottom');")).toBe(true);
    });

    it('uses a front-loaded balancing bias for dossier anchor text', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const dossierSource = readFileSync(resolve(process.cwd(), 'src/inquiry/render/inquiryDossierRenderer.ts'), 'utf8');
        expect(viewSource.includes('preferFrontLoaded?: boolean;')).toBe(true);
        expect(viewSource.includes('shapePenalty += ((curr - prev) / maxWidth) * 4.2;')).toBe(true);
        expect(dossierSource.includes('{ preferFrontLoaded: true }')).toBe(true);
    });

    it('uses front-loaded balancing for result preview hero summaries', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const hudSource = readFileSync(resolve(process.cwd(), 'src/inquiry/render/inquiryHudRenderer.ts'), 'utf8');
        expect(hudSource.includes('preferFrontLoaded: true')).toBe(true);
        expect(hudSource.includes('minNonFinalFillRatio: 0.72')).toBe(true);
        expect(viewSource.includes('const cacheKey = `${text}|${maxWidth}|${maxLines}|${lineHeight}|${preferFrontLoaded ? 1 : 0}|${minNonFinalFillRatio}`;')).toBe(true);
    });

    it('renders the focused-scene F marker above the corpus page icon', () => {
        const corpusSource = readFileSync(resolve(process.cwd(), 'src/inquiry/corpus/inquiryCorpusStripRenderer.ts'), 'utf8');
        const cssSource = readFileSync(resolve(process.cwd(), 'src/styles/inquiry.css'), 'utf8');
        expect(corpusSource.includes("createSvgText(group, 'ert-inquiry-cc-cell-target-letter', 'F'")).toBe(true);
        expect(corpusSource.includes("slot.targetLetter.setAttribute('y'")).toBe(true);
        expect(cssSource.includes('.ert-inquiry-cc-cell.is-target .ert-inquiry-cc-cell-target-letter')).toBe(true);
    });

    it('keeps the corpus title block tighter and column headers more readable', () => {
        const constantsSource = readFileSync(resolve(process.cwd(), 'src/inquiry/constants/inquiryLayout.ts'), 'utf8');
        const corpusSource = readFileSync(resolve(process.cwd(), 'src/inquiry/corpus/inquiryCorpusStripRenderer.ts'), 'utf8');
        const cssSource = readFileSync(resolve(process.cwd(), 'src/styles/inquiry.css'), 'utf8');
        expect(constantsSource.includes('headerIconGap: 2')).toBe(true);
        expect(constantsSource.includes('columnGapExtra: 4')).toBe(true);
        expect(corpusSource.includes('const corpusTitleY = -24;')).toBe(true);
        expect(corpusSource.includes('const scopeLabelY = -4;')).toBe(true);
        expect(corpusSource.includes('const columnStep = pageWidth + columnGap;')).toBe(true);
        expect(cssSource.includes('.ert-inquiry-cc-class-label {\n  font-size: 12px;')).toBe(true);
    });

    it('uses justify-aware line balancing for dossier body paragraphs', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const dossierSource = readFileSync(resolve(process.cwd(), 'src/inquiry/render/inquiryDossierRenderer.ts'), 'utf8');
        expect(viewSource.includes('minNonFinalFillRatio?: number;')).toBe(true);
        expect(viewSource.includes('(minNonFinalFillRatio - fillRatio) * 6.5')).toBe(true);
        expect(dossierSource.includes('minNonFinalFillRatio: 0.7')).toBe(true);
    });

    it('routes question execution through the dual-form resolver without adding new UI sets', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('resolveQuestionPromptForRun(question, selectionMode')).toBe(true);
        expect(viewSource.includes('resolveQuestionPromptFormForRun(question, selectionMode')).toBe(true);
        // Labels are now sourced from the i18n catalog.
        expect(viewSource.includes("{ label: t('inquiry.menu.optionDefaultRun'), value: 'auto' }")).toBe(true);
        expect(viewSource.includes("{ label: t('inquiry.menu.optionStandard'), value: 'standard' }")).toBe(true);
        expect(viewSource.includes("{ label: t('inquiry.menu.optionFocused'), value: 'focused' }")).toBe(true);
        expect(viewSource.includes('this.setPromptFormOverride(question.id, opt.value)')).toBe(true);
        expect(viewSource.includes('standardPrompt:')).toBe(true);
        expect(viewSource.includes('focusedPrompt:')).toBe(true);
        expect(viewSource.includes('Focus question panel')).toBe(false);
    });

    it('persists executed prompt truth on results instead of rebuilding it from current config', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const runnerSource = readFileSync(resolve(process.cwd(), 'src/inquiry/runner/InquiryRunnerService.ts'), 'utf8');
        // R1 brief/dossier B4e: question-text fallback chain moved into
        // the pure assembler; the InquiryView wrapper still resolves the
        // registry value (`questionTextById`) and the runner still uses
        // executed prompt truth (`input.questionText`). Test the seam:
        // the wrapper resolves via getQuestionTextById, and the fallback
        // chain logic lives in the pure module.
        expect(viewSource.includes("questionText: result.questionText?.trim() || this.getQuestionTextById(result.questionId) || undefined")).toBe(true);
        expect(viewSource.includes('questionTextById: this.getQuestionTextById(result.questionId),')).toBe(true);
        const briefSource = readFileSync(resolve(process.cwd(), 'src/inquiry/utils/inquiryBriefModel.ts'), 'utf8');
        expect(briefSource.includes("const questionTextRaw = result.questionText?.trim() || questionTextById;")).toBe(true);
        expect(briefSource.includes("'Question text unavailable.'")).toBe(true);
        expect(runnerSource.includes('questionPromptForm: input.questionPromptForm')).toBe(true);
        expect(runnerSource.includes('questionText: input.questionText')).toBe(true);
    });

    it('offers a corpus-level cancel all targeting action in the global corpus context menu', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const corpusSource = readFileSync(resolve(process.cwd(), 'src/inquiry/corpus/inquiryCorpusStripRenderer.ts'), 'utf8');
        // Menu titles flow through the i18n catalog now.
        expect(viewSource.includes("item.setTitle(t('inquiry.menu.cancelTargeting'))")).toBe(true);
        expect(viewSource.includes("this.notifyInteraction(t('inquiry.interaction.clearedAllTargetScenes'))")).toBe(true);
        expect(corpusSource.includes('onGlobalContextMenu')).toBe(true);
        expect(corpusSource.includes('args.onGlobalContextMenu(event)')).toBe(true);
    });

    it('keeps saved brief actions available from scene menus even without citations', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('private hasActiveSavedBrief(): boolean')).toBe(true);
        expect(viewSource.includes('if (this.hasActiveSavedBrief()) {')).toBe(true);
        expect(viewSource.includes("options.hasCitation ? t('inquiry.menu.openCitationBriefing') : t('inquiry.menu.openBriefingArticle')")).toBe(true);
        expect(viewSource.includes("options.hasCitation ? t('inquiry.menu.openCitationMarkdown') : t('inquiry.menu.openBriefMarkdown')")).toBe(true);
        expect(viewSource.includes('void (options.hasCitation ? this.openActiveBriefForItem(options.item) : this.openActiveBrief());')).toBe(true);
    });

    it('starts Inquiry in a fresh launch mode instead of auto-rehydrating cached state', () => {
        const mainSource = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8');
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(mainSource.includes('public inquiryFreshLaunchPending = true;')).toBe(true);
        expect(mainSource.includes('public consumeInquiryFreshLaunchPending(): boolean')).toBe(true);
        expect(viewSource.includes('const freshLaunchPending = this.plugin.consumeInquiryFreshLaunchPending();')).toBe(true);
        expect(viewSource.includes("if (!this.state.isRunning) {\n            this.clearRehydrateState();\n            this.clearActiveResultState();\n            this.clearResultPreview();\n            this.unlockPromptPreview();\n            this.setApiStatus('idle');\n        }")).toBe(true);
        expect(viewSource.includes("this.startupFreshMode = freshLaunchPending || !this.state.isRunning;")).toBe(true);
        expect(viewSource.includes('this.loadTargetCache({ adoptPersistedSelection: !this.startupFreshMode });')).toBe(true);
        expect(viewSource.includes('if (this.startupFreshMode) {\n            return undefined;\n        }')).toBe(true);
    });

    it('keeps prior briefing markers visible even when corpus drift makes the run stale', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const fn = viewSource.match(/private computePromptCacheStates\(\):[\s\S]+?\n    private updateZonePrompts\(\): void/)?.[0] ?? '';
        expect(fn).toContain('Briefing history is not cache validity.');
        const priorIndex = fn.indexOf('priorIds.add(prompt.id);');
        const staleIndex = fn.indexOf('const diagnosis = this.diagnoseSessionStaleness(priorByBase);');
        expect(priorIndex).toBeGreaterThan(-1);
        expect(staleIndex).toBeGreaterThan(-1);
        expect(priorIndex).toBeLessThan(staleIndex);
        expect(fn).toContain('Corpus drift is still tracked for hover copy / briefing');
        expect(fn).toContain('staleIds.add(prompt.id);');
    });

    it('recovers cache countdown proof from persisted active cache sessions after a cold open', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const fn = viewSource.match(/private buildEngineRecentRunSnapshot\(\): EngineRecentRunSnapshot \| undefined[\s\S]+?\n    private getActualUsageCostForResult/)?.[0] ?? '';
        expect(fn).toContain('const persistedCacheSession = this.getLatestCacheSessionForResolvedEngine();');
        // The persisted-fallback branch still calls the pure helper, now
        // passing `cacheStatus` from session.providerCacheStatus.
        expect(fn).toContain('persistedCacheSession.result');
        expect(fn).toContain('buildEngineRecentRunSnapshotPure');
        expect(fn).toContain('cacheStatus');
        // Active-result branch runs before the persisted-fallback lookup
        // used to resolve cacheStatus. We now compute cacheStatus from
        // the same session lookup at the top so both branches can pass
        // it through.
        const cacheStatusLookupIndex = fn.indexOf('const cacheStatus = persistedCacheSession?.providerCacheStatus;');
        const activeBranchIndex = fn.indexOf('if (result && !this.isErrorResult(result))');
        expect(cacheStatusLookupIndex).toBeGreaterThan(-1);
        expect(activeBranchIndex).toBeGreaterThan(-1);
        expect(cacheStatusLookupIndex).toBeLessThan(activeBranchIndex);
    });

    it('uses a dated welcome label and suppresses persisted target focus until the user acts', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const enLocale = readFileSync(resolve(process.cwd(), 'src/i18n/locales/en.ts'), 'utf8');
        // Welcome label string lives in i18n catalog and is composed via t() at render time.
        expect(enLocale.includes('Welcome to Inquiry. {{weekday}} {{month}} {{day}}{{ordinal}}.')).toBe(true);
        expect(viewSource.includes("t('inquiry.nav.welcome'")).toBe(true);
        expect(viewSource.includes("this.setTextIfChanged(this.navSessionLabel, this.buildWelcomeNavLabel(), 'hudTextWrites');")).toBe(true);
        // Slice 2b: state.targetSceneIds write is routed through the
        // InquirySelectionState controller. The same visible-scenes
        // lookup feeds it.
        expect(viewSource.includes("this.selection.setTargetSceneIds(this.getVisibleTargetSceneIdsForBook(book.id));")).toBe(true);
        expect(viewSource.includes('...this.getVisibleTargetSceneIdsForBook(bookId),')).toBe(true);
    });

    it('uses a single plus for predicted multi-pass and lets CSS own the token-cap endcap fill', () => {
        const readinessSource = readFileSync(resolve(process.cwd(), 'src/inquiry/services/readiness.ts'), 'utf8');
        const minimapSource = readFileSync(resolve(process.cwd(), 'src/inquiry/minimap/InquiryMinimapRenderer.ts'), 'utf8');
        expect(readinessSource.includes("marks: '+'")).toBe(true);
        expect(readinessSource.includes('const visibleCount = 1;')).toBe(true);
        // Endcap fill is now driven by CSS (over-capacity / warning-capacity
        // classes + the [data-reuse-state] cache-armed rule). The renderer
        // must NOT set an inline `fill` on the endcaps — inline styles beat
        // class selectors and would freeze the endcap color regardless of
        // capacity / cache state. Renderer should explicitly remove any
        // previous inline fill so the CSS chain wins.
        expect(minimapSource.includes("this.minimapTokenCapStartCap?.style.removeProperty('fill');")).toBe(true);
        expect(minimapSource.includes("this.minimapTokenCapEndCap?.style.removeProperty('fill');")).toBe(true);
        expect(minimapSource.includes("this.minimapTokenCapStartCap?.style.setProperty('fill'")).toBe(false);
        expect(minimapSource.includes("this.minimapTokenCapEndCap?.style.setProperty('fill'")).toBe(false);
    });

    it('turns clear recent sessions into a full Inquiry reset and mutes the button once empty', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const cssSource = readFileSync(resolve(process.cwd(), 'src/styles/inquiry.css'), 'utf8');
        // Session count feeds the pure-function footer-state computer, which
        // emits clearInert. The view applies clearInert to the clear button.
        expect(viewSource.includes('sessionCount: this.sessionStore.getSessionCount(),')).toBe(true);
        expect(viewSource.includes("this.briefingClearButton.classList.toggle('is-inert', state.clearInert);")).toBe(true);
        expect(viewSource.includes('this.resetInquiryToFreshBaseState({ clearPersistedTargets: true });')).toBe(true);
        expect(viewSource.includes("this.refreshUI({ reason: 'recent sessions cleared' });")).toBe(true);
        // Slice 2b: the atomic clear payload moved into
        // InquirySelectionState.clearPersistedTargetCache. InquiryView
        // delegates and no longer constructs the payload inline.
        expect(viewSource.includes('this.selection.clearPersistedTargetCache();')).toBe(true);
        expect(viewSource.includes('this.startupFreshMode = true;')).toBe(true);
        expect(cssSource.includes('.ert-inquiry-briefing-clear.is-inert')).toBe(true);
    });

    it('returns to fresh glyph stubs when dismissing rehydrated results or errors', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('private dismissResults(): void {')).toBe(true);
        expect(viewSource.includes('private dismissError(): void {')).toBe(true);
        expect(viewSource.includes("this.startupFreshMode = true;\n        this.freshModeTouchedBookIds.clear();\n        this.refreshUI({ skipCorpus: true });")).toBe(true);
    });

    it('uses the canonical active book id for estimate snapshots and payload stats', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('const activeBookId = this.getCanonicalActiveBookId();')).toBe(true);
        expect(viewSource.includes('activeBookId,\n            targetSceneIds,')).toBe(true);
        expect(viewSource.includes('const activeBookId = this.getCanonicalActiveBookId();\n        if (!this.payloadStats')).toBe(true);
    });

    it('does not substitute corpus tokens for unavailable provider request estimates', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const snapshotSource = readFileSync(resolve(process.cwd(), 'src/inquiry/services/inquiryEstimateSnapshot.ts'), 'utf8');
        expect(snapshotSource.includes('const estimatedInputTokens = trace.tokenEstimate.inputTokens;')).toBe(true);
        expect(snapshotSource.includes('corpusFallbackTokens')).toBe(false);
        // requestMatches still requires the provider count to have produced a
        // positive number — no silent fallback to corpus/heuristic. The
        // expression is split across snapshotFresh + the positivity check so
        // the UI can surface "unavailable" honestly when the count fails.
        expect(viewSource.includes('const requestMatches = snapshotFresh && snapshot.estimate.estimatedInputTokens > 0')).toBe(true);
        expect(viewSource.includes('requestTokenFallback')).toBe(false);
        expect(viewSource.includes("estimateLabel = estimate\n                ? formatRunDurationEstimate(estimate.minSeconds, estimate.maxSeconds)\n                : 'unavailable'")).toBe(true);
    });

    it('keeps context reuse HUD tied to the current engine instead of hydrated result state', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('private getLatestCacheSessionForResolvedEngine(): InquirySession | null {')).toBe(true);
        // R1 chunk 3b: countdown label shaping moved to the pure module;
        // InquiryView delegates after the session lookup.
        expect(viewSource.includes('return formatContextCountdownLabelPure(session, Date.now());')).toBe(true);
        const statusSource = readFileSync(resolve(process.cwd(), 'src/inquiry/engine/inquiryCacheStatus.ts'), 'utf8');
        expect(statusSource.includes("return 'Cache expired';")).toBe(true);
        expect(viewSource.includes('scope: this.state.scope')).toBe(true);
        expect(viewSource.includes("const hasLiveContextCountdown = !this.state.isRunning && !!this.getActiveCacheWindowExpiry();")).toBe(true);
        expect(viewSource.includes('this.reconcileEngineTimerInterval(hasLiveContextCountdown);')).toBe(true);
    });

    it('self-heals stale pending-edits flags and aligns brief actions with writeback suggestions', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('const prior = session.pendingEditsEmpty;')).toBe(true);
        expect(viewSource.includes('if (session.key && prior !== pendingEditsEmpty) {')).toBe(true);
        expect(viewSource.includes('private buildBriefPendingActions(')).toBe(true);
        // R1 brief/dossier B4e: brief-model assembly moved to the pure
        // module; the wrapper passes pendingActions through the options
        // bag instead of materializing it as a local.
        expect(viewSource.includes('pendingActions: this.buildBriefPendingActions(result, items, referenceLabels),')).toBe(true);
    });

    it('prefers the strongest live warm-cache metrics over stale persisted reuse data (via pure picker)', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        // R1 chunk 3a: selection moved to the pure inquiryCacheStatus
        // module; InquiryView resolves both inputs (impure lookups) then
        // delegates. Behaviour (strongest warm wins, ties keep persisted)
        // is characterized by the module's own tests.
        expect(viewSource.includes('private getLiveReuseAdvancedContext(): AIRunAdvancedContext | null {')).toBe(true);
        expect(viewSource.includes('return pickEffectiveReuseAdvancedContextPure(persisted, live);')).toBe(true);
        // Old inline scoring/selection must be gone from InquiryView.
        expect(viewSource.includes('private scoreReuseAdvancedContext(context: AIRunAdvancedContext | null): number {')).toBe(false);
        expect(viewSource.includes('return this.scoreReuseAdvancedContext(live) > this.scoreReuseAdvancedContext(persisted)')).toBe(false);
        const statusSource = readFileSync(resolve(process.cwd(), 'src/inquiry/engine/inquiryCacheStatus.ts'), 'utf8');
        expect(statusSource.includes('export function pickEffectiveReuseAdvancedContext(')).toBe(true);
    });

    it('defines a visibly tinted cached-overlay hatch for the minimap token bar', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const cssSource = readFileSync(resolve(process.cwd(), 'src/styles/inquiry.css'), 'utf8');
        expect(viewSource.includes("hatchBg.classList.add('ert-inquiry-minimap-cached-hatch-bg');")).toBe(true);
        expect(viewSource.includes('hatchLineSecondary')).toBe(true);
        expect(cssSource.includes('.ert-inquiry-minimap-tokencap-cached')).toBe(true);
        expect(viewSource.includes("cachedPattern.setAttribute('id', 'ert-inquiry-minimap-cached-hatch');")).toBe(true);
        expect(cssSource.includes('fill: color-mix(in srgb, var(--ert-inquiry-ai-success) 92%, #dfffe7 8%);')).toBe(true);
    });

    it('repaints the minimap cache overlay when a persisted provider cache certificate appears', () => {
        const minimapSource = readFileSync(resolve(process.cwd(), 'src/inquiry/minimap/InquiryMinimapRenderer.ts'), 'utf8');
        expect(minimapSource.includes('private lastTokenCapFillRatio = 0;')).toBe(true);
        expect(minimapSource.includes('this.lastTokenCapFillRatio = fillRatio;')).toBe(true);
        expect(minimapSource.includes('this.updateTokenCapCachedOverlay(this.lastTokenCapFillRatio, advanced);')).toBe(true);
    });

    it('does not describe hard Inquiry failures as fallback results', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('Inquiry failed before results were produced.')).toBe(true);
        expect(viewSource.includes('Inquiry failed; fallback result returned.')).toBe(false);
    });

    it('renders the warm cache HUD countdown as a green flame icon plus timer text', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const domSource = readFileSync(resolve(process.cwd(), 'src/inquiry/dom/inquiryDomFactory.ts'), 'utf8');
        const cssSource = readFileSync(resolve(process.cwd(), 'src/styles/inquiry.css'), 'utf8');
        expect(viewSource.includes("'flame-kindling'")).toBe(true);
        // R1 chunk 3b: countdown text shaping lives in the pure module now.
        const statusSource = readFileSync(resolve(process.cwd(), 'src/inquiry/engine/inquiryCacheStatus.ts'), 'utf8');
        expect(statusSource.includes("return `${formatCacheCountdown(remainingMs)} remaining`;")).toBe(true);
        expect(domSource.includes("engineTimerIcon.setAttribute('href', '#ert-icon-flame-kindling');")).toBe(true);
        expect(domSource.includes("engineTimerIcon.setAttribute('width', '34');")).toBe(true);
        expect(cssSource.includes('font-size: 18px;')).toBe(true);
        expect(cssSource.includes('.ert-inquiry-engine-timer-icon.is-context-warm')).toBe(true);
    });

    it('spells briefing writeback targets from the computed pending-edits plan', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const textSource = readFileSync(resolve(process.cwd(), 'src/inquiry/utils/inquiryViewText.ts'), 'utf8');
        const rendererSource = readFileSync(resolve(process.cwd(), 'src/inquiry/briefing/inquiryBriefingRenderer.ts'), 'utf8');
        expect(viewSource.includes('private buildInquiryPendingEditsPlan(')).toBe(true);
        expect(viewSource.includes('pendingEditsTooltip')).toBe(true);
        // Pending-edits label spelling now lives in the canonical inquiryViewText module.
        expect(textSource.includes("return `Write to Pending Edits: ${labels.join(', ')}`;")).toBe(true);
        expect(textSource.includes("return `Pending Edits updated for ${labels.join(', ')}.`;")).toBe(true);
        expect(viewSource.includes("formatPendingEditsSuccessMessage(pendingPlan.targetLabels).replace(/\\.$/, '')")).toBe(true);
        expect(rendererSource.includes('pendingEditsTooltip?: string;')).toBe(true);
        expect(rendererSource.includes('const pendingLabel = args.pendingEditsTooltip ||')).toBe(true);
    });

    it('keeps scene-targeted pending edits on their resolved scene and preserves multiple notes per scene', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('if (filePath) {\n                addNote(filePath, note);\n                return;\n            }')).toBe(true);
        expect(viewSource.includes('const outlinePath = this.resolveInquiryOutlinePathForFinding(result, finding, activeBookId);')).toBe(true);
        expect(viewSource.includes('private resolveSagaOutlinePath(): string | null')).toBe(true);
        expect(viewSource.includes('const handledScenes = new Set<string>();')).toBe(false);
    });

    it('preserves saga book anchors through legacy result normalization', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes("if (scope === 'saga') {")).toBe(true);
        expect(viewSource.includes("/^book_[a-z0-9][a-z0-9_-]{1,80}$/i.test(trimmed)")).toBe(true);
        expect(viewSource.includes('book.sceneId?.toLowerCase() === lower')).toBe(true);
    });

    it('keeps saga book anchor mtimes stable so estimate fingerprints can settle', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('Book rows are Saga minimap anchors, not evidence-bearing files.')).toBe(true);
        expect(viewSource.includes('mtime: 0,\n                    class: \'book\'')).toBe(true);
    });

    it('keeps synthetic saga book anchors out of the visible corpus strip', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes("const referenceEntries = manifest.entries.filter(entry => entry.class !== 'scene' && entry.class !== 'outline' && entry.class !== 'book');")).toBe(true);
    });

    it('uses explicit OpenAI quota-exceeded copy for provider quota failures', () => {
        // Author-facing error copy now lives in the canonical inquiryViewText module.
        const textSource = readFileSync(resolve(process.cwd(), 'src/inquiry/utils/inquiryViewText.ts'), 'utf8');
        expect(textSource.includes("reason === 'quota_exceeded') return 'OpenAI API quota exceeded.'")).toBe(true);
        expect(textSource.includes('Your OpenAI API account has run out of quota, credits, or billing allowance.')).toBe(true);
        expect(textSource.includes('ChatGPT subscription quota is separate from API billing.')).toBe(true);
    });

    it('passes actual usage-based cost into the engine popover recent-run snapshot (via pure helper)', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        // R1 chunk 2: the snapshot + pricing logic moved to the pure
        // inquiryCacheStatus module; InquiryView delegates. Behaviour
        // (cost flows into the recent-run snapshot) is unchanged — the
        // pure module's own tests characterize actualCostUSD output.
        // The wrapper now also threads cacheStatus through (3-arg call)
        // so the cache pill can tell create-vs-reuse for Gemini.
        expect(viewSource.includes('buildEngineRecentRunSnapshotPure(')).toBe(true);
        expect(viewSource.includes('this.areInquiryProviderCitationsEnabled()')).toBe(true);
        expect(viewSource.includes('cacheStatus')).toBe(true);
        expect(viewSource.includes('return resolveActualUsageCostForResultPure(result, cacheProvenance);')).toBe(true);
        // The pricing call now lives in the pure module, not InquiryView.
        expect(viewSource.includes('estimateUsageCost(provider, modelId, result.tokenUsage)')).toBe(false);
        const statusSource = readFileSync(resolve(process.cwd(), 'src/inquiry/engine/inquiryCacheStatus.ts'), 'utf8');
        // Cost pricing threads cacheProvenance (a Gemini 'created' run is priced
        // at the input rate, not the cache-read discount) and the TTL the run
        // requested, so creation tokens with no per-TTL split are priced at
        // the rate actually asked for rather than a stand-in.
        expect(statusSource.includes('estimateUsageCost(provider, modelId, result.tokenUsage, cacheProvenance, ANTHROPIC_REQUESTED_CACHE_TTL)')).toBe(true);
        expect(statusSource.includes('actualCostUSD: resolveActualUsageCostForResult(result, cacheStatus)')).toBe(true);
    });

    it('uses same-material same-engine run cost for the preview cost pill before learned-output estimates', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('private getLatestPreviewQuestionActualCost(zone?: InquiryZone, questionId?: string): number | null')).toBe(true);
        expect(viewSource.includes('private getLatestSameCorpusActualCostForResolvedEngine(): number | null')).toBe(true);
        expect(viewSource.includes('this.getPreviewCostValue(zone, questionId)')).toBe(true);
        expect(viewSource.includes('const currentReuseFingerprint = currentContext.cacheReuseFingerprint.trim();')).toBe(true);
        expect(viewSource.includes("const sessionReuseFingerprint = (session.cacheReuseFingerprint || session.result.cacheReuseFingerprint || '').trim();")).toBe(true);
        expect(viewSource.includes('return `Prior cost · ${formatExactUsdCost(previewQuestionActualCost)}`;')).toBe(true);
        expect(viewSource.includes('return `Recent cost · ${formatExactUsdCost(sameCorpusActualCost)}`;')).toBe(true);
        // Estimate strings now carry a `${provenanceSuffix}` so the user
        // can distinguish provider-count-backed estimates from local
        // heuristic ones. See src/ai/estimates contract.
        expect(viewSource.includes('return `Cached est · ${cachedLabel}${provenanceSuffix}`;')).toBe(true);
        expect(viewSource.includes('`Fresh est · ${freshLabel} / ${cachedLabel} cached`')).toBe(true);
        expect(viewSource.includes('`Fresh est · ${freshLabel}`')).toBe(true);
        const questionCostIndex = viewSource.indexOf('const previewQuestionActualCost = this.getLatestPreviewQuestionActualCost(zone, questionId);');
        const sessionCostIndex = viewSource.indexOf('const sameCorpusActualCost = this.getLatestSameCorpusActualCostForResolvedEngine();');
        const outputProfileIndex = viewSource.indexOf('const learnedOutputTokens = this.plugin.getOutputProfileStore().predictExpectedOutput(');
        expect(questionCostIndex).toBeGreaterThan(-1);
        expect(sessionCostIndex).toBeGreaterThan(-1);
        expect(outputProfileIndex).toBeGreaterThan(-1);
        expect(questionCostIndex).toBeLessThan(sessionCostIndex);
        expect(sessionCostIndex).toBeLessThan(outputProfileIndex);
        expect(viewSource.includes('Cost · Run once for exact cost')).toBe(false);
    });

    it('preview cost path routes through the canonical TokenEstimate contract (no fabricated near-zero cost)', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const typesSrc = readFileSync(resolve(process.cwd(), 'src/inquiry/types.ts'), 'utf8');
        // Pin: getPreviewCostValue refuses to compute when the input
        // estimate is unavailable. Without this guard, the pricing math
        // runs against `estimatedInputTokens === 0` and fabricates a
        // near-zero cost that looks authoritative.
        expect(viewSource.includes('const inputEstimate = tokenEstimateFromMethod(')).toBe(true);
        // Pill text stays clean; failure detail is surfaced via the AI
        // Engine popover (getEngineFailureGuidance), not the pill.
        expect(viewSource.includes("'Cost · unavailable'")).toBe(true);
        // The engine guidance surfaces the actual provider error.
        expect(viewSource.includes('requestEstimateFailureMessage')).toBe(true);
        expect(viewSource.includes("from '../ai/estimates'")).toBe(true);
        // Pin: estimate strings disclose source provenance via
        // `${provenanceSuffix}` so local-heuristic-backed costs are not
        // confused with provider-count-backed ones.
        expect(viewSource.includes("const provenanceSuffix = inputEstimate.source === 'local_estimate' ? ' (local input)' : '';")).toBe(true);
        // Pin: the raw transport field is documented as unsafe for
        // direct UI gating — future code must read provenance first.
        expect(typesSrc.includes('Raw transport field — DO NOT gate UI labels on')).toBe(true);
    });

    it('forces the AI settings tab after Obsidian opens the plugin settings pane', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes("this.plugin.settingsTab.setActiveTab('ai');\n            }\n            const uniqueTargets")).toBe(true);
    });

    it('re-arms matching sessions for fresh pending-edits writeback after a purge', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const storeSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquirySessionStore.ts'), 'utf8');
        expect(viewSource.includes('this.sessionStore.clearPendingEditsAppliedFlags({')).toBe(true);
        expect(viewSource.includes("statuses: ['saved', 'unsaved']")).toBe(true);
        expect(viewSource.includes('Re-armed')).toBe(true);
        expect(storeSource.includes('clearPendingEditsAppliedFlags(options?: {')).toBe(true);
        expect(storeSource.includes("session.pendingEditsApplied = false;")).toBe(true);
    });

    it('keeps session history visible across Inquiry and Settings before debounced disk save', () => {
        const storeSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquirySessionStore.ts'), 'utf8');
        expect(storeSource.includes('getLatestSessionForEngineInScope(provider: string, modelId: string, scope: InquiryScope)')).toBe(true);
        expect(storeSource.includes('scope?: InquiryScope;')).toBe(true);
        expect(storeSource.includes('if (sessionScope !== options.scope) return false;')).toBe(true);
        expect(storeSource.includes('this.plugin.settings.inquirySessionCache = this.cache;\n        if (this.saveTimeout)')).toBe(true);
    });

    it('passes operational citation state into Inquiry estimates and provider runs', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const forecastSource = readFileSync(resolve(process.cwd(), 'src/ai/forecast/estimateTokensFromVault.ts'), 'utf8');
        expect(viewSource.includes("import { resolveCitationsEnabled } from '../ai/caps/computeCaps';")).toBe(true);
        expect(viewSource.includes('private areInquiryProviderCitationsEnabled(')).toBe(true);
        expect(viewSource.includes('citationsEnabled: this.areInquiryProviderCitationsEnabled(providerChoice.provider)')).toBe(true);
        expect(viewSource.includes('citationsEnabled: this.getCanonicalAiSettings().citationsEnabled !== false')).toBe(false);
        expect(forecastSource.includes("import { resolveCitationsEnabled } from '../caps/computeCaps';")).toBe(true);
        expect(forecastSource.includes("citationsEnabled: resolveCitationsEnabled(provider, 'inquiry'")).toBe(true);
    });

    it('self-heals stale applied writeback flags by checking current pending-edits markers before disabling the session action', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('const pendingEditsApplied = this.syncPendingEditsAppliedState(session, pendingPlan.notesByMaterial);')).toBe(true);
        expect(viewSource.includes('if (this.syncPendingEditsAppliedState(session)) {')).toBe(true);
        expect(viewSource.includes('private hasPendingEditsMarkerForSession(')).toBe(true);
        expect(viewSource.includes('normalizeInquiryLinkLine(line)')).toBe(true);
        expect(viewSource.includes("this.sessionStore.updateSession(session.key, { pendingEditsApplied: false });")).toBe(true);
    });

    it('routes timing prediction through inquiryTimingPrediction (provider usage, mode-keyed history, blended prediction)', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const timingSource = readFileSync(resolve(process.cwd(), 'src/inquiry/services/inquiryTimingPrediction.ts'), 'utf8');
        // Pure module is imported and used — no more inline EWMA math in InquiryView.
        expect(viewSource.includes("from './services/inquiryTimingPrediction'")).toBe(true);
        expect(viewSource.includes('computeSampleRate({')).toBe(true);
        expect(viewSource.includes('fallbackEstimate: result.tokenEstimateInput')).toBe(false);
        expect(timingSource.includes('fallbackEstimate')).toBe(false);
        expect(timingSource.includes('CACHE_POISON_THRESHOLD')).toBe(false);
        expect(viewSource.includes('blendSampleRate({')).toBe(true);
        expect(viewSource.includes('predictTimingFromEntry(entry, estimatedInputTokens)')).toBe(true);
        // Mode is part of the history key.
        expect(viewSource.includes('this.getCurrentEvidenceModeKey()')).toBe(true);
        expect(viewSource.includes('computeTimingHistoryKey(provider, model, mode)')).toBe(true);
        // The discredited preferLatestSample shortcut is gone for good.
        expect(viewSource.includes('const preferLatestSample = true;')).toBe(false);
        expect(viewSource.includes('options?: { preferLatestSample?: boolean }')).toBe(false);
        // The HUD still refreshes after a sample is recorded.
        expect(viewSource.includes('this.refreshEstimateDisplays();')).toBe(true);
        // Unrelated assertions from the original guardian — kept since they
        // still apply to the cached-cost label path. Estimate strings now
        // carry the canonical provenance suffix.
        expect(viewSource.includes('const nextRunCanReuseCache = !!cacheSession?.cacheWindowExpiresAt')).toBe(true);
        expect(viewSource.includes("return `Cached est · ${cachedLabel}${provenanceSuffix}`;")).toBe(true);
    });

    it('formats Inquiry engine cache TTL labels from canonical settings instead of hard-coding Gemini to 24h', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        const cacheWindowSource = readFileSync(resolve(process.cwd(), 'src/ai/settings/cacheWindows.ts'), 'utf8');
        expect(viewSource.includes("if (provider === 'google') return '24h';")).toBe(false);
        expect(viewSource.includes('const aiSettings = this.getCanonicalAiSettings();')).toBe(true);
        expect(viewSource.includes('formatProviderCacheTtlLabel(provider, aiSettings)')).toBe(true);
        expect(viewSource.includes('resolveProviderCacheWindowMs(provider, aiSettings)')).toBe(true);
        expect(cacheWindowSource.includes('export function formatProviderCacheTtlLabel')).toBe(true);
        expect(cacheWindowSource.includes('GEMINI_CACHE_TTL_MAX_SECONDS = 900')).toBe(true);
    });

    it('derives persisted cache coverage from actual usage and refreshes the HUD after estimate snapshots', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('private getObservedCacheMetrics(trace?: InquiryRunTrace | null):')).toBe(true);
        expect(viewSource.includes('usage.cacheReadInputTokens')).toBe(true);
        expect(viewSource.includes('const observedCacheMetrics = this.getObservedCacheMetrics(runTrace);')).toBe(true);
        expect(viewSource.includes('this.updateRunningHud();')).toBe(true);
    });

    it('stamps Anthropic dispatch fingerprints into the trace and compares them to the previous same-engine run', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes('private lastAnthropicDispatchPrefixByEngine = new Map<string, string>();')).toBe(true);
        expect(viewSource.includes('private appendAnthropicDispatchTraceNote(result: InquiryResult, trace: InquiryRunTrace | null | undefined): void {')).toBe(true);
        expect(viewSource.includes("private getAnthropicAcceptedCacheTtl(trace: InquiryRunTrace | null | undefined): '5m' | '1h' | 'mixed' | 'unknown' {")).toBe(true);
        expect(viewSource.includes("if (!trace.notes.includes(note)) {\n            trace.notes.unshift(note);\n        }")).toBe(true);
        expect(viewSource.includes('`requested=${diagnostics.requestedCacheTtl}`')).toBe(true);
        expect(viewSource.includes('`accepted=${acceptedCacheTtl}`')).toBe(true);
        expect(viewSource.includes('same-as-previous=')).toBe(true);
        expect(viewSource.includes('this.lastAnthropicDispatchPrefixByEngine.set(engineKey, diagnostics.cachePrefixFingerprint);')).toBe(true);
    });

    it('matches current corpus context against the estimate-snapshot manifest fingerprints instead of a separate current-corpus hash', () => {
        const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');
        expect(viewSource.includes("const manifest = this.buildCorpusManifest('estimate-snapshot');")).toBe(true);
        // Corpus content match uses the model-free fingerprint so the corpus
        // estimate stays valid across model switches.
        expect(viewSource.includes('snapshot.corpus.corpusOnlyFingerprint === manifest.corpusOnlyFingerprint')).toBe(true);
        // Request envelope match uses the full manifest fingerprint (model included).
        expect(viewSource.includes('snapshot.corpus.corpusFingerprint === manifest.fingerprint')).toBe(true);
        expect(viewSource.includes("this.hashString(`current-corpus|${fingerprintSource}`)")).toBe(false);
    });

});

describe('InquiryView hidden-leaf hero wrap recovery', () => {
    const viewSource = readFileSync(resolve(process.cwd(), 'src/inquiry/InquiryView.ts'), 'utf8');

    it('does not cache an SVG wrap result computed while the leaf is unmeasurable', () => {
        // getComputedTextLength() returns 0 on a hidden (display:none) leaf;
        // caching that one-line collapse freezes the bad wrap until the text
        // changes. The measurability probe gates the cache stamp.
        expect(viewSource.includes('private isSvgTextMeasurable(')).toBe(true);
        expect(viewSource.includes('const measurable = this.isSvgTextMeasurable(textEl, text);')).toBe(true);
        expect(viewSource.includes('if (measurable) {')).toBe(true);
        // Both wrap branches return through the single stamp helper — no raw
        // data-rt-wrap-cache writes remain in the wrap body.
        expect(viewSource.includes('return stampWrapCache(Math.max(balancedLines.length, 1));')).toBe(true);
        expect(viewSource.includes('return stampWrapCache(Math.max(truncated ? maxLines : lineIndex + 1, 1));')).toBe(true);
    });

    it('re-renders the active result hero when the view becomes active again', () => {
        expect(viewSource.includes("this.app.workspace.on('active-leaf-change'")).toBe(true);
        expect(viewSource.includes('this.app.workspace.getActiveViewOfType(InquiryView) !== this')).toBe(true);
        expect(viewSource.includes('this.showResultsPreview(this.state.activeResult);')).toBe(true);
    });
});
