/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { Notice } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { t } from '../i18n';
import { openSettingsTab } from '../utils/obsidianInternals';

/**
 * A beat dropped where its order forbids: say why, and offer Settings → Core →
 * Story beats, where the beat system's order and acts are changed.
 */
export function showBeatOrderNotice(plugin: RadialTimelinePlugin, message: string): void {
    const fragment = activeWindow.createFragment();
    fragment.createSpan({ text: message });
    fragment.createEl('br');
    const link = fragment.createEl('a', { text: t('ui.timetable.beatOrderSettings'), href: '#' });
    const notice = new Notice(fragment, 10000);
    link.addEventListener('click', event => {
        event.preventDefault();
        notice.hide();
        plugin.settingsTab?.setActiveTab('core');
        openSettingsTab(plugin.app);
        plugin.settingsTab?.revealSettingsSection('core', 'beats-story');
    });
}
