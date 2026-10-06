import { beforeEach, describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../main';
import type { App } from 'obsidian';

const probes = vi.hoisted(() => ({
  preflight: vi.fn(async () => ({ ok: true, tier: 2, reason: '', modelId: 'local-model' })),
  cloud: vi.fn(async () => ({ ok: true, provider: 'anthropic', label: 'Anthropic' })),
  refresh: vi.fn(),
}));
vi.mock('../onboarding/OnboardingService', () => ({
  OnboardingService: class {
    preflight = probes.preflight;
    cloudAvailability = probes.cloud;
    detectImportFlow() { return null; }
    async ingest() { return { kind: 'ok', model: { chapters: [{ scenes: [{ rawText: 'A scene.', alreadyOnboarded: false }] }] } }; }
    setEngine() {}
  },
}));
vi.mock('../onboarding/promptSync', () => ({ refreshOnboardingPrompt: probes.refresh }));
vi.mock('../utils/books', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/books')>(),
  getActiveBook: () => ({ id: 'book', title: 'Book', sourceFolder: 'Book' }),
}));
vi.mock('../../tests/mocks/obsidian', async (importOriginal) => {
  const original = await importOriginal<typeof import('obsidian')>();
  class Control {
    selectEl = { setAttribute() {} };
    addOptions() { return this; }
    setValue() { return this; }
    then(callback: (control: Control) => void) { callback(this); return this; }
    onChange() { return this; }
    setButtonText() { return this; }
    setCta() { return this; }
    setDisabled() { return this; }
    onClick() { return this; }
  }
  return { ...original, DropdownComponent: Control, ButtonComponent: Control };
});
import { OnboardingModal } from './OnboardingModal';

function element(): object {
  return { empty() {}, createDiv: element, createSpan: element };
}
// SAFE: expose private lifecycle methods only to exercise the real Prepare logic with UI doubles.
type PrepareHarness = {
  useAi: boolean;
  aiAvailable: boolean;
  contentEl: object;
  showPreflight(): Promise<void>;
  renderBusy(): void;
  renderStageHeader(): void;
  renderStatusRow(): void;
};
function modal(): PrepareHarness {
  // SAFE: Prepare uses only the stubbed book/service and these settings; no live vault is accessed.
  const plugin = { settings: {} } as RadialTimelinePlugin;
  // SAFE: the Obsidian Modal mock does not use App; all rendering is replaced below.
  const harness = new OnboardingModal({} as App, plugin) as unknown as PrepareHarness;
  harness.contentEl = element();
  harness.renderBusy = vi.fn();
  harness.renderStageHeader = vi.fn();
  harness.renderStatusRow = vi.fn();
  return harness;
}
describe('onboarding AI opt-in', () => {
  beforeEach(() => vi.clearAllMocks());
  it('imports without probing AI or refreshing prompts even when providers are available', async () => {
    const harness = modal();
    await harness.showPreflight();
    expect(harness.useAi).toBe(false);
    expect(harness.aiAvailable).toBe(false);
    expect(probes.preflight).not.toHaveBeenCalled();
    expect(probes.cloud).not.toHaveBeenCalled();
    expect(probes.refresh).not.toHaveBeenCalled();
  });
  it('checks providers only after explicit opt-in and stops when structure-only is selected', async () => {
    const harness = modal();
    harness.useAi = true;
    await harness.showPreflight();
    expect(harness.aiAvailable).toBe(true);
    expect(probes.preflight).toHaveBeenCalledTimes(1);
    expect(probes.cloud).toHaveBeenCalledTimes(1);
    harness.useAi = false;
    await harness.showPreflight();
    expect(harness.aiAvailable).toBe(false);
    expect(probes.preflight).toHaveBeenCalledTimes(1);
    expect(probes.cloud).toHaveBeenCalledTimes(1);
    expect(probes.refresh).toHaveBeenCalledTimes(1);
  });
});
