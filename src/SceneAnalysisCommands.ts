/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
import RadialTimelinePlugin from './main';
import { Vault, Notice } from 'obsidian';
import { SceneAnalysisProcessingModal, type ProcessingMode } from './modals/SceneAnalysisProcessingModal';
import { normalizeBooleanValue } from './utils/sceneHelpers';
import {
    calculateSceneCount,
    getAllSceneData,
    getSubplotNamesFromFM,
    hasBeenProcessedForBeats,
    hasProcessableContent,
    getPulseUpdateFlag
} from './sceneAnalysis/data';
import {
    processWithModal,
    processSubplotWithModal,
    processEntireSubplotWithModalInternal
} from './sceneAnalysis/Processor';
import { t } from './i18n';

export { calculateSceneCount, calculateFlaggedCount, getDistinctSubplotNames } from './sceneAnalysis/data';
export { processBySubplotOrder } from './sceneAnalysis/Processor';
export {
    testYamlUpdateFormatting,
    purgeBeatsByManuscriptOrder,
    purgeBeatsBySubplotName
} from './sceneAnalysis/Maintenance';

export async function processByManuscriptOrder(
    plugin: RadialTimelinePlugin,
    vault: Vault
): Promise<void> {
    // Create modal with scene count calculator
    const modal = new SceneAnalysisProcessingModal(
        plugin.app,
        plugin,
        (mode: ProcessingMode) => calculateSceneCount(plugin, vault, mode),
        async (mode: ProcessingMode) => {
            // This is the actual processing logic
            await processWithModal(plugin, vault, mode, modal);
        },
        'radial-timeline:update-beats-manuscript-order' // pass command ID for resume functionality
    );
    
    modal.open();
}

export async function processEntireSubplotWithModal(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    subplotName: string,
    isResuming: boolean = false
): Promise<void> {
    // If there's already an active processing modal, just reopen it
    if (plugin.activeBeatsModal && plugin.activeBeatsModal.isProcessing) {
        plugin.activeBeatsModal.open();
        new Notice(t('sceneAnalysis.synopsis.notices.reopeningSession'));
        return;
    }

    // Create a function to get scene count for the entire subplot
    const getSceneCount = async (): Promise<number> => {
        try {
            const allScenes = await getAllSceneData(plugin, vault);
            const filtered = allScenes.filter(scene => getSubplotNamesFromFM(scene.frontmatter).includes(subplotName));
            // Count all scenes with processable content (not just flagged ones)
            const validScenes = filtered.filter(scene => hasProcessableContent(scene.frontmatter));
            
            if (isResuming) {
                // Resume: only count scenes NOT processed today
                const unprocessedToday = validScenes.filter(scene => 
                    !hasBeenProcessedForBeats(scene.frontmatter, { todayOnly: true })
                );
                return unprocessedToday.length;
            } else {
                // Initial: count all scenes (entire subplot processes everything)
                return validScenes.length;
            }
        } catch {
            return 0;
        }
    };

    // Pre-check: verify there are scenes to process BEFORE opening modal
    const sceneCount = await getSceneCount();
    if (sceneCount === 0) {
        const reason = isResuming
            ? t('sceneAnalysis.pipeline.notices.noRemainingResumingSubplot', { name: subplotName })
            : t('sceneAnalysis.pipeline.notices.noScenesContentSubplot', { name: subplotName });
        new Notice(reason);
        return;
    }

    // Create the modal with subplot-specific context
    const modal = new SceneAnalysisProcessingModal(
        plugin.app,
        plugin,
        getSceneCount,
        async () => {
            await processEntireSubplotWithModalInternal(plugin, vault, subplotName, modal);
        },
        undefined, // no resumeCommandId for subplot processing
        subplotName, // pass subplot name for resume functionality
        true // isEntireSubplot = true
    );

    // Override the modal's onOpen to skip confirmation and start processing immediately
    modal.onOpen = function() {
        // Show the modal first
        const { contentEl, titleEl, modalEl } = this;
        titleEl.setText('');
        
        // Set modal width to match manuscript order modal
        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '720px', maxWidth: '92vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-scene-analysis-modal');
        
        // Show progress view immediately (skip confirmation)
        this.showProgressView();
        
        // Start processing automatically
        this.isProcessing = true;
        this.abortController = new AbortController();
        
        // Notify plugin that processing has started
        plugin.activeBeatsModal = this;
        plugin.showBeatsStatusBar(0, 0);
        
        // Start the actual processing
        void (async () => {
            try {
                await processEntireSubplotWithModalInternal(plugin, vault, subplotName, modal);
                
                // Show appropriate summary
                if (this.abortController && this.abortController.signal.aborted) {
                    this.showCompletionSummary(t('sceneAnalysis.pipeline.notices.abortedRateLimit'));
                } else {
                    this.showCompletionSummary(this.resolveCompletionStatusMessage());
                }
            } catch (error) {
                if (!this.abortController.signal.aborted) {
                    this.addError(t('sceneAnalysis.pipeline.notices.fatalError', { error: error instanceof Error ? error.message : String(error) }));
                    this.showCompletionSummary(t('sceneAnalysis.processingModal.completion.stoppedDueToError'));
                } else {
                    this.showCompletionSummary(t('sceneAnalysis.pipeline.notices.abortedRateLimit'));
                }
            } finally {
                this.isProcessing = false;
                this.abortController = null;
                plugin.activeBeatsModal = null;
                plugin.hideBeatsStatusBar();
            }
        })();
    };
    
    modal.open();
}

// Internal processing function for entire subplot that works with the modal
export async function processBySubplotNameWithModal(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    subplotName: string
): Promise<void> {
    // If there's already an active processing modal, just reopen it
    if (plugin.activeBeatsModal && plugin.activeBeatsModal.isProcessing) {
        plugin.activeBeatsModal.open();
        new Notice(t('sceneAnalysis.synopsis.notices.reopeningSession'));
        return;
    }

    // Create a function to get scene count for the subplot
    const getSceneCount = async (): Promise<number> => {
        try {
            const allScenes = await getAllSceneData(plugin, vault);
            const filtered = allScenes.filter(scene => getSubplotNamesFromFM(scene.frontmatter).includes(subplotName));
            const validScenes = filtered.filter(scene => {
                const pulseUpdate = getPulseUpdateFlag(scene.frontmatter);
                return hasProcessableContent(scene.frontmatter) && normalizeBooleanValue(pulseUpdate);
            });
            return validScenes.length;
        } catch {
            return 0;
        }
    };

    // Pre-check: verify there are scenes to process BEFORE opening modal
    const sceneCount = await getSceneCount();
    if (sceneCount === 0) {
        new Notice(t('sceneAnalysis.pipeline.notices.noFlaggedPulseUpdateSubplot', { name: subplotName }));
        return;
    }

    // Create the modal with subplot-specific context
    const modal = new SceneAnalysisProcessingModal(
        plugin.app,
        plugin,
        getSceneCount,
        async () => {
            await processSubplotWithModal(plugin, vault, subplotName, modal);
        },
        undefined, // no resumeCommandId for subplot processing
        subplotName, // pass subplot name for resume functionality
        false // isEntireSubplot = false (flagged scenes only)
    );

    // Override the modal's onOpen to skip confirmation and start processing immediately
    modal.onOpen = function() {
        // Show the modal first
        const { contentEl, titleEl, modalEl } = this;
        titleEl.setText('');
        
        // Set modal width to match manuscript order modal
        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '720px', maxWidth: '92vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-scene-analysis-modal');
        
        // Show progress view immediately (skip confirmation)
        this.showProgressView();
        
        // Start processing automatically
        this.isProcessing = true;
        this.abortController = new AbortController();
        
        // Notify plugin that processing has started
        plugin.activeBeatsModal = this;
        plugin.showBeatsStatusBar(0, 0);
        
        // Start the actual processing
        void (async () => {
            try {
                await processSubplotWithModal(plugin, vault, subplotName, modal);
                
                // Show appropriate summary
                if (this.abortController && this.abortController.signal.aborted) {
                    this.showCompletionSummary(t('sceneAnalysis.pipeline.notices.abortedRateLimit'));
                } else {
                    this.showCompletionSummary(this.resolveCompletionStatusMessage());
                }
            } catch (error) {
                if (!this.abortController.signal.aborted) {
                    this.addError(t('sceneAnalysis.pipeline.notices.fatalError', { error: error instanceof Error ? error.message : String(error) }));
                    this.showCompletionSummary(t('sceneAnalysis.processingModal.completion.stoppedDueToError'));
                } else {
                    this.showCompletionSummary(t('sceneAnalysis.pipeline.notices.abortedRateLimit'));
                }
            } finally {
                this.isProcessing = false;
                this.abortController = null;
                plugin.activeBeatsModal = null;
                plugin.hideBeatsStatusBar();
            }
        })();
    };
    
    modal.open();
}
