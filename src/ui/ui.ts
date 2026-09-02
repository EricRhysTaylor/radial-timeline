import { ButtonComponent, DropdownComponent, ToggleComponent, TextComponent, SliderComponent, ColorComponent, setIcon } from 'obsidian';
import { ERT_CLASSES, ERT_CLASS_SET, ERT_DATA, type ErtVariant } from './classes';

type SectionOpts = { title?: string; desc?: string; variant?: ErtVariant | ErtVariant[]; icon?: (iconEl: HTMLElement) => void; actions?: (actionsEl: HTMLElement) => void };
type RowOpts = { label: string; desc?: string; variant?: ErtVariant };
type StackOpts = { label?: string; desc?: string; variant?: ErtVariant };
type InlineOpts = { variant?: ErtVariant };
type DividerOpts = { variant?: ErtVariant };

type TextInputOpts = { value?: string; placeholder?: string; onChange?: (value: string) => void };
type DropdownOpts = { options: Record<string, string>; value?: string; onChange?: (value: string) => void };
type ToggleOpts = { value?: boolean; onChange?: (value: boolean) => void };
type ButtonOpts = { text: string; onClick?: () => void; variant?: string; cta?: boolean };
type SliderOpts = { value?: number; min: number; max: number; step?: number; onChange?: (value: number) => void };
type ColorPickerOpts = { value?: string; onChange?: (value: string) => void; disabled?: boolean };
type ColorSwatchOpts = {
  value?: string;
  onChange?: (value: string) => void;
  ariaLabel?: string;
  /** Optional plugin reference for proper event lifecycle management via registerDomEvent */
  plugin?: { registerDomEvent: <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, callback: (ev: HTMLElementEventMap[K]) => void) => void };
  /** Additional CSS classes for the swatch button */
  swatchClass?: string;
};
type BadgePillOpts = { icon: string; label: string; variant?: ErtVariant | ErtVariant[]; size?: ErtVariant };

export type ColorSwatchHandle = {
  picker: ColorComponent;
  swatchEl: HTMLButtonElement;
  setValue: (value: string) => void;
  setDisabled: (disabled: boolean) => void;
};

const __ERT_DEV__ = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

const warnUnknownErtClasses = (clsTokens: (string | null | undefined)[], el: HTMLElement) => {
  if (!__ERT_DEV__) return;
  clsTokens
    .flatMap(token => (token ? token.split(/\s+/) : []))
    .filter(Boolean)
    .forEach(token => {
      if (token.startsWith('ert-') && !ERT_CLASS_SET.has(token)) {
        console.warn('[ERT] Unknown class', token, el);
      }
    });
};

const applyVariant = (el: HTMLElement, variant?: ErtVariant | ErtVariant[]) => {
  if (!variant) return;
  if (Array.isArray(variant)) {
    const tokens = variant.filter(Boolean) as string[];
    warnUnknownErtClasses(tokens, el);
    tokens.forEach(v => el.addClass(v));
  } else {
    const token = variant;
    warnUnknownErtClasses([token], el);
    el.addClass(token);
  }
};

export function mountRoot(parentEl: HTMLElement): HTMLElement {
  const root = parentEl.createDiv({ cls: ERT_CLASSES.ROOT });
  warnUnknownErtClasses([ERT_CLASSES.ROOT], root);
  return root;
}

export function section(parent: HTMLElement, opts: SectionOpts, buildFn?: (bodyEl: HTMLElement) => void): HTMLElement {
  const sectionEl = parent.createDiv({ cls: ERT_CLASSES.SECTION });
  warnUnknownErtClasses([ERT_CLASSES.SECTION], sectionEl);
  sectionEl.setAttribute(ERT_DATA.SECTION, 'true');
  applyVariant(sectionEl, opts.variant);

  if (opts.icon) {
    const iconSlot = sectionEl.createDiv({ cls: ERT_CLASSES.SECTION_ICON });
    warnUnknownErtClasses([ERT_CLASSES.SECTION_ICON], iconSlot);
    opts.icon(iconSlot);
  }

  if (opts.title) {
    sectionEl.createDiv({ cls: ERT_CLASSES.SECTION_TITLE, text: opts.title });
  }
  if (opts.desc) {
    sectionEl.createDiv({ cls: ERT_CLASSES.SECTION_DESC, text: opts.desc });
  }

  if (opts.actions) {
    const actionSlot = sectionEl.createDiv({ cls: ERT_CLASSES.SECTION_ACTIONS });
    warnUnknownErtClasses([ERT_CLASSES.SECTION_ACTIONS], actionSlot);
    opts.actions(actionSlot);
  }

  const bodyEl = sectionEl.createDiv({ cls: ERT_CLASSES.SECTION_BODY });
  warnUnknownErtClasses([ERT_CLASSES.SECTION_BODY], bodyEl);
  if (buildFn) buildFn(bodyEl);
  return bodyEl;
}

export function row(parent: HTMLElement, opts: RowOpts): HTMLElement {
  const rowEl = parent.createDiv({ cls: ERT_CLASSES.ROW });
  warnUnknownErtClasses([ERT_CLASSES.ROW], rowEl);
  rowEl.setAttribute(ERT_DATA.ROW, 'true');
  applyVariant(rowEl, opts.variant);

  const labelEl = rowEl.createDiv({ cls: ERT_CLASSES.LABEL });
  labelEl.setText(opts.label);

  if (opts.desc) {
    rowEl.createDiv({ cls: ERT_CLASSES.ROW_DESC, text: opts.desc });
  }

  const controlEl = rowEl.createDiv({ cls: ERT_CLASSES.CONTROL });
  warnUnknownErtClasses([ERT_CLASSES.CONTROL], controlEl);
  return controlEl;
}

export function stack(parent: HTMLElement, opts: StackOpts): HTMLElement {
  const stackEl = parent.createDiv({ cls: ERT_CLASSES.STACK });
  warnUnknownErtClasses([ERT_CLASSES.STACK], stackEl);
  stackEl.setAttribute(ERT_DATA.STACK, 'true');
  applyVariant(stackEl, opts.variant);

  if (opts.label) {
    const labelEl = stackEl.createDiv({ cls: ERT_CLASSES.LABEL });
    labelEl.setText(opts.label);
  }
  if (opts.desc) {
    stackEl.createDiv({ cls: ERT_CLASSES.ROW_DESC, text: opts.desc });
  }

  const controlEl = stackEl.createDiv({ cls: ERT_CLASSES.CONTROL });
  warnUnknownErtClasses([ERT_CLASSES.CONTROL], controlEl);
  return controlEl;
}

export function inline(parent: HTMLElement, opts: InlineOpts = {}): HTMLElement {
  const inlineEl = parent.createDiv({ cls: ERT_CLASSES.INLINE });
  warnUnknownErtClasses([ERT_CLASSES.INLINE], inlineEl);
  inlineEl.setAttribute(ERT_DATA.INLINE, 'true');
  applyVariant(inlineEl, opts.variant);
  return inlineEl;
}

export function divider(parent: HTMLElement, opts: DividerOpts = {}): HTMLElement {
  const dividerEl = parent.createDiv({ cls: ERT_CLASSES.DIVIDER });
  warnUnknownErtClasses([ERT_CLASSES.DIVIDER], dividerEl);
  applyVariant(dividerEl, opts.variant);
  return dividerEl;
}

export function heroLayout(parent: HTMLElement): { left: HTMLElement; right: HTMLElement } {
  const layout = parent.createDiv({ cls: ERT_CLASSES.HERO_LAYOUT });
  warnUnknownErtClasses([ERT_CLASSES.HERO_LAYOUT], layout);
  const left = layout.createDiv({ cls: ERT_CLASSES.HERO_LEFT });
  warnUnknownErtClasses([ERT_CLASSES.HERO_LEFT], left);
  const right = layout.createDiv({ cls: ERT_CLASSES.HERO_RIGHT });
  warnUnknownErtClasses([ERT_CLASSES.HERO_RIGHT], right);
  return { left, right };
}

export function textInput(slot: HTMLElement, opts: TextInputOpts = {}): TextComponent {
  const input = new TextComponent(slot);
  if (opts.placeholder) input.setPlaceholder(opts.placeholder);
  if (opts.value !== undefined) input.setValue(opts.value);
  if (opts.onChange) input.onChange(opts.onChange);
  return input;
}

export function dropdown(slot: HTMLElement, opts: DropdownOpts): DropdownComponent {
  const dropdownComponent = new DropdownComponent(slot);
  Object.entries(opts.options).forEach(([value, label]) => { dropdownComponent.addOption(value, label); });
  if (opts.value !== undefined) dropdownComponent.setValue(opts.value);
  if (opts.onChange) dropdownComponent.onChange(opts.onChange);
  return dropdownComponent;
}

export function toggle(slot: HTMLElement, opts: ToggleOpts): ToggleComponent {
  const toggleComponent = new ToggleComponent(slot);
  if (opts.value !== undefined) toggleComponent.setValue(opts.value);
  if (opts.onChange) toggleComponent.onChange(opts.onChange);
  return toggleComponent;
}

export function button(slot: HTMLElement, opts: ButtonOpts): ButtonComponent {
  const buttonComponent = new ButtonComponent(slot);
  buttonComponent.setButtonText(opts.text);
  if (opts.cta) buttonComponent.setCta();
  if (opts.variant) buttonComponent.buttonEl.addClass(opts.variant);
  if (opts.onClick) buttonComponent.onClick(opts.onClick);
  return buttonComponent;
}

export function slider(slot: HTMLElement, opts: SliderOpts): SliderComponent {
  const sliderComponent = new SliderComponent(slot);
  sliderComponent.setLimits(opts.min, opts.max, opts.step ?? 1);
  if (opts.value !== undefined) sliderComponent.setValue(opts.value);
  if (opts.onChange) sliderComponent.onChange(opts.onChange);
  return sliderComponent;
}

export function colorPicker(slot: HTMLElement, opts: ColorPickerOpts): ColorComponent {
  const colorComponent = new ColorComponent(slot);
  if (opts.value !== undefined) colorComponent.setValue(opts.value);
  if (opts.disabled) colorComponent.setDisabled(true);
  if (opts.onChange) colorComponent.onChange(opts.onChange);
  return colorComponent;
}

export function colorSwatch(slot: HTMLElement, opts: ColorSwatchOpts = {}): ColorSwatchHandle {
  // Add container class for position: relative (needed for the absolutely positioned hidden input)
  slot.classList.add(ERT_CLASSES.SWATCH_CONTAINER);

  const colorComponent = new ColorComponent(slot);
  if (opts.value !== undefined) colorComponent.setValue(opts.value);

  const inputEl = slot.querySelector<HTMLInputElement>('input[type="color"]:last-of-type');
  if (inputEl) {
    inputEl.classList.add(ERT_CLASSES.COLOR_INPUT_HIDDEN);
    warnUnknownErtClasses([ERT_CLASSES.COLOR_INPUT_HIDDEN], inputEl);
  }

  const swatchCls = opts.swatchClass
    ? `${ERT_CLASSES.SWATCH} ${opts.swatchClass}`
    : ERT_CLASSES.SWATCH;
  const swatchEl = slot.createEl('button', { cls: swatchCls });
  warnUnknownErtClasses([ERT_CLASSES.SWATCH], swatchEl);
  swatchEl.type = 'button';
  if (opts.ariaLabel) swatchEl.setAttribute('aria-label', opts.ariaLabel);

  let isSetting = false;
  const applyColor = (value?: string) => {
    if (!value) return;
    swatchEl.style.setProperty('--ert-swatch-color', value);
  };

  applyColor(opts.value);

  // Use plugin.registerDomEvent if available for proper lifecycle management
  const clickHandler = () => { inputEl?.click(); };
  if (opts.plugin) {
    opts.plugin.registerDomEvent(swatchEl, 'click', clickHandler);
  } else {
    // SAFE: Fallback for contexts without plugin reference; caller is responsible for cleanup
    swatchEl.addEventListener('click', clickHandler);
  }

  colorComponent.onChange((value) => {
    if (isSetting) return;
    applyColor(value);
    opts.onChange?.(value);
  });

  const setValue = (value: string) => {
    isSetting = true;
    colorComponent.setValue(value);
    applyColor(value);
    isSetting = false;
  };

  const setDisabled = (disabled: boolean) => {
    colorComponent.setDisabled(disabled);
    swatchEl.toggleAttribute('disabled', disabled);
  };

  return {
    picker: colorComponent,
    swatchEl,
    setValue,
    setDisabled
  };
}

export function badgePill(parent: HTMLElement, opts: BadgePillOpts): HTMLElement {
  const pill = parent.createDiv({ cls: ERT_CLASSES.BADGE_PILL });
  warnUnknownErtClasses([ERT_CLASSES.BADGE_PILL], pill);
  applyVariant(pill, opts.variant);
  applyVariant(pill, opts.size);

  const iconEl = pill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_ICON });
  warnUnknownErtClasses([ERT_CLASSES.BADGE_PILL_ICON], iconEl);
  setIcon(iconEl, opts.icon);

  const textEl = pill.createSpan({ cls: ERT_CLASSES.BADGE_PILL_TEXT, text: opts.label });
  warnUnknownErtClasses([ERT_CLASSES.BADGE_PILL_TEXT], textEl);

  return pill;
}
