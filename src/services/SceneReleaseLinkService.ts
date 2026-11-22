/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

/**
 * The Send scene link from the Community website:
 *
 *   obsidian://radial-timeline-release?book=<Community book id>&scene=<scene id>&request=<request id>
 *
 * Opens the Send scene to Community dialog for that request, or Settings →
 * Community at the book. The decisions are in communityShare/sceneReleaseLink.ts;
 * this wires them to Notices, Settings and the dialog. Opening a link sends
 * the status and requests reads only, the same ones Settings → Community sends.
 */

import { Notice, type ObsidianProtocolData } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { CommunityShareError, fetchCommunityShareContext } from '../communityShare/communityShareClient';
import { normalizeCommunityShareSettings } from '../communityShare/communityShareSettings';
import {
    SCENE_RELEASE_PROTOCOL_ACTION,
    parseSceneReleaseLink,
    sceneReleaseLinkBook,
    sceneReleaseLinkGate,
    sceneReleaseLinkOpen,
    type SceneReleaseLink,
} from '../communityShare/sceneReleaseLink';
import { loadSceneTextState } from '../communityShare/sceneReleaseVault';
import { t } from '../i18n';
import { forgetSceneTextState, openSceneTextRequest } from '../settings/sections/CommunitySceneTextBlock';
import { COMMUNITY_PRIVATE_SCENES_SECTION_KEY } from '../settings/settingsAnchors';
import type { BookProfile } from '../types/settings';
import { openSettingsTab } from '../utils/obsidianInternals';

function errorText(error: unknown, fallback: string): string {
    return error instanceof CommunityShareError ? error.message : fallback;
}

/** Settings → Community, scrolled to the active book's scene text. */
function openSceneTextSettings(plugin: RadialTimelinePlugin): void {
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
        openSceneTextSettings(plugin);
        new Notice(gate.text);
        return;
    }

    let projects;
    try {
        projects = (await fetchCommunityShareContext(plugin)).projects;
    } catch (error) {
        new Notice(errorText(error, t('ui.communityShareSection.sceneBodyStatusFailed')));
        return;
    }
    const route = sceneReleaseLinkBook(
        plugin.settings.books ?? [], // SAFE: a vault with no Book Manager books holds no book the link can name
        projects,
        link
    );
    if (route.kind === 'notice') {
        new Notice(route.text);
        return;
    }
    if (route.kind === 'settings') {
        // Settings shows the active book: make the link's book the active one first.
        if (route.book && plugin.settings.activeBookId !== route.book.id) await plugin.setActiveBookId(route.book.id);
        openSceneTextSettings(plugin);
        new Notice(route.text);
        return;
    }
    if (route.kind === 'status') await openForBook(plugin, route.book, link);
}

async function openForBook(plugin: RadialTimelinePlugin, book: BookProfile, link: SceneReleaseLink): Promise<void> {
    let state;
    try {
        state = await loadSceneTextState(plugin, book);
    } catch (error) {
        new Notice(errorText(error, t('ui.communityShareSection.sceneBodyStatusFailed')));
        return;
    }
    const open = sceneReleaseLinkOpen(state.status, state.requests, link);
    if (open.kind === 'notice') {
        new Notice(open.text);
        return;
    }
    if (open.kind === 'settings') {
        if (plugin.settings.activeBookId !== book.id) await plugin.setActiveBookId(book.id);
        openSceneTextSettings(plugin);
        if (open.notice) new Notice(open.notice);
        return;
    }
    openSceneTextRequest(plugin, book, state, open.request, forgetSceneTextState);
}
