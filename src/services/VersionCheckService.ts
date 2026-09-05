/*
 * Radial Timeline Plugin for Obsidian — Version Check Service
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { openSettingsTab } from '../utils/obsidianInternals';
import type { App } from 'obsidian';
import { requestUrl } from 'obsidian';

/**
 * Service to check for plugin updates by comparing local manifest version
 * against the latest release on GitHub.
 */
export class VersionCheckService {
    private static readonly GITHUB_RELEASES_URL = 'https://api.github.com/repos/EricRhysTaylor/radial-timeline/releases/latest';
    private static readonly CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
    
    private currentVersion: string;
    private latestVersion: string | null = null;
    private lastCheckTime: number = 0;
    private updateAvailable: boolean = false;
    
    constructor(currentVersion: string) {
        this.currentVersion = currentVersion;
    }
    
    /**
     * Get the current plugin version from manifest
     */
    getCurrentVersion(): string {
        return this.currentVersion;
    }
    
    /**
     * Get the latest available version (if checked)
     */
    getLatestVersion(): string | null {
        return this.latestVersion;
    }
    
    /**
     * Check if an update is available
     */
    isUpdateAvailable(): boolean {
        return this.updateAvailable;
    }
    
    /**
     * Check for updates from GitHub releases
     * Returns true if a newer version is available
     */
    async checkForUpdates(force: boolean = false): Promise<boolean> {
        const now = Date.now();
        
        // Skip if checked recently (unless forced)
        if (!force && this.lastCheckTime > 0 && (now - this.lastCheckTime) < VersionCheckService.CHECK_INTERVAL_MS) {
            return this.updateAvailable;
        }
        
        try {
            const response = await requestUrl({
                url: VersionCheckService.GITHUB_RELEASES_URL,
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'Obsidian-Radial-Timeline-Plugin'
                }
            });
            
            if (response.status !== 200) {
                console.warn('[VersionCheck] Failed to fetch latest release:', response.status);
                return false;
            }
            
            const release: unknown = response.json;
            if (!release || typeof release !== 'object' || !('tag_name' in release)
                || typeof release.tag_name !== 'string') {
                throw new Error('Release response has no version tag.');
            }
            const tagName = release.tag_name;
            
            // Remove 'v' prefix if present
            this.latestVersion = tagName.startsWith('v') ? tagName.slice(1) : tagName;
            this.lastCheckTime = now;
            
            // Compare versions
            this.updateAvailable = this.isNewerVersion(this.latestVersion, this.currentVersion);
            
            if (this.updateAvailable) {
                // Update available; handled by caller
            }

            return this.updateAvailable;
        } catch (error) {
            console.warn('[VersionCheck] Error checking for updates:', error);
            return false;
        }
    }
    
    /**
     * Compare two semver versions
     * Returns true if version1 is newer than version2
     */
    private isNewerVersion(version1: string, version2: string): boolean {
        const v1Parts = version1.split('.').map(Number);
        const v2Parts = version2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
            const v1 = v1Parts[i] || 0;
            const v2 = v2Parts[i] || 0;
            
            if (v1 > v2) return true;
            if (v1 < v2) return false;
        }
        
        return false;
    }
    
    /**
     * Open Obsidian's community plugins update settings
     */
    openUpdateSettings(app: App): void {
        openSettingsTab(app, 'community-plugins');
    }
}

// Singleton instance holder
let versionCheckServiceInstance: VersionCheckService | null = null;

/**
 * Get or create the VersionCheckService singleton
 */
export function getVersionCheckService(currentVersion?: string): VersionCheckService {
    if (!versionCheckServiceInstance && currentVersion) {
        versionCheckServiceInstance = new VersionCheckService(currentVersion);
    }
    if (!versionCheckServiceInstance) {
        throw new Error('VersionCheckService not initialized');
    }
    return versionCheckServiceInstance;
}

/**
 * Initialize the version check service with the current version
 */
export function initVersionCheckService(currentVersion: string): VersionCheckService {
    versionCheckServiceInstance = new VersionCheckService(currentVersion);
    return versionCheckServiceInstance;
}

