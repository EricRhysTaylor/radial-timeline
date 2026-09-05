import type { App, TFile } from 'obsidian';
import type { HoverMetadataField, RadialTimelineSettings } from '../types/settings';
import type { YamlAuditResult } from '../utils/yamlAudit';
import type { FrontmatterSafetyResult } from '../utils/yamlSafety';
import type { FieldEntryValue } from '../utils/yamlTemplateNormalize';

export type ScenePropertySource = 'core' | 'advanced';

export interface ScenePropertyDefinition {
    key: string;
    defaultValue: FieldEntryValue;
    required: boolean;
    source: ScenePropertySource;
    revealInHover: boolean;
    hoverIcon?: string;
    hoverLabel?: string;
}

export interface ScenePropertyDefinitions {
    core: ScenePropertyDefinition[];
    advanced: ScenePropertyDefinition[];
}

export interface ScenePropertyPolicy {
    advancedEnabled: boolean;
}

export interface SceneExpectedKeys {
    coreKeys: string[];
    advancedKeys: string[];
    expectedKeys: string[];
    canonicalOrder: string[];
    toleratedInactiveKeys: string[];
}

export interface SceneNormalizationNote {
    file: TFile;
    missingCoreKeys: string[];
    missingAdvancedKeys: string[];
    toleratedInactiveAdvancedKeys: string[];
    extraKeys: string[];
    orderDrift: boolean;
    missingSceneId: boolean;
    duplicateSceneId?: string;
    semanticWarnings: string[];
    reason: string;
    safetyResult?: FrontmatterSafetyResult;
}

export interface SceneNormalizationSummary {
    totalScenes: number;
    unreadScenes: number;
    scenesWithMissingCore: number;
    scenesWithMissingAdvanced: number;
    scenesWithExtra: number;
    scenesWithDrift: number;
    scenesMissingIds: number;
    scenesDuplicateIds: number;
    scenesWithWarnings: number;
    clean: number;
    scenesUnsafe: number;
    scenesSuspicious: number;
}

export interface SceneNormalizationAudit {
    notes: SceneNormalizationNote[];
    unreadFiles: TFile[];
    summary: SceneNormalizationSummary;
    rawAudit: YamlAuditResult;
    safetyResults?: Map<TFile, FrontmatterSafetyResult>;
}

export interface SceneNormalizerContext {
    app: App;
    settings: RadialTimelineSettings;
    files?: TFile[];
    includeSafetyScan?: boolean;
    onProgress?: (current: number, total: number, filename: string) => void;
    abortSignal?: AbortSignal;
}

export interface SerializedAdvancedSceneProperties {
    advancedTemplate: string;
    hoverMetadataFields: HoverMetadataField[];
}
