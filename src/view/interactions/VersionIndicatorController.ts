/*
 * Radial Timeline Plugin for Obsidian — Version Indicator Controller
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import type { App } from 'obsidian';
import { getVersionCheckService } from '../../services/VersionCheckService';
import { CORE_ALERTS_SECTION_KEY, type RadialTimelineSettingsTabId } from '../../settings/settingsAnchors';
import { BugReportModal } from '../../modals/BugReportModal';
import type RadialTimelinePlugin from '../../main';

interface VersionIndicatorView {
    plugin: RadialTimelinePlugin & {
        app: App;
        settingsTab?: {
            setActiveTab: (tab: RadialTimelineSettingsTabId) => void;
            revealSettingsSection: (tab: RadialTimelineSettingsTabId, sectionKey: string) => void;
        };
    };
    renderScope: {
        register: (cb: () => void) => void;
        registerDomEvent: (el: HTMLElement, event: string, handler: (ev: Event) => void) => void;
    };
}

function openRadialTimelineCoreAlerts(view: VersionIndicatorView): void {
    const settingsTab = view.plugin.settingsTab;
    settingsTab?.revealSettingsSection('core', CORE_ALERTS_SECTION_KEY);

    const setting = (view.plugin.app as unknown as {
        setting?: {
            open: () => void;
            openTabById: (id: string) => void;
        };
    }).setting;
    setting?.open?.();
    setting?.openTabById?.('radial-timeline');

    window.setTimeout(() => {
        settingsTab?.revealSettingsSection('core', CORE_ALERTS_SECTION_KEY);
    }, 80);
}

/**
 * Setup click handlers for the version indicator
 * - Settings icon: Opens plugin settings (when settings alerts are active)
 * - Alert icon: Opens Obsidian's community plugins settings for updates
 * - Bug icon: Opens GitHub issues for bug reporting
 */
export function setupVersionIndicatorController(view: VersionIndicatorView, svg: SVGSVGElement): void {
    const versionIndicator = svg.querySelector('#version-indicator');
    if (!versionIndicator) return;

    const hitArea = versionIndicator.querySelector('.rt-version-hitarea');

    // Strip any lingering tooltip/title attributes so hover shows only text swap
    versionIndicator.querySelectorAll('[title]').forEach((el) => el.removeAttribute('title'));
    versionIndicator.querySelectorAll('[data-tooltip]').forEach((el) => el.removeAttribute('data-tooltip'));
    versionIndicator.querySelectorAll('.rt-tooltip-target').forEach((el) => el.classList.remove('rt-tooltip-target'));

    const handleClick = (ev: Event) => {
        ev.stopPropagation();
        
        // Check for settings alert mode (highest priority)
        if (versionIndicator.classList.contains('rt-has-settings-alert')) {
            openRadialTimelineCoreAlerts(view);
            return;
        }
        
        try {
            const versionService = getVersionCheckService();
            if (versionService.isUpdateAvailable()) {
                versionService.openUpdateSettings(view.plugin.app);
                return;
            }
        } catch {
            // Fall through to bug report.
        }
        new BugReportModal(view.plugin.app, view.plugin, 'rt').open();
    };

    // Prefer the unified hit area; fall back to the whole indicator group
    if (hitArea) {
        view.renderScope.registerDomEvent(hitArea as unknown as HTMLElement, 'click', handleClick);
    }
    view.renderScope.registerDomEvent(versionIndicator as unknown as HTMLElement, 'click', handleClick);
    
    // Set cursor to pointer for the entire indicator area
    versionIndicator.classList.add('ert-cursor-pointer');
}
