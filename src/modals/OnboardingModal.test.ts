import { TooltipElement } from '../../tests/mocks/tooltipDom';
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
    async ingest() { return { kind: 'ok', model: { chapters: [{ scenes: [{ rawText: 'A scene.' }] }] } }; }
    setEngine() {}
  },
}));
vi.mock('../onboarding/promptSync', () => ({ refreshOnboardingPrompt: probes.refresh }));
vi.mock('../../tests/mocks/obsidian', async (importOriginal) => {
  const original = await importOriginal<typeof import('obsidian')>();
  class Control {
    selectEl = new TooltipElement();
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
vi.mock('../settings/FolderSuggest', () => ({ ModalFolderSuggest: class {} }));
vi.mock('./BookDesignerModal', () => ({ BookDesignerModal: class {} }));
import { OnboardingModal } from './OnboardingModal';

function element(): object {
  return { empty() {}, createDiv: element, createSpan: element };
}
// SAFE: expose private lifecycle methods only to exercise the real Prepare logic with UI doubles.
type PrepareHarness = {
  useAi: boolean;
  aiAvailable: boolean;
  plugin: { settings: object };
  book: { title: string; sourceFolder: string } | null;
  selectSourceFolder(folder: string): Promise<void>;
  contentEl: object;
  showPreflight(): Promise<void>;
  showExistingBook(folder: string, registered: object | null, sceneCount: number): void;
  renderBusy(): void;
  renderStageHeader(): void;
  renderStatusRow(): void;
};
/** A vault whose only notes are these scene notes (`Class: Scene`). */
function vault(scenePaths: string[] = []): App {
  // SAFE: source selection reads only these vault and metadata-cache methods.
  return {
    vault: { getFiles: () => scenePaths.map(path => ({ path, name: path.slice(path.lastIndexOf('/') + 1), extension: 'md' })) },
    metadataCache: { getFileCache: () => ({ frontmatter: { Class: 'Scene' } }) },
  } as unknown as App;
}
function modal(app: App = vault(), settings: object = {}): PrepareHarness {
  // SAFE: Prepare uses only the stubbed book/service and these settings; no live vault is accessed.
  const plugin = { settings } as RadialTimelinePlugin;
  // SAFE: the Obsidian Modal mock does not use App beyond the vault stub; all rendering is replaced below.
  const harness = new OnboardingModal(app, plugin) as unknown as PrepareHarness;
  harness.book = { title: 'Book', sourceFolder: 'Book' };
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
  it('uses the chosen export without registering a source book or changing settings', async () => {
    const harness = modal();
    harness.showPreflight = vi.fn(async () => undefined);
    await harness.selectSourceFolder('Imports/My Novel');
    expect(harness.book).toMatchObject({ title: 'My Novel', sourceFolder: 'Imports/My Novel' });
    expect(harness.showPreflight).toHaveBeenCalledTimes(1);
    expect(harness.plugin.settings).toEqual({});
    expect(harness.useAi).toBe(false);
  });
  it('adds a folder of scene notes as a book instead of importing it', async () => {
    const harness = modal(vault(['Saga/Book 4/01 Arrival.md', 'Saga/Book 4/02 Departure.md']));
    harness.showPreflight = vi.fn(async () => undefined);
    harness.showExistingBook = vi.fn();
    await harness.selectSourceFolder('Saga/Book 4');
    expect(harness.showExistingBook).toHaveBeenCalledWith('Saga/Book 4', null, 2, null);
    expect(harness.showPreflight).not.toHaveBeenCalled();
  });
  it('shows a folder Book Manager already has instead of importing it', async () => {
    const registered = { id: 'b1', title: 'Book One', sourceFolder: 'Saga/Book 1' };
    const harness = modal(vault(), { books: [registered] });
    harness.showPreflight = vi.fn(async () => undefined);
    harness.showExistingBook = vi.fn();
    await harness.selectSourceFolder('Saga/Book 1/Exports');
    expect(harness.showExistingBook).toHaveBeenCalledWith('Saga/Book 1/Exports', registered, 0, null);
    expect(harness.showPreflight).not.toHaveBeenCalled();
  });
  it('names the registered book inside a chosen parent folder, so it is never added as an overlapping book', async () => {
    const registered = { id: 'b1', title: 'Book One', sourceFolder: 'Saga/Book 1' };
    const harness = modal(vault(['Saga/Book 1/01 Opening.md', 'Saga/Intro.md']), { books: [registered] });
    harness.showPreflight = vi.fn(async () => undefined);
    harness.showExistingBook = vi.fn();
    await harness.selectSourceFolder('Saga');
    expect(harness.showExistingBook).toHaveBeenCalledWith('Saga', null, 2, registered);
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
