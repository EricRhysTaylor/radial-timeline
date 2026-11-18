/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { App, ButtonComponent } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import { t } from '../i18n';
import { COMMUNITY_SITE_URL } from '../communityShare/communityMailbox';
import { SCENE_AUTHOR_AGREEMENT_VERSION } from '../communityShare/sceneAgreement';

/**
 * The release terms, shown once before the first release (Amendment 2, section
 * 5). The five points match the website's wording: both record the same
 * consent, once per account. This dialog sends nothing; the caller records the
 * agreement only when it resolves true.
 *
 * Set as numbered clauses, each with room above and below, because this is an
 * agreement and should read as one (Eric, 2026-11-16). The same day he cut the
 * fifth clause back to what a report is and what it does: what follows a
 * take-down of a hidden scene is said where it happens, in the take-down
 * dialog, not here.
 */
class SceneReleaseConsentModal extends ErtModal {
    private resolved = false;

    constructor(app: App, private readonly onResolve: (agreed: boolean) => void) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.applyShell({ shellClasses: ['ert-modal--scene-release-consent'] });
        this.mountHeader({
            badge: { text: t('ui.sceneReleaseModal.badge') },
            title: t('ui.sceneReleaseModal.consentTitle'),
        });

        const clauses = [
            t('ui.sceneReleaseModal.consentStored'),
            t('ui.sceneReleaseModal.consentReaders'),
            t('ui.sceneReleaseModal.consentRights'),
            t('ui.sceneReleaseModal.consentAgreements'),
            t('ui.sceneReleaseModal.consentRules'),
        ];
        // An ordered list, so a screen reader announces each clause's place;
        // the drawn numeral is decoration over the list's own numbering.
        const terms = this.contentEl.createEl('ol', { cls: 'ert-release-terms' });
        clauses.forEach((text, index) => {
            const clause = terms.createEl('li', { cls: 'ert-release-terms__clause' });
            clause.createSpan({ cls: 'ert-release-terms__number', text: String(index + 1), attr: { 'aria-hidden': 'true' } });
            clause.createEl('p', { cls: 'ert-release-terms__text', text });
        });
        this.contentEl.createEl('a', { text: t('ui.communityShareSection.sceneBodyTermsLink'), href: `${COMMUNITY_SITE_URL}/agreements#private-scene-sharing`, attr: { target: '_blank', rel: 'noopener' } });
        this.contentEl.createDiv({ text: t('ui.communityShareSection.sceneBodyTermsVersion', { version: SCENE_AUTHOR_AGREEMENT_VERSION }) });

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
