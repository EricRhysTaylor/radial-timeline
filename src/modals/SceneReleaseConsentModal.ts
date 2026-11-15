/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { App, ButtonComponent } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import { t } from '../i18n';

/**
 * The release terms, shown once before the first release (Amendment 2, section
 * 5). The five points match the website's wording: both record the same
 * consent, once per account. This dialog sends nothing; the caller records the
 * agreement only when it resolves true.
 */
class SceneReleaseConsentModal extends ErtModal {
    private resolved = false;

    constructor(app: App, private readonly onResolve: (agreed: boolean) => void) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.applyShell({ size: 'md' });
        this.mountHeader({
            badge: { text: t('ui.sceneReleaseModal.badge') },
            title: t('ui.sceneReleaseModal.consentTitle'),
        });

        const card = this.contentEl.createDiv({ cls: 'ert-glass-card ert-sub-card' });
        const points = card.createEl('ul');
        const terms = [
            t('ui.sceneReleaseModal.consentStored'),
            t('ui.sceneReleaseModal.consentReaders'),
            t('ui.sceneReleaseModal.consentRights'),
            t('ui.sceneReleaseModal.consentAgreements'),
            t('ui.sceneReleaseModal.consentRules'),
        ];
        for (const term of terms) points.createEl('li', { text: term });

        const actions = this.mountActions();
        new ButtonComponent(actions)
            .setButtonText(t('common.cancel'))
            .onClick(() => this.finish(false));
        new ButtonComponent(actions)
            .setButtonText(t('ui.sceneReleaseModal.consentAgree'))
            .setCta()
            .onClick(() => this.finish(true));
    }

    onClose(): void {
        // Escape or a click outside is a Cancel.
        if (!this.resolved) {
            this.resolved = true;
            this.onResolve(false);
        }
        this.contentEl.empty();
    }

    private finish(agreed: boolean): void {
        this.resolved = true;
        this.close();
        this.onResolve(agreed);
    }
}

/** Show the release terms. Resolves true only when the author presses I agree. */
export function confirmSceneReleaseTerms(app: App): Promise<boolean> {
    return new Promise(resolve => {
        new SceneReleaseConsentModal(app, resolve).open();
    });
}
