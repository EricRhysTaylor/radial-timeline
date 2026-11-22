/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * The Release scenes link from the Community website:
 *
 *   obsidian://radial-timeline-release?book=<Community book id>[&scene=<scene id>]
 *
 * Opens the Release scenes list for that book, or the preview for one scene.
 * The decisions are in communityShare/sceneReleaseLink.ts; this wires them to
 * Notices, Settings and the dialogs. Opening a link sends status reads only,
 * the same ones Settings → Community sends. Share scene body is never turned
 * on here, and the release terms are asked for exactly as the Release scenes
 * button asks.
 */

import { Notice, type ObsidianProtocolData } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { communityShareErrorText, fetchCommunityShareContext } from '../communityShare/communityShareClient';
import { normalizeCommunityShareSettings } from '../communityShare/communityShareSettings';
import {
    SCENE_RELEASE_PROTOCOL_ACTION,
    parseSceneReleaseLink,
    sceneReleaseLinkBook,
    sceneReleaseLinkGate,
    sceneReleaseLinkOpen,
    type SceneReleaseLink,
} from '../communityShare/sceneReleaseLink';
import { loadSceneReleaseList } from '../communityShare/sceneReleaseVault';
import { t } from '../i18n';
import { ensureReleaseTerms } from '../modals/SceneReleaseConsentModal';
import { SceneReleaseListModal } from '../modals/SceneReleaseListModal';
import { SceneReleasePreviewModal } from '../modals/SceneReleasePreviewModal';
import { COMMUNITY_PRIVATE_SCENES_SECTION_KEY } from '../settings/settingsAnchors';
import type { BookProfile } from '../types/settings';
import { openSettingsTab } from '../utils/obsidianInternals';

/** Settings → Community, scrolled to Private scenes. */
function openPrivateScenesSettings(plugin: RadialTimelinePlugin): void {
    const settingsTab = plugin.settingsTab;
    settingsTab?.setActiveTab('community');
    if (!openSettingsTab(plugin.app)) return;
    // The pane restores its last tab as it opens, so the tab is set again once it has.
    window.setTimeout(() => settingsTab?.revealSettingsSection('community', COMMUNITY_PRIVATE_SCENES_SECTION_KEY, { force: true }), 80);
}

/** Register the link once, on plugin load. */
export function registerSceneReleaseLink(plugin: RadialTimelinePlugin): void {
    let opening = false;
    plugin.registerObsidianProtocolHandler(SCENE_RELEASE_PROTOCOL_ACTION, (params: ObsidianProtocolData) => {
        // A second press while the first is still checking with the website opens nothing more.
        if (opening) return;
        opening = true;
        void openSceneReleaseLink(plugin, params).finally(() => { opening = false; });
    });
}

export async function openSceneReleaseLink(plugin: RadialTimelinePlugin, params: Readonly<Record<string, string | undefined>>): Promise<void> {
    const link = parseSceneReleaseLink(params);
    if (!link) {
        new Notice(t('ui.sceneReleaseLink.invalid'));
        return;
    }

    const gate = sceneReleaseLinkGate(normalizeCommunityShareSettings(plugin.settings.communityShare));
    if (gate.kind === 'notice') {
        new Notice(gate.text);
        return;
    }
    if (gate.kind === 'settings') {
        openPrivateScenesSettings(plugin);
        new Notice(gate.text);
        return;
    }

    let projects;
    try {
        projects = (await fetchCommunityShareContext(plugin)).projects;
    } catch (error) {
        new Notice(communityShareErrorText(error, t('ui.communityShareSection.sceneBodyStatusFailed')));
        return;
    }
    // The settings are read again: the author may have changed them while the website answered.
    const route = sceneReleaseLinkBook(
        normalizeCommunityShareSettings(plugin.settings.communityShare),
        plugin.settings.books ?? [], // SAFE: a vault with no Book Manager books holds no book the link can name
        projects,
        link
    );
    if (route.kind === 'notice') {
        new Notice(route.text);
        return;
    }
    if (route.kind === 'settings') {
        // Private scenes shows the active book: make the link's book the active one first.
        if (route.book && plugin.settings.activeBookId !== route.book.id) await plugin.setActiveBookId(route.book.id);
        openPrivateScenesSettings(plugin);
        new Notice(route.text);
        return;
    }
    if (route.kind === 'status') await openForBook(plugin, route.book, link);
}

async function openForBook(plugin: RadialTimelinePlugin, book: BookProfile, link: SceneReleaseLink): Promise<void> {
    let list;
    try {
        list = await loadSceneReleaseList(plugin, book);
    } catch (error) {
        new Notice(communityShareErrorText(error, t('ui.sceneReleaseModal.listFailed')));
        return;
    }
    const open = sceneReleaseLinkOpen(list.status, list.rows, link);
    if (open.kind === 'notice') {
        new Notice(open.text);
        return;
    }
    // The terms gate the Release scenes button runs.
    try {
        if (!await ensureReleaseTerms(plugin, book, list.status)) return;
    } catch (error) {
        new Notice(communityShareErrorText(error, t('ui.communityShareSection.sceneBodyStatusFailed')));
        return;
    }
    if (open.kind === 'preview') {
        new SceneReleasePreviewModal(plugin.app, { plugin, book, scene: open.scene, onDone: () => {} }).open();
        return;
    }
    new SceneReleaseListModal(plugin.app, plugin, book, () => {}, open.focusSceneId).open();
    if (open.notice) new Notice(open.notice);
}
