/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Scene maintenance utilities (template creation, YAML test, purge helpers)
 */

import { extractBodyAfterFrontmatter } from '../utils/frontmatterDocument';
import { App, Notice, stringifyYaml, Modal, ButtonComponent, TFile, getFrontMatterInfo, parseYaml, type Vault } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { getAllSceneData, getSubplotNamesFromFM } from './data';
import type { SceneData, ParsedSceneAnalysis } from './types';
import { parsePulseAnalysisResponse } from './responseParsing';
import { snapshotFrontmatterFields } from '../utils/logVaultOps';
import { t } from '../i18n';

type FMInfo = {
    exists: boolean;
    frontmatter?: string;
    position?: { start?: { offset: number }, end?: { offset: number } };
};

const SCENE_ANALYSIS_SNAPSHOT_FIELDS = [
    '1beats',
    '2beats',
    '3beats',
    'previousSceneAnalysis',
    'currentSceneAnalysis',
    'nextSceneAnalysis',
    'Pulse Last Updated',
    'Beats Last Updated',
    'Pulse Review Warning',
    'PulseReviewWarning',
    'pulsereviewwarning'
];

async function updateSceneFile(
    vault: Vault,
    scene: SceneData,
    parsedAnalysis: ParsedSceneAnalysis,
    plugin: RadialTimelinePlugin,
    modelIdUsed: string | null
): Promise<boolean> {
    try {
        await snapshotFrontmatterFields(plugin.app, [scene.file], {
            operation: 'scene-analysis-refresh',
            fields: SCENE_ANALYSIS_SNAPSHOT_FIELDS,
            meta: {
                scope: 'scene-note',
                source: 'scene-analysis-maintenance',
                path: scene.file.path
            }
        });

        const toArray = (block: string): string[] => {
            return block
                .split('\n')
                .map(s => s.replace(/^\s*-\s*/, '').trim())
                .filter(Boolean);
        };

        await plugin.app.fileManager.processFrontMatter(scene.file, (fm) => {
            const fmObj = fm as Record<string, unknown>;
            delete fmObj['1beats'];
            delete fmObj['2beats'];
            delete fmObj['3beats'];

            const now = new Date();
            const timestamp = now.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            const updatedValue = `${timestamp}${modelIdUsed ? ` by ${modelIdUsed}` : ' by Unknown Model'}`;
            fmObj['Pulse Last Updated'] = updatedValue;

            const pulseKeys = [
                'Pulse Update',
                'PulseUpdate',
                'pulseupdate',
                'Beats Update',
                'BeatsUpdate',
                'beatsupdate',
                'Review Update',
                'ReviewUpdate',
                'reviewupdate'
            ];
            let updatedFlag = false;
            for (const key of pulseKeys) {
                if (Object.prototype.hasOwnProperty.call(fmObj, key)) {
                    fmObj[key] = false;
                    updatedFlag = true;
                }
            }
            if (!updatedFlag) {
                fmObj['Pulse Update'] = false;
            }

            const b1 = parsedAnalysis['previousSceneAnalysis']?.trim();
            const b2 = parsedAnalysis['currentSceneAnalysis']?.trim();
            const b3 = parsedAnalysis['nextSceneAnalysis']?.trim();

            if (b1) fmObj['previousSceneAnalysis'] = toArray(b1);
            if (b2) fmObj['currentSceneAnalysis'] = toArray(b2);
            if (b3) fmObj['nextSceneAnalysis'] = toArray(b3);
        });
        return true;
    } catch (error) {
        console.error(`[updateSceneFile] Error updating file:`, error);
        new Notice(t('sceneAnalysis.maintenance.saveError', { file: scene.file.basename }));
        return false;
    }
}

const DUMMY_API_RESPONSE = `previousSceneAnalysis:
 - 33.2 Protagonist Inner Turmoil - / Lacks clarity
 - Ally Hesitation ? / Uncertain decision
 - Mentor Reflection ? / Needs clearer link: should explore motive
 - Ally Plan + / Strengthens connection to currentSceneAnalysis choices
 - Meeting the Mentor + / Sets up tension
currentSceneAnalysis:
 - 33.5 B / Scene will be stronger by making the mentor's motivations clearer. Clarify: imminent threat
 - Mentor Reflections ? / Lacks tension link to events in previousSceneAnalysis
 - Ally Escape News + / Advances plot
 - Mentor Internal Conflict + / Highlights dilemma: how to handle the situation from previousSceneAnalysis
 - Connection to nextSceneAnalysis + / Sets up the coming conflict
nextSceneAnalysis:
 - 34 Routine Disruption - / Needs purpose
 - Mentor Unexpected Visit ? / Confusing motivation: clarify intention here
 - Sasha Defense and Defeat + / Builds on tension from currentSceneAnalysis
 - Ally Escape Decision + / Strong transition
 - Final Choice + / Resolves arc started in previousSceneAnalysis`;

export async function testYamlUpdateFormatting(
    plugin: RadialTimelinePlugin,
    vault: Vault
): Promise<void> {
    const dummyFilePath = 'AITestDummyScene.md';
    const dummyBody = 'This is the body text of the dummy scene.\nIt has multiple lines.';
    const dummyInitialFrontmatter = {
        Class: 'Scene',
        Synopsis: 'Dummy synopsis for testing YAML update.',
        Subplot: ['Test Arc'],
        When: '2024-01-01',
        Words: 10,
        'Pulse Update': 'Yes'
    };

    new Notice(t('sceneAnalysis.maintenance.yamlTest.starting', { file: dummyFilePath }));
    try {
        let file = vault.getAbstractFileByPath(dummyFilePath);
        if (!(file instanceof TFile)) {
            const initialContent = `---\n${stringifyYaml(dummyInitialFrontmatter)}---\n${dummyBody}`;
            await vault.create(dummyFilePath, initialContent);
            file = vault.getAbstractFileByPath(dummyFilePath);
        }

        if (!(file instanceof TFile)) {
            new Notice(t('sceneAnalysis.maintenance.yamlTest.errorTfile', { file: dummyFilePath }));
            return;
        }

        const currentContent = await vault.read(file);
        const fmInfo = getFrontMatterInfo(currentContent) as unknown as FMInfo;
        if (!fmInfo || !fmInfo.exists) {
            new Notice(t('sceneAnalysis.maintenance.yamlTest.errorMissingFm', { file: dummyFilePath }));
            return;
        }

        const fmText = fmInfo.frontmatter ?? '';
        const parsed: unknown = fmText ? parseYaml(fmText) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected YAML mapping.');
        const currentFrontmatter = parsed as Record<string, unknown>;
        const currentBody = extractBodyAfterFrontmatter(currentContent, fmInfo).trim();

        const dummySceneData: SceneData = {
            file,
            frontmatter: currentFrontmatter,
            sceneNumber: 999,
            body: currentBody
        };

        const parsedAnalysis = parsePulseAnalysisResponse(DUMMY_API_RESPONSE, plugin);
        if (!parsedAnalysis) {
            new Notice(t('sceneAnalysis.maintenance.yamlTest.errorParse'));
            return;
        }

        const success = await updateSceneFile(vault, dummySceneData, parsedAnalysis, plugin, null);
        if (success) {
            new Notice(t('sceneAnalysis.maintenance.yamlTest.success', { file: dummyFilePath }));
        } else {
            new Notice(t('sceneAnalysis.maintenance.yamlTest.failed', { file: dummyFilePath }));
        }
    } catch (error) {
        console.error('Error during YAML update test:', error);
        new Notice(t('sceneAnalysis.maintenance.yamlTest.errorGeneric'));
    }
}

class PurgeConfirmationModal extends Modal {
    constructor(
        app: App,
        private readonly message: string,
        private readonly details: string[],
        private readonly onConfirm: () => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl, modalEl, titleEl } = this;
        titleEl.setText('');
        contentEl.empty();

        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '820px', maxWidth: '92vw', maxHeight: '92vh' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack');
        contentEl.addClass('ert-purge-confirm-modal');

        const hero = contentEl.createDiv({ cls: 'ert-modal-header' });
        hero.createSpan({ text: t('sceneAnalysis.maintenance.purge.badgeWarning'), cls: 'ert-modal-badge' });
        hero.createDiv({ text: t('sceneAnalysis.maintenance.purge.title'), cls: 'ert-modal-title' });
        hero.createDiv({ text: t('sceneAnalysis.maintenance.purge.subtitle'), cls: 'ert-modal-subtitle' });

        const card = contentEl.createDiv({ cls: 'ert-glass-card ert-purge-confirm-card' });

        const messageEl = card.createDiv({ cls: 'ert-purge-message' });
        messageEl.setText(this.message);

        const detailsEl = card.createDiv({ cls: 'ert-purge-details' });
        detailsEl.createDiv({ text: t('sceneAnalysis.maintenance.purge.dangerHeader'), cls: 'ert-purge-danger' });
        const listEl = detailsEl.createEl('ul', { cls: 'ert-purge-list' });
        this.details.forEach(detail => {
            const li = listEl.createEl('li');
            // Render backtick-wrapped segments as inline code for clearer YAML key styling
            detail
                .split(/(`[^`]+`)/g)
                .filter(Boolean)
                .forEach(part => {
                    if (part.startsWith('`') && part.endsWith('`')) {
                        li.createEl('code', { text: part.slice(1, -1) });
                    } else {
                        li.appendText(part);
                    }
                });
        });

        const warningEl = card.createDiv({ cls: 'ert-purge-warning' });
        warningEl.setText(t('sceneAnalysis.maintenance.purge.areYouSure'));

        const buttonRow = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.maintenance.purge.buttonPurge'))
            .setDestructive()
            .onClick(() => {
                this.close();
                this.onConfirm();
            });

        new ButtonComponent(buttonRow)
            .setButtonText(t('sceneAnalysis.maintenance.purge.buttonCancel'))
            .onClick(() => this.close());
    }
}

async function purgeScenesBeats(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    scenes: SceneData[]
): Promise<{ purgedCount: number; snapshotPath: string | null }> {
    const snapshotPath = await snapshotFrontmatterFields(plugin.app, scenes.map(scene => scene.file), {
        operation: 'scene-analysis-purge',
        fields: SCENE_ANALYSIS_SNAPSHOT_FIELDS,
        meta: {
            scope: 'scene-note',
            sceneCount: scenes.length
        }
    });

    let purgedCount = 0;
    for (const scene of scenes) {
        try {
            await plugin.app.fileManager.processFrontMatter(scene.file, (fm) => {
                const fmObj = fm as Record<string, unknown>;
                const hadPrevious = fmObj['previousSceneAnalysis'] !== undefined;
                const hadCurrent = fmObj['currentSceneAnalysis'] !== undefined;
                const hadNext = fmObj['nextSceneAnalysis'] !== undefined;
                const hadTimestamp = fmObj['Pulse Last Updated'] !== undefined || fmObj['Beats Last Updated'] !== undefined;

                delete fmObj['previousSceneAnalysis'];
                delete fmObj['currentSceneAnalysis'];
                delete fmObj['nextSceneAnalysis'];
                delete fmObj['Pulse Last Updated'];
                delete fmObj['Beats Last Updated'];

                if (hadPrevious || hadCurrent || hadNext || hadTimestamp) {
                    purgedCount++;
                }
            });
        } catch (error) {
            console.error(`[purgeScenesBeats] Error purging beats from ${scene.file.path}:`, error);
        }
    }
    return { purgedCount, snapshotPath };
}

export async function purgeBeatsByManuscriptOrder(
    plugin: RadialTimelinePlugin,
    vault: Vault
): Promise<void> {
    try {
        const allScenes = await getAllSceneData(plugin, vault);
        if (allScenes.length === 0) {
            new Notice(t('sceneAnalysis.maintenance.purge.noScenes'));
            return;
        }

        const modal = new PurgeConfirmationModal(
            plugin.app,
            t('sceneAnalysis.maintenance.purge.confirmManuscript', { count: allScenes.length, plural: allScenes.length !== 1 ? 's' : '' }),
            [
                t('sceneAnalysis.maintenance.purge.detailFields'),
                t('sceneAnalysis.maintenance.purge.detailPulseUpdate')
            ],
            () => { void (async () => {
                const notice = new Notice(t('sceneAnalysis.maintenance.purge.noticeStart'), 0);
                const result = await purgeScenesBeats(plugin, vault, allScenes);

                notice.hide();
                await plugin.saveSettings();
                plugin.refreshTimelineIfNeeded(null);
                const parts = [t('sceneAnalysis.maintenance.purge.resultManuscript', { purged: result.purgedCount, total: allScenes.length, plural: allScenes.length !== 1 ? 's' : '' })];
                if (result.snapshotPath) {
                    parts.push(t('sceneAnalysis.maintenance.purge.archived', { path: result.snapshotPath }));
                }
                new Notice(parts.join(' '));
            })(); }
        );

        modal.open();
    } catch (error) {
        console.error('[purgeBeatsByManuscriptOrder] Error:', error);
        new Notice(t('sceneAnalysis.maintenance.purge.errorGeneric'));
    }
}

export async function purgeBeatsBySubplotName(
    plugin: RadialTimelinePlugin,
    vault: Vault,
    subplotName: string
): Promise<void> {
    try {
        const allScenes = await getAllSceneData(plugin, vault);
        const filtered = allScenes.filter(scene => getSubplotNamesFromFM(scene.frontmatter).includes(subplotName));

        if (filtered.length === 0) {
            new Notice(t('sceneAnalysis.pipeline.notices.noScenesForSubplot', { name: subplotName }));
            return;
        }

        const modal = new PurgeConfirmationModal(
            plugin.app,
            t('sceneAnalysis.maintenance.purge.confirmSubplot', { count: filtered.length, plural: filtered.length !== 1 ? 's' : '', name: subplotName }),
            [
                t('sceneAnalysis.maintenance.purge.detailFields'),
                t('sceneAnalysis.maintenance.purge.detailPulseLastUpdated')
            ],
            () => { void (async () => {
                const notice = new Notice(t('sceneAnalysis.maintenance.purge.noticeStartSubplot', { name: subplotName }), 0);
                const result = await purgeScenesBeats(plugin, vault, filtered);

                notice.hide();
                await plugin.saveSettings();
                plugin.refreshTimelineIfNeeded(null);
                const parts = [t('sceneAnalysis.maintenance.purge.resultSubplot', { purged: result.purgedCount, total: filtered.length, plural: filtered.length !== 1 ? 's' : '', name: subplotName })];
                if (result.snapshotPath) {
                    parts.push(t('sceneAnalysis.maintenance.purge.archived', { path: result.snapshotPath }));
                }
                new Notice(parts.join(' '));
            })(); }
        );

        modal.open();
    } catch (error) {
        console.error(`[purgeBeatsBySubplotName] Error purging subplot "${subplotName}":`, error);
        new Notice(t('sceneAnalysis.maintenance.purge.errorGeneric'));
    }
}
