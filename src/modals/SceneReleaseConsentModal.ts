/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { App, ButtonComponent } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { acceptSceneReleaseTerms, commitCommunityShare, type SceneReleaseStatus } from '../communityShare/communityShareClient';
import { normalizeCommunityShareSettings } from '../communityShare/communityShareSettings';
import type { BookProfile } from '../types/settings';
import { ErtModal } from '../ui/ErtModal';
import { t } from '../i18n';
import { COMMUNITY_SITE_URL } from '../communityShare/communityMailbox';
import { COMMUNITY_GUIDELINES_PATH, SCENE_AUTHOR_AGREEMENT_VERSION, TERMS_OF_USE_URL } from '../communityShare/sceneAgreement';

/**
 * The release terms, shown once when the author first chooses Level 4 (contract
 * 2026-11-22; before, on the first release, Amendment 2, section 5). The seven
 * clauses match the website's wording: both record the same consent, once per
 * account. This dialog sends nothing; the caller records the agreement only
 * when it resolves true. Version 2026-11-22 (Decision "Scene text goes to
 * human review, not AI"): clause 5 says what a report is for and that a person
 * reviews it; clause 6 says when scene text goes to an AI provider.
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
            t('ui.sceneReleaseModal.consentReports'),
            t('ui.sceneReleaseModal.consentAi'),
            t('ui.sceneReleaseModal.consentAge'),
        ];
        // An ordered list, so a screen reader announces each clause's place;
        // the drawn numeral is decoration over the list's own numbering.
        const terms = this.contentEl.createEl('ol', { cls: 'ert-release-terms' });
        clauses.forEach((text, index) => {
            const clause = terms.createEl('li', { cls: 'ert-release-terms__clause' });
            clause.createSpan({ cls: 'ert-release-terms__number', text: String(index + 1), attr: { 'aria-hidden': 'true' } });
            clause.createEl('p', { cls: 'ert-release-terms__text', text });
        });
        // Clause 7 names the Terms of Use and the Guidelines; both are a click away.
        const links = this.contentEl.createDiv({ cls: 'ert-release-terms__links' });
        links.createEl('a', { text: t('ui.sceneReleaseModal.consentTermsOfUseLink'), href: TERMS_OF_USE_URL, attr: { target: '_blank', rel: 'noopener' } });
        links.createEl('a', { text: t('ui.sceneReleaseModal.consentGuidelinesLink'), href: `${COMMUNITY_SITE_URL}${COMMUNITY_GUIDELINES_PATH}`, attr: { target: '_blank', rel: 'noopener' } });
        links.createEl('a', { text: t('ui.communityShareSection.sceneBodyTermsLink'), href: `${COMMUNITY_SITE_URL}/agreements#private-scene-sharing`, attr: { target: '_blank', rel: 'noopener' } });
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

/**
 * Choosing Level 4: the release terms, once. Shown unless this vault already
 * holds the author's agreement to the current version; the agreement is kept
 * in the vault and recorded on the website with the first Send. Sends nothing.
 */
export async function agreeToSceneTextTerms(plugin: RadialTimelinePlugin): Promise<boolean> {
    const settings = normalizeCommunityShareSettings(plugin.settings.communityShare);
    if (settings.sceneTextTermsVersion === SCENE_AUTHOR_AGREEMENT_VERSION) return true;
    if (!await confirmSceneReleaseTerms(plugin.app)) return false;
    commitCommunityShare(plugin, live => ({ ...live, sceneTextTermsVersion: SCENE_AUTHOR_AGREEMENT_VERSION }));
    await plugin.saveSettings();
    return true;
}

/**
 * Before a Send: the website must hold the author's agreement. When it holds
 * none, the agreement given in this vault on choosing Level 4 is recorded;
 * without one, the terms are shown first. Resolves false when the author
 * cancels them.
 */
export async function ensureReleaseTerms(
    plugin: RadialTimelinePlugin,
    book: Pick<BookProfile, 'id'>,
    status: Pick<SceneReleaseStatus, 'consent'>
): Promise<boolean> {
    if (status.consent) return true;
    if (!await agreeToSceneTextTerms(plugin)) return false;
    await acceptSceneReleaseTerms(plugin, book);
    return true;
}
