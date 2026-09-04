/*
 * Create Beat Set Modal - Confirmation dialog
 */
import { Modal, App, ButtonComponent } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { normalizeBeatSetNameInput } from '../utils/beatsInputNormalize';

export interface CreateBeatSetResult {
  confirmed: boolean;
}

export class CreateBeatSetModal extends Modal {
  private plugin: RadialTimelinePlugin;
  private beatSystem: string;
  private beatCount: number;
  private beatTemplate: string;
  private resolve: ((result: CreateBeatSetResult) => void) | null = null;

  constructor(app: App, plugin: RadialTimelinePlugin, beatSystem: string, beatCount: number, beatTemplate?: string) {
    super(app);
    this.plugin = plugin;
    this.beatSystem = normalizeBeatSetNameInput(beatSystem, beatSystem || 'Custom');

    this.beatCount = beatCount;
    this.beatTemplate = beatTemplate ?? '';
  }

  onOpen(): void {
    const { contentEl, modalEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText('');

    if (modalEl) {
      modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
      modalEl.setCssStyles({ width: '620px', maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
    }
    contentEl.addClass('ert-modal-container', 'ert-stack');
    contentEl.addClass('ert-create-plot-templates-modal');

    // Header
    const header = contentEl.createDiv({ cls: 'ert-modal-header' });
    header.createSpan({ cls: 'ert-modal-badge', text: 'Setup' });
    header.createDiv({ cls: 'ert-modal-title', text: 'Create beat set notes' });
    header.createDiv({ cls: 'ert-modal-subtitle', text: `This will create ${this.beatCount} beat notes for "${this.beatSystem}".` });

    // Info card with example
    const card = contentEl.createDiv({ cls: 'ert-glass-card' });

    card.createDiv({ cls: 'ert-sub-card-note', text: 'Each beat note will have the following property structure (shown in YAML format):' });

    // Build preview from the actual merged template (base + custom fields).
    // Substitute placeholders with human-readable sample values.
    let previewYaml = this.beatTemplate;
    if (!previewYaml.trim()) {
      previewYaml = `ID: [auto-generated]\nClass: Beat\nAct: 1\nPurpose: [Beat purpose]\nBeat Model: ${this.beatSystem}\nRange: [Ideal momentum range]`;
    } else {
      previewYaml = previewYaml
        .replace(/^Beat Id\s*:.*\n?/gim, '')
        .replace(/\{\{Act\}\}/g, '1')
        .replace(/\{\{Purpose\}\}/g, '[Beat purpose]')
        .replace(/\{\{Description\}\}/g, '[Beat purpose]')
        .replace(/\{\{BeatModel\}\}/g, this.beatSystem)
        .replace(/\{\{Range\}\}/g, '[Ideal momentum range]');
      if (!/^ID\s*:/im.test(previewYaml)) {
        previewYaml = `ID: [auto-generated]\n${previewYaml.trim()}`;
      }
    }

    const exampleCode = card.createEl('pre', { cls: 'ert-code-block' });
    exampleCode.textContent = `---\n${previewYaml}\n---`;

    const sourcePath = this.plugin.settings.sourcePath.trim();
    const locationText = sourcePath
      ? `Notes will be created in: ${sourcePath}/`
      : 'Notes will be created in the vault root (no book folder set)';

    card.createDiv({ cls: 'ert-sub-card-note', text: locationText });

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'ert-modal-actions' });

    new ButtonComponent(buttonContainer)
      .setButtonText(`Create ${this.beatCount} notes`)
      .setCta()
      .onClick(() => {
        if (this.resolve) {
          this.resolve({ confirmed: true });
        }
        this.close();
      });

    new ButtonComponent(buttonContainer)
      .setButtonText('Cancel')
      .onClick(() => {
        if (this.resolve) {
          this.resolve({ confirmed: false });
        }
        this.close();
      });
  }

  waitForConfirmation(): Promise<CreateBeatSetResult> {
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();

    // If modal is closed without decision, resolve with cancel
    if (this.resolve) {
      this.resolve({ confirmed: false });
    }
  }
}

/** @deprecated Use CreateBeatSetModal */
export const CreateBeatsTemplatesModal = CreateBeatSetModal;
