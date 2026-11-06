import type { RadialTimelineSettings } from '../types/settings';
import { computeCanonicalOrder } from '../utils/yamlTemplateNormalize';
import { withOptionalManagedKeys } from '../utils/optionalManagedKeys';
import type {
    SceneExpectedKeys,
    ScenePropertyDefinitions,
    ScenePropertyPolicy,
} from './types';

export function resolveScenePropertyPolicy(
    settings: RadialTimelineSettings
): ScenePropertyPolicy {
    return {
        advancedEnabled: settings.sceneAdvancedPropertiesEnabled ?? true,
    };
}

export function resolveSceneExpectedKeys(
    settings: RadialTimelineSettings,
    definitions: ScenePropertyDefinitions,
    policy: ScenePropertyPolicy
): SceneExpectedKeys {
    const coreKeys = definitions.core.map((definition) => definition.key);
    const advancedKeys = definitions.advanced.map((definition) => definition.key);
    const expectedKeys = policy.advancedEnabled
        ? [...coreKeys, ...advancedKeys]
        : [...coreKeys];
    // computeCanonicalOrder already splices optional-managed keys in; the
    // core-only branch bypasses it, so apply the same registry here or a scene
    // carrying a Part field would read as foreign to the reorder pass.
    const canonicalOrder = policy.advancedEnabled
        ? computeCanonicalOrder('Scene', settings)
        : withOptionalManagedKeys('Scene', ['ID', ...coreKeys.filter((key) => key.toLowerCase() !== 'id')]);

    return {
        coreKeys,
        advancedKeys,
        expectedKeys,
        canonicalOrder,
        toleratedInactiveKeys: policy.advancedEnabled ? [] : [...advancedKeys],
    };
}

export function splitSceneMissingKeys(
    missingKeys: string[],
    expected: SceneExpectedKeys,
    policy: ScenePropertyPolicy
): { missingCoreKeys: string[]; missingAdvancedKeys: string[] } {
    const coreKeySet = new Set(expected.coreKeys);
    const advancedKeySet = new Set(expected.advancedKeys);
    // Chapter is optional in maintenance context; only flagged in publishing/export readiness.
    const missingCoreKeys = missingKeys.filter((key) => coreKeySet.has(key) && key !== 'Chapter');
    const missingAdvancedKeys = policy.advancedEnabled
        ? missingKeys.filter((key) => advancedKeySet.has(key))
        : [];

    return { missingCoreKeys, missingAdvancedKeys };
}
