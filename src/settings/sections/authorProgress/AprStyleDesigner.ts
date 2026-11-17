/**
 * Author Progress style designer: the colors, fonts, background and borders of
 * one saved style. It edits the style it is given directly, so every change is
 * saved as it is made and shows in every report drawn with that style.
 */
import { setTooltip, withAccessibleLabel } from '../../../utils/domTooltip';
import { CustomBgPresetModal } from '../../../modals/CustomBgPresetModal';
import { App, Setting, setIcon, DropdownComponent, TextComponent, Modal, ButtonComponent } from 'obsidian';
import type RadialTimelinePlugin from '../../../main';
import { AprStyleService } from '../../../services/apr/AprStyleService';
import type { AprStyleSettings } from '../../../types/settings';
import { AprPaletteModal } from '../../../modals/AprPaletteModal';
import { hasProFeatureAccess } from '../../featureGate';
import { colorSwatch, type ColorSwatchHandle } from '../../../ui/ui';
import { completeHexColor } from '../../../utils/colour';
import { bindHexTextInput } from '../../../ui/hexTextInput';
import { ERT_CLASSES } from '../../../ui/classes';
import { t } from '../../../i18n';
import { fitSelectToSelectedLabel } from '../../selectSizing';

export interface AprStyleDesignerProps {
    app: App;
    plugin: RadialTimelinePlugin;
    /** The saved style to edit. */
    profileId: string;
    /** Called after each saved change, so the open report can redraw its preview. */
    onStyleChange: () => void;
}

type StyleKey = keyof AprStyleSettings;

export function renderAprStyleDesigner(parent: HTMLElement, { app, plugin, profileId, onStyleChange }: AprStyleDesignerProps): void {
    const aprStyleService = new AprStyleService(plugin);
    const themeBody = parent.createDiv({ cls: 'ert-typography-stack' });

    const getActiveStyleSettings = (): AprStyleSettings =>
        aprStyleService.getProfiles().find(profile => profile.id === profileId)?.style ?? {}; // SAFE: a style deleted while its designer is still on screen reads as empty until the section redraws
    const styleSettings = getActiveStyleSettings();
    const currentBg = styleSettings.aprBackgroundColor || '#0d0d0f'; // SAFE: the shipped background color, shown when a style has none
    const currentTransparent = styleSettings.aprCenterTransparent ?? true; // SAFE: transparent is the shipped style's setting
    const currentTheme = styleSettings.aprTheme || 'dark'; // SAFE: the dark theme is the shipped style's theme
    const currentSpokeMode = styleSettings.aprSpokeColorMode || 'dark'; // SAFE: light borders ('dark' mode) are the shipped style's borders
    const currentSpokeColor = styleSettings.aprSpokeColor || '#ffffff'; // SAFE: white is the shipped custom border color

    // Color picker refs
    let bookTitleColorPickerRef: ColorSwatchHandle | undefined;
    let bookTitleTextRef: TextComponent | undefined;
    let authorColorPickerRef: ColorSwatchHandle | undefined;
    let authorTextRef: TextComponent | undefined;
    let percentNumberColorPickerRef: ColorSwatchHandle | undefined;
    let percentNumberTextRef: TextComponent | undefined;

    const paletteRow = themeBody.createDiv({ cls: `${ERT_CLASSES.INLINE} ert-apr-designer__palette` });
    const themeButton = paletteRow.createEl('button', { cls: 'ert-pillBtn ert-pillBtn--social' });
    themeButton.type = 'button';
    const themeIcon = themeButton.createSpan({ cls: 'ert-pillBtn__icon' });
    setIcon(themeIcon, 'swatch-book');
    themeButton.createSpan({ cls: 'ert-pillBtn__label', text: t('settings.authorProgress.styling.choosePaletteButton') });
    // SAFE: Settings sections are standalone functions without Component lifecycle; Obsidian manages settings tab cleanup
    themeButton.addEventListener('click', () => {
        const paletteSeedColor = bookTitleTextRef?.getValue().trim()
            || getActiveStyleSettings().aprBookAuthorColor
            || bookTitleColorFallback;
        const modal = new AprPaletteModal(
            app,
            (palette) => {
                void setAprSettings({
                    aprBookAuthorColor: palette.bookTitle,
                    aprAuthorColor: palette.authorName,
                    aprPercentNumberColor: palette.percentNumber,
                });
                bookTitleColorPickerRef?.setValue(palette.bookTitle);
                bookTitleTextRef?.setValue(palette.bookTitle);
                authorColorPickerRef?.setValue(palette.authorName);
                authorTextRef?.setValue(palette.authorName);
                percentNumberColorPickerRef?.setValue(palette.percentNumber);
                percentNumberTextRef?.setValue(palette.percentNumber);
            },
            paletteSeedColor
        );
        modal.open();
    });
    const bookTitleColorFallback = plugin.settings.publishStageColors.Press;

    // Font availability check — canvas measurement against monospace baseline
    const fontCheckCtx = parent.ownerDocument.win.createEl('canvas').getContext('2d') ?? null;
    const fontCheckSample = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let fontCheckBaseline: number | null = null;
    const isFontAvailable = (fontName: string): boolean => {
        if (!fontCheckCtx) return true;
        if (fontCheckBaseline === null) {
            fontCheckCtx.font = '16px monospace';
            fontCheckBaseline = fontCheckCtx.measureText(fontCheckSample).width;
        }
        fontCheckCtx.font = `16px "${fontName}", monospace`;
        return fontCheckCtx.measureText(fontCheckSample).width !== fontCheckBaseline;
    };

    // System font candidates — filtered at runtime to only show fonts the OS has loaded
    const ALL_FONT_CANDIDATES: Array<{ value: string; label: string; alwaysShow?: boolean }> = [
        { value: 'default', label: t('settings.authorProgress.styling.fontDefault'), alwaysShow: true },
        { value: 'system-ui', label: t('settings.authorProgress.styling.fontSystemUI'), alwaysShow: true },
        // Cross-platform system fonts
        { value: 'Arial', label: 'Arial' },
        { value: 'Verdana', label: 'Verdana' },
        { value: 'Georgia', label: 'Georgia' },
        { value: 'Times New Roman', label: 'Times New Roman' },
        { value: 'Trebuchet MS', label: 'Trebuchet MS' },
        { value: 'Tahoma', label: 'Tahoma' },
        // macOS system fonts
        { value: 'Avenir Next', label: 'Avenir Next' },
        { value: 'Futura', label: 'Futura' },
        { value: 'Gill Sans', label: 'Gill Sans' },
        { value: 'Baskerville', label: 'Baskerville' },
        { value: 'Didot', label: 'Didot' },
        { value: 'Optima', label: 'Optima' },
        { value: 'Palatino', label: 'Palatino' },
        // Windows system fonts
        { value: 'Segoe UI', label: 'Segoe UI' },
        { value: 'Calibri', label: 'Calibri' },
        { value: 'Cambria', label: 'Cambria' },
        { value: 'Candara', label: 'Candara' },
    ];

    const FONT_OPTIONS = ALL_FONT_CANDIDATES.filter(opt =>
        opt.alwaysShow || isFontAvailable(opt.value)
    );

    // Weight options with italic variants
    const WEIGHT_OPTIONS = [
        { value: '300', label: t('settings.authorProgress.styling.weightLight') },
        { value: '300-italic', label: t('settings.authorProgress.styling.weightLightItalic') },
        { value: '400', label: t('settings.authorProgress.styling.weightNormal') },
        { value: '400-italic', label: t('settings.authorProgress.styling.weightNormalItalic') },
        { value: '500', label: t('settings.authorProgress.styling.weightMedium') },
        { value: '500-italic', label: t('settings.authorProgress.styling.weightMediumItalic') },
        { value: '600', label: t('settings.authorProgress.styling.weightSemiBold') },
        { value: '600-italic', label: t('settings.authorProgress.styling.weightSemiBoldItalic') },
        { value: '700', label: t('settings.authorProgress.styling.weightBold') },
        { value: '700-italic', label: t('settings.authorProgress.styling.weightBoldItalic') },
        { value: '800', label: t('settings.authorProgress.styling.weightExtraBold') },
        { value: '800-italic', label: t('settings.authorProgress.styling.weightExtraBoldItalic') },
        { value: '900', label: t('settings.authorProgress.styling.weightBlack') },
        { value: '900-italic', label: t('settings.authorProgress.styling.weightBlackItalic') }
    ];

    const parseWeightValue = (val: string): { weight: number; italic: boolean } => {
        if (val.includes('-italic')) {
            return { weight: parseInt(val.split('-')[0], 10), italic: true };
        }
        return { weight: parseInt(val, 10), italic: false };
    };

    const formatWeightValue = (weight: number, italic: boolean): string => {
        return italic ? `${weight}-italic` : String(weight);
    };

    const numberFromText = (val: string): number | undefined => {
        const parsed = Number.parseFloat(val.trim());
        return Number.isFinite(parsed) ? parsed : undefined;
    };

    const setAprSettings = async (updates: Partial<AprStyleSettings>): Promise<void> => {
        aprStyleService.updateStyle(profileId, updates);
        await plugin.saveSettings();
        onStyleChange();
    };

    const setAprSetting = <K extends StyleKey>(key: K, value: AprStyleSettings[K] | undefined): Promise<void> =>
        setAprSettings({ [key]: value });

    const clearPercentNumberOverrides = (): void => {
        const currentStyle = getActiveStyleSettings();
        const hasOverrides = [
            currentStyle.aprPercentNumberFontSize1Digit,
            currentStyle.aprPercentNumberFontSize2Digit,
            currentStyle.aprPercentNumberFontSize3Digit
        ].some(value => value !== undefined && value !== null);
        if (!hasOverrides) return;
        void setAprSettings({
            aprPercentNumberFontSize1Digit: undefined,
            aprPercentNumberFontSize2Digit: undefined,
            aprPercentNumberFontSize3Digit: undefined
        });
    };

    clearPercentNumberOverrides();

    const applyFontDropdown = (
        drop: DropdownComponent,
        currentValue: string | undefined,
        onSave: (value: string) => Promise<void>
    ): { setValue: (value: string) => void } => {
        const customValue = '__custom__';
        let currentFont = currentValue || 'Inter'; // SAFE: Inter is the shipped font and the dropdown's Default option
        let isUpdating = false;
        const isCustomFont = (value: string): boolean => {
            const normalized = value.trim();
            const normalizedValue = normalized === 'Inter' ? 'default' : normalized;
            return !FONT_OPTIONS.some(opt => opt.value === normalizedValue) && normalizedValue !== 'default';
        };
        const doc = drop.selectEl.ownerDocument;
        const fontCanvas = doc.win.createEl('canvas');
        const fontContext = fontCanvas?.getContext('2d') ?? null;
        const fontSample = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const isFontLoaded = (value: string): boolean => {
            if (!isCustomFont(value)) return true;
            const trimmed = value.trim();
            if (!trimmed) return false;
            const fallback = 'monospace';
            if (!fontContext) return true;
            fontContext.font = `16px ${fallback}`;
            const baseline = fontContext.measureText(fontSample).width;
            fontContext.font = `16px "${trimmed}", ${fallback}`;
            const measured = fontContext.measureText(fontSample).width;
            const metricsMatch = measured === baseline;
            if (metricsMatch) return false;
            if (!('fonts' in doc)) return true;
            try {
                return doc.fonts.check(`16px "${trimmed}"`) || doc.fonts.check(`16px ${trimmed}`);
            } catch {
                return false;
            }
        };
        const updateWarningState = (value: string): void => {
            const normalized = value.trim();
            const showWarning = isCustomFont(normalized) && !isFontLoaded(normalized);
            drop.selectEl.classList.toggle('ert-typography-select--warning', showWarning);
            if (showWarning) {
                setTooltip(drop.selectEl, t('ui.authorProgressSection.fontNotLoaded', { font: normalized }));
            } else {
                setTooltip(drop.selectEl, '');
            }
        };

        const updateOptions = (value: string): void => {
            isUpdating = true;
            while (drop.selectEl.firstChild) {
                drop.selectEl.firstChild.remove();
            }
            FONT_OPTIONS.forEach(font => { drop.addOption(font.value, font.label); });
            const normalized = value === 'Inter' ? 'default' : value;
            const hasOption = FONT_OPTIONS.some(opt => opt.value === normalized);
            if (!hasOption) {
                drop.addOption(normalized, t('ui.authorProgressSection.customFontOption', { font: normalized }));
            }
            drop.addOption(customValue, t('settings.authorProgress.styling.customFontModal.customOption'));
            drop.setValue(normalized);
            updateWarningState(currentFont);
            isUpdating = false;
        };

        const openCustomModal = (): void => {
            const modal = new Modal(app);
            modal.modalEl.addClass('ert-typography-modal');
            modal.titleEl.setText(t('settings.authorProgress.styling.customFontModal.title'));
            modal.onClose = () => {
                updateOptions(currentFont);
            };

            const body = modal.contentEl.createDiv({ cls: 'ert-typography-modal__body' });
            body.createEl('p', { text: t('settings.authorProgress.styling.customFontModal.hint'), cls: 'ert-typography-modal__hint' });

            const input = new TextComponent(body);
            input.setPlaceholder(t('settings.authorProgress.styling.customFontModal.placeholder'));
            input.inputEl.addClass('ert-typography-modal__input');

            const normalized = currentFont === 'Inter' ? 'default' : currentFont;
            if (!FONT_OPTIONS.some(opt => opt.value === normalized)) {
                input.setValue(currentFont);
            }

            const actions = modal.contentEl.createDiv({ cls: 'ert-typography-modal__actions' });
            new ButtonComponent(actions)
                .setButtonText(t('settings.authorProgress.styling.customFontModal.save'))
                .setCta()
                .onClick(async () => {
                    const value = input.getValue().trim();
                    if (!value) {
                        input.inputEl.focus();
                        return;
                    }
                    await onSave(value);
                    currentFont = value;
                    updateOptions(currentFont);
                    modal.close();
                });

            new ButtonComponent(actions)
                .setButtonText(t('settings.authorProgress.styling.customFontModal.cancel'))
                .onClick(() => {
                    modal.close();
                });

            modal.open();
        };

        updateOptions(currentFont);

        drop.onChange(async (val) => {
            if (isUpdating) return;
            if (val === customValue) {
                openCustomModal();
                return;
            }
            const next = val === 'default' ? 'Inter' : val;
            if (next === currentFont) return;
            await onSave(next);
            currentFont = next;
            updateWarningState(currentFont);
        });

        const setValue = (value: string): void => {
            const next = value || 'Inter'; // SAFE: Inter is the shipped font and the dropdown's Default option
            currentFont = next;
            updateOptions(currentFont);
        };

        return { setValue };
    };

    type TypographyControlOptions = {
        familyKey: StyleKey;
        weightKey: StyleKey;
        italicKey: StyleKey;
        sizeKeys?: (StyleKey)[];
        sizePlaceholders?: string[];
        showSizeControls?: boolean;
        weightDefault: number;
        italicDefault?: boolean;
        fontDefault?: string;
    };

    type ElementBlockOptions = {
        label: string;
        desc: string;
        dataTypo: string;
        showAutoButton?: boolean;
        text?: {
            placeholder: string;
            value: string;
            onChange: (value: string) => Promise<void>;
        };
        primaryAction?: (rowEl: HTMLElement) => void;
        color?: {
            key: StyleKey;
            value: string;
            fallback: string;
            onAfterChange?: (value: string) => void;
            setPickerRef?: (picker: ColorSwatchHandle) => void;
            setTextRef?: (text: TextComponent) => void;
        };
        typography?: TypographyControlOptions;
    };

    const buildTypographyControls = (
        rowEl: HTMLElement,
        opts: TypographyControlOptions,
        onUpdateAutoState: () => void,
        isSyncing: () => boolean
    ): {
        setFontValue: (value: string) => void;
        setStyleValue: (weight: number, italic: boolean) => void;
        sizeInputs: TextComponent[];
    } => {
        const fontDrop = new DropdownComponent(rowEl);
        fontDrop.selectEl.addClass('ert-input', 'ert-typography-select');
        const currentStyle = getActiveStyleSettings() as Record<string, unknown>;
        const currentFont = (currentStyle[opts.familyKey] as string | undefined) ?? opts.fontDefault ?? 'Inter'; // SAFE: Inter is the shipped font and the dropdown's Default option
        const { setValue: setFontValue } = applyFontDropdown(fontDrop, currentFont, async (val) => {
            if (isSyncing()) return;
            await setAprSetting(opts.familyKey, val as AprStyleSettings[typeof opts.familyKey]);
            onUpdateAutoState();
        });

        const styleDrop = new DropdownComponent(rowEl);
        styleDrop.selectEl.addClass('ert-input', 'ert-typography-select');
        WEIGHT_OPTIONS.forEach(opt => { styleDrop.addOption(opt.value, opt.label); });
        const currentWeight = (currentStyle[opts.weightKey] as number | undefined) ?? opts.weightDefault;
        const currentItalic = (currentStyle[opts.italicKey] as boolean | undefined) ?? opts.italicDefault ?? false; // SAFE: upright is the shipped style for every text element
        let isStyleUpdating = false;
        styleDrop.setValue(formatWeightValue(currentWeight, currentItalic));
        styleDrop.onChange(async (val) => {
            if (isStyleUpdating || isSyncing()) return;
            const { weight, italic } = parseWeightValue(val);
            await setAprSettings({
                [opts.weightKey]: weight,
                [opts.italicKey]: italic
            });
            onUpdateAutoState();
        });

        const setStyleValue = (weight: number, italic: boolean): void => {
            isStyleUpdating = true;
            styleDrop.setValue(formatWeightValue(weight, italic));
            isStyleUpdating = false;
        };

        const sizeInputs: TextComponent[] = [];
        if (opts.sizeKeys?.length && opts.showSizeControls !== false) {
            const sizeGroup = rowEl.createDiv({ cls: 'ert-typography-size-group' });
            opts.sizeKeys.forEach((key, index) => {
                const input = new TextComponent(sizeGroup);
                input.setPlaceholder(opts.sizePlaceholders?.[index] ?? t('settings.authorProgress.styling.autoButton'));
                const currentValue = currentStyle[key] as number | undefined;
                input.setValue(currentValue !== undefined ? String(currentValue) : '');
                input.inputEl.addClass('ert-input');
                input.onChange(async (val) => {
                    if (isSyncing()) return;
                    const next = val.trim() ? numberFromText(val) : undefined;
                    if (val.trim() && next === undefined) return;
                    await setAprSetting(key, next as AprStyleSettings[typeof key]);
                    onUpdateAutoState();
                });
                sizeInputs.push(input);
            });
        }

        return { setFontValue, setStyleValue, sizeInputs };
    };

    const addElementBlock = (parent: HTMLElement, opts: ElementBlockOptions): void => {
        const block = new Setting(parent).setName(opts.label).setDesc(opts.desc);
        block.settingEl.addClass('ert-elementBlock', 'ert-settingRow');
        block.settingEl.dataset.ertTypo = opts.dataTypo;
        block.controlEl.addClass('ert-elementBlock__right');
        const infoEl = block.settingEl.querySelector('.setting-item-info');
        infoEl?.classList.add('ert-elementBlock__left');

        const controlGroup = block.controlEl.createDiv({ cls: 'ert-controlGroup' });
        const rowPrimary = (opts.text || opts.typography)
            ? controlGroup.createDiv({ cls: 'ert-typography-controls' })
            : null;
        const rowSecondary = controlGroup.createDiv({ cls: 'ert-typography-controls' });

        let isSyncing = false;
        const isSyncingCheck = () => isSyncing;

        let autoButton: HTMLButtonElement | null = null;

        const normalizeHex = (val: string): string => val.trim().toLowerCase();
        const defaultFont = opts.typography?.fontDefault ?? 'Inter'; // SAFE: Inter is the shipped font and the dropdown's Default option
        const defaultWeight = opts.typography?.weightDefault ?? 400; // SAFE: 400 is the shipped weight for text elements without their own
        const defaultItalic = opts.typography?.italicDefault ?? false; // SAFE: upright is the shipped style for every text element

        const updateAutoState = (): void => {
            const currentStyle = getActiveStyleSettings() as Record<string, unknown>;
            const colorAuto = (() => {
                if (!opts.color) return true;
                const currentColor = normalizeHex((currentStyle[opts.color.key] as string | undefined) ?? opts.color.fallback);
                const defaultColor = normalizeHex(opts.color.fallback);
                return currentColor === defaultColor;
            })();
            const typographyAuto = (() => {
                if (!opts.typography) return true;
                const currentFont = (currentStyle[opts.typography.familyKey] as string | undefined) ?? defaultFont;
                const currentWeight = (currentStyle[opts.typography.weightKey] as number | undefined) ?? defaultWeight;
                const currentItalic = (currentStyle[opts.typography.italicKey] as boolean | undefined) ?? defaultItalic;
                const isSizeAuto = opts.typography.sizeKeys?.length
                    ? opts.typography.sizeKeys.every(key => currentStyle[key] === undefined)
                    : true;
                return currentFont === defaultFont
                    && currentWeight === defaultWeight
                    && currentItalic === defaultItalic
                    && isSizeAuto;
            })();
            const isAuto = colorAuto && typographyAuto;
            if (autoButton) {
                autoButton.classList.toggle('is-active', isAuto);
            }
        };

        if (opts.text && rowPrimary) {
            const textConfig = opts.text;
            const textInput = new TextComponent(rowPrimary);
            textInput.setPlaceholder(textConfig.placeholder);
            textInput.setValue(textConfig.value);
            textInput.inputEl.addClass('ert-typography-text-input');
            textInput.inputEl.addClass('ert-input', 'ert-input--lg');
            textInput.onChange(async (val) => {
                if (isSyncing) return;
                await textConfig.onChange(val);
            });
        }

        let colorPicker: ColorSwatchHandle | null = null;
        let colorText: TextComponent | null = null;
        if (opts.color) {
            const colorConfig = opts.color;
            colorPicker = colorSwatch(rowSecondary, {
                value: colorConfig.value,
                ariaLabel: t('ui.authorProgressSection.elementColorAriaLabel', { label: opts.label }),
                plugin,
                onChange: (val) => { void (async () => {
                    if (isSyncing) return;
                    const next = val || colorConfig.fallback;
                    await setAprSetting(colorConfig.key, next as AprStyleSettings[typeof colorConfig.key]);
                    colorText?.setValue(next);
                    colorConfig.onAfterChange?.(next);
                    updateAutoState();
                })(); }
            });
            colorConfig.setPickerRef?.(colorPicker);

            colorText = new TextComponent(rowSecondary);
            colorConfig.setTextRef?.(colorText);
            colorText.inputEl.classList.add('ert-input', 'ert-input--hex');
            colorText.setPlaceholder(colorConfig.fallback).setValue(colorConfig.value);
            bindHexTextInput(colorText, async (hex) => {
                if (isSyncing) return;
                await setAprSetting(colorConfig.key, hex as AprStyleSettings[typeof colorConfig.key]);
                colorPicker?.setValue(hex);
                colorConfig.onAfterChange?.(hex);
                updateAutoState();
            });
        }

        opts.primaryAction?.(rowSecondary);

        if (opts.showAutoButton !== false) {
            autoButton = rowSecondary.createEl('button', { text: t('settings.authorProgress.styling.autoButton'), cls: 'ert-chip ert-typography-auto' });
            autoButton.type = 'button';
        }

        const typographyRefs = (opts.typography && rowPrimary)
            ? buildTypographyControls(rowPrimary, opts.typography, updateAutoState, isSyncingCheck)
            : null;

        // SAFE: Settings sections are standalone functions without Component lifecycle; Obsidian manages settings tab cleanup
        autoButton?.addEventListener('click', () => { void (async () => {
            const updates: Partial<AprStyleSettings> = {};
            if (opts.color) {
                (updates as Record<string, unknown>)[opts.color.key] = opts.color.fallback;
            }
            if (opts.typography) {
                Object.assign(updates, {
                    [opts.typography.familyKey]: defaultFont,
                    [opts.typography.weightKey]: defaultWeight,
                    [opts.typography.italicKey]: defaultItalic
                } as Partial<AprStyleSettings>);
                opts.typography.sizeKeys?.forEach((key) => {
                    updates[key] = undefined;
                });
            }
            await setAprSettings(updates);
            isSyncing = true;
            if (opts.color) {
                colorPicker?.setValue(opts.color.fallback);
                colorText?.setValue(opts.color.fallback);
            }
            if (typographyRefs) {
                typographyRefs.setFontValue(defaultFont);
                typographyRefs.setStyleValue(defaultWeight, defaultItalic);
                typographyRefs.sizeInputs.forEach(input => { input.setValue(''); });
            }
            opts.color?.onAfterChange?.(opts.color.fallback);
            isSyncing = false;
            updateAutoState();
        })(); });

        updateAutoState();
    };

    // ─────────────────────────────────────────────────────────────────────────
    // COLOR PALETTE + TITLE BLOCK
    // ─────────────────────────────────────────────────────────────────────────
    const currentBookTitleColorVal = styleSettings.aprBookAuthorColor || bookTitleColorFallback;

    // ─────────────────────────────────────────────────────────────────────────
    // ELEMENT BLOCKS (Title, Author, % Symbol, % Number, Stage Badge / RT Mark)
    // ─────────────────────────────────────────────────────────────────────────
    addElementBlock(themeBody, {
        label: t('settings.authorProgress.styling.title.label'),
        desc: t('settings.authorProgress.styling.title.desc'),
        dataTypo: 'title',
        color: {
            key: 'aprBookAuthorColor',
            value: currentBookTitleColorVal,
            fallback: bookTitleColorFallback,
            setPickerRef: (picker) => {
                bookTitleColorPickerRef = picker;
            },
            setTextRef: (text) => {
                bookTitleTextRef = text;
            }
        },
        typography: {
            familyKey: 'aprBookTitleFontFamily',
            weightKey: 'aprBookTitleFontWeight',
            italicKey: 'aprBookTitleFontItalic',
            sizeKeys: ['aprBookTitleFontSize'],
            sizePlaceholders: [t('settings.authorProgress.styling.autoButton')],
            showSizeControls: false,
            weightDefault: 400
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // AUTHOR
    // ─────────────────────────────────────────────────────────────────────────
    const authorColorFallback = styleSettings.aprBookAuthorColor || bookTitleColorFallback;
    const currentAuthorColor = styleSettings.aprAuthorColor || authorColorFallback;

    addElementBlock(themeBody, {
        label: t('settings.authorProgress.styling.author.label'),
        desc: t('settings.authorProgress.styling.author.desc'),
        dataTypo: 'author',
        text: {
            placeholder: t('settings.authorProgress.styling.author.placeholder'),
            // The author's name is shared by every report, not part of the style.
            value: plugin.settings.authorProgress?.defaults.authorName || '', // SAFE: an empty field shows the Author placeholder
            onChange: async (val) => {
                if (!plugin.settings.authorProgress) return;
                plugin.settings.authorProgress.defaults.authorName = val;
                await plugin.saveSettings();
                onStyleChange();
            }
        },
        color: {
            key: 'aprAuthorColor',
            value: currentAuthorColor,
            fallback: authorColorFallback,
            setPickerRef: (picker) => {
                authorColorPickerRef = picker;
            },
            setTextRef: (text) => {
                authorTextRef = text;
            }
        },
        typography: {
            familyKey: 'aprAuthorNameFontFamily',
            weightKey: 'aprAuthorNameFontWeight',
            italicKey: 'aprAuthorNameFontItalic',
            sizeKeys: ['aprAuthorNameFontSize'],
            sizePlaceholders: [t('settings.authorProgress.styling.autoButton')],
            showSizeControls: false,
            weightDefault: 400
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // % NUMBER
    // ─────────────────────────────────────────────────────────────────────────
    const percentNumberColorFallback = styleSettings.aprBookAuthorColor || bookTitleColorFallback;
    const currentPercentNumberColor = styleSettings.aprPercentNumberColor || percentNumberColorFallback;

    addElementBlock(themeBody, {
        label: t('settings.authorProgress.styling.percentNumber.label'),
        desc: t('settings.authorProgress.styling.percentNumber.desc'),
        dataTypo: 'percent-number',
        color: {
            key: 'aprPercentNumberColor',
            value: currentPercentNumberColor,
            fallback: percentNumberColorFallback,
            setPickerRef: (picker) => {
                percentNumberColorPickerRef = picker;
            },
            setTextRef: (text) => {
                percentNumberTextRef = text;
            }
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // STAGE / RT
    // ─────────────────────────────────────────────────────────────────────────
    addElementBlock(themeBody, {
        label: t('settings.authorProgress.styling.stageBadge.label'),
        desc: t('settings.authorProgress.styling.stageBadge.desc'),
        dataTypo: 'ert-badgePill',
        showAutoButton: false,
        typography: {
            familyKey: 'aprRtBadgeFontFamily',
            weightKey: 'aprRtBadgeFontWeight',
            italicKey: 'aprRtBadgeFontItalic',
            sizeKeys: ['aprRtBadgeFontSize'],
            sizePlaceholders: [t('settings.authorProgress.styling.autoButton')],
            showSizeControls: false,
            weightDefault: 700
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // BACKGROUND: transparent, or one solid color. Choosing a color turns
    // transparency off; choosing Transparent turns the color off.
    // ─────────────────────────────────────────────────────────────────────────
    const bgSetting = new Setting(themeBody)
        .setName(t('settings.authorProgress.styling.background.name'))
        .setDesc(t('settings.authorProgress.styling.background.desc'));
    bgSetting.settingEl.addClass('ert-elementBlock', 'ert-settingRow');

    let bgColorPicker: ColorSwatchHandle | null = null;
    let bgTextInput: TextComponent | null = null;
    // Assigned by the Borders setting (declared below). When background changes and the
    // border mode is 'sync', the border swatch needs to follow.
    let refreshBorderSwatchFromBg: (() => void) | null = null;

    const transparentBtn = bgSetting.controlEl.createEl('button', {
        cls: 'ert-chip ert-typography-auto',
        text: t('settings.authorProgress.styling.background.transparent'),
        attr: { type: 'button' }
    });
    const showTransparent = (isTransparent: boolean): void => {
        transparentBtn.toggleClass('is-active', isTransparent);
        transparentBtn.setAttr('aria-pressed', String(isTransparent));
        bgSetting.settingEl.toggleClass('is-transparent', isTransparent);
    };
    // SAFE: Settings sections are standalone functions without Component lifecycle; Obsidian manages settings tab cleanup
    transparentBtn.addEventListener('click', () => { void (async () => {
        await setAprSetting('aprCenterTransparent', true);
        showTransparent(true);
    })(); });

    /** Use a solid background color. */
    const setBackgroundColor = async (color: string): Promise<void> => {
        await setAprSettings({ aprBackgroundColor: color, aprCenterTransparent: false });
        showTransparent(false);
        bgColorPicker?.setValue(color);
        bgTextInput?.setValue(color);
        updateSourceLabel(color);
        refreshBorderSwatchFromBg?.();
    };

    // ── Source label ─────────────────────────────────────────────────────
    // Shows which preset (if any) matches the current background color.
    // Created early so onChange handlers below can reference it.
    const bgSourceLabel = bgSetting.controlEl.createDiv({ cls: 'ert-bg-source-label' });

    // Social media platform background presets
    // Dark-mode: actual card/feed background color per platform dark theme.
    // Light-mode: White is the most common light-mode feed bg.
    const platformPresets: Array<{ label: string; color: string }> = [
        // — Dark backgrounds —
        { label: 'X / Twitter', color: '#000000' },
        { label: 'Bluesky', color: '#161E27' },
        { label: 'Facebook', color: '#242526' },
        { label: 'Instagram', color: '#000000' },
        { label: 'LinkedIn', color: '#1B1F23' },
        { label: 'Threads', color: '#101010' },
        { label: 'Discord', color: '#313338' },
        { label: 'Kickstarter', color: '#0B3B2D' },
        { label: 'Patreon', color: '#141518' },
        { label: 'Substack', color: '#121212' },
        // — Light backgrounds —
        { label: t('ui.authorProgressSection.presetWhite'), color: '#FFFFFF' },
    ];

    // Custom presets (user-saved colors with custom names)
    const MAX_CUSTOM_PRESETS = 2;
    const getCustomPresets = (): Array<{ label: string; color: string }> => {
        return plugin.settings.authorProgress?.defaults.aprCustomBgPresets ?? []; // SAFE: no saved custom backgrounds yet
    };

    // Resolve which preset name matches a color (check built-in, then custom)
    const resolveSourceName = (hex: string): string | null => {
        const norm = hex.toUpperCase().trim();
        const builtIn = platformPresets.find(p => p.color.toUpperCase() === norm);
        if (builtIn) return builtIn.label;
        const custom = getCustomPresets().find(p => p.color.toUpperCase() === norm);
        if (custom) return custom.label;
        return null;
    };

    const updateSourceLabel = (hex: string) => {
        const name = resolveSourceName(hex);
        if (name) {
            bgSourceLabel.textContent = name;
            bgSourceLabel.classList.remove('is-hidden');
        } else {
            bgSourceLabel.textContent = '';
            bgSourceLabel.classList.add('is-hidden');
        }
    };

    const bgSwatch = colorSwatch(bgSetting.controlEl, {
        value: currentBg,
        ariaLabel: t('settings.authorProgress.styling.background.name'),
        plugin,
        onChange: (val) => { void setBackgroundColor(val || '#0d0d0f'); } // SAFE: clearing the swatch restores the shipped background color
    });
    bgColorPicker = bgSwatch;

    bgSetting.addText(text => {
        bgTextInput = text;
        text.setPlaceholder('#0d0d0f').setValue(currentBg);
        text.inputEl.classList.add('ert-input', 'ert-input--hex');
        bindHexTextInput(text, setBackgroundColor);
    });

    showTransparent(currentTransparent);
    updateSourceLabel(currentBg);

    // ── Platform preset pills ────────────────────────────────────────────
    const platformRow = themeBody.createDiv({ cls: 'ert-platform-presets' });
    platformRow.createSpan({ text: t('ui.authorProgressSection.platformBackgrounds'), cls: 'ert-platform-presets__label' });
    const platformSwatches = platformRow.createDiv({ cls: 'ert-platform-presets__swatches' });

    const applyPreset = setBackgroundColor;

    for (const preset of platformPresets) {
        const btn = withAccessibleLabel(platformSwatches.createEl('button', {
            cls: 'ert-platform-swatch',
            attr: { type: 'button' }
        }), `${preset.label} (${preset.color})`);
        btn.style.setProperty('--swatch-color', preset.color);
        btn.createSpan({ cls: 'ert-platform-swatch__color' });
        btn.createSpan({ cls: 'ert-platform-swatch__name', text: preset.label });
        btn.addEventListener('click', () => { void applyPreset(preset.color); });
    }

    // Separator between platform and custom presets
    platformSwatches.createSpan({ cls: 'ert-platform-presets__divider', text: '—' });

    // Keep custom pills as flex items so they wrap with the platform presets.
    const customSwatchButtons: HTMLButtonElement[] = [];

    const renderCustomPills = () => {
        customSwatchButtons.forEach(button => button.remove());
        customSwatchButtons.length = 0;
        const customs = getCustomPresets();

        for (let i = 0; i < MAX_CUSTOM_PRESETS; i++) {
            const saved = customs[i];
            const btn = withAccessibleLabel(platformSwatches.createEl('button', {
                cls: `ert-platform-swatch${saved ? '' : ' ert-platform-swatch--empty'}`,
                attr: { type: 'button' }
            }), saved ? `${saved.label} (${saved.color})` : t('ui.authorProgressSection.customSlotEmptyAriaLabel', { number: i + 1 }));

            customSwatchButtons.push(btn);

            if (saved) {
                btn.style.setProperty('--swatch-color', saved.color);
                btn.createSpan({ cls: 'ert-platform-swatch__color' });
                btn.createSpan({ cls: 'ert-platform-swatch__name', text: saved.label });

                // Click → apply the saved color
                btn.addEventListener('click', () => { void applyPreset(saved.color); });

                // Long-press / right-click → open editor to rename or delete
                btn.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    openCustomPresetModal(i, saved);
                });
            } else {
                const icon = btn.createSpan({ cls: 'ert-platform-swatch__icon' });
                setIcon(icon, 'plus');
                btn.createSpan({ cls: 'ert-platform-swatch__name', text: t('ui.authorProgressSection.customSlotName', { number: i + 1 }) });
                btn.addEventListener('click', () => openCustomPresetModal(i, null));
            }
        }
    };

    const openCustomPresetModal = (index: number, existing: { label: string; color: string } | null) => {
        const modal = new CustomBgPresetModal(app, {
            index,
            existing,
            currentBg: getActiveStyleSettings().aprBackgroundColor ?? '#0d0d0f', // SAFE: the shipped background color, shown when a style has none
            onSave: async (preset) => {
                if (!plugin.settings.authorProgress) return;
                const presets = [...getCustomPresets()];
                presets[index] = preset;
                plugin.settings.authorProgress.defaults.aprCustomBgPresets = presets;
                await plugin.saveSettings();
                renderCustomPills();
                void applyPreset(preset.color);
            },
            onDelete: async () => {
                if (!plugin.settings.authorProgress) return;
                const presets = [...getCustomPresets()];
                presets.splice(index, 1);
                plugin.settings.authorProgress.defaults.aprCustomBgPresets = presets;
                await plugin.saveSettings();
                renderCustomPills();
                updateSourceLabel(getActiveStyleSettings().aprBackgroundColor ?? '#0d0d0f'); // SAFE: the shipped background color, shown when a style has none
            }
        });
        modal.open();
    };

    renderCustomPills();

    const spokeColorSetting = new Setting(themeBody)
        .setName(t('settings.authorProgress.styling.spokesAndBorders.name'))
        .setDesc(t('settings.authorProgress.styling.spokesAndBorders.desc'));
    spokeColorSetting.settingEl.addClass('ert-elementBlock', 'ert-settingRow');
    spokeColorSetting.controlEl.addClass(ERT_CLASSES.INLINE);

    let spokeColorPickerRef: ColorSwatchHandle | undefined;
    let spokeColorInputRef: TextComponent | undefined;

    // The effective rendered border color depends on the spoke mode. Mirror resolveStructuralColors()
    // in AprRenderer.ts so the swatch + hex input always show what the renderer will actually draw.
    const effectiveBorderColor = (
        mode: 'dark' | 'light' | 'none' | 'sync' | 'custom',
        customColor: string,
        bgColor: string
    ): string => {
        if (mode === 'custom') return customColor;
        if (mode === 'sync') return bgColor;
        if (mode === 'light') return '#000000'; // "Dark Borders"
        if (mode === 'none') return 'transparent';
        return '#ffffff'; // 'dark' → "Light Borders"
    };

    const isCustomMode = currentSpokeMode === 'custom';
    const fallbackColor = '#ffffff';
    const initialEffective = effectiveBorderColor(currentSpokeMode, currentSpokeColor, currentBg);
    const spokeControlRow = spokeColorSetting.controlEl;
    const spokeColorPicker = colorSwatch(spokeControlRow, {
        value: initialEffective,
        ariaLabel: t('ui.authorProgressSection.spokeColorAriaLabel'),
        plugin,
        onChange: (val) => { void (async () => {
            const hex = completeHexColor(val);
            if (hex) {
                await setAprSetting('aprSpokeColor', hex as AprStyleSettings['aprSpokeColor']);
                spokeColorInputRef?.setValue(hex);
            }
        })(); }
    });
    spokeColorPickerRef = spokeColorPicker;
    spokeColorPicker.setDisabled(!isCustomMode);

    const spokeColorInput = new TextComponent(spokeControlRow);
    spokeColorInputRef = spokeColorInput;
    spokeColorInput.inputEl.classList.add('ert-input', 'ert-input--hex');
    spokeColorInput.setPlaceholder(fallbackColor).setValue(initialEffective);
    spokeColorInput.setDisabled(!isCustomMode);
    bindHexTextInput(spokeColorInput, async (hex) => {
        await setAprSetting('aprSpokeColor', hex as AprStyleSettings['aprSpokeColor']);
        spokeColorPickerRef?.setValue(hex);
    });

    // Exposed so the background-color controls can keep the border swatch in sync when mode is 'sync'.
    refreshBorderSwatchFromBg = () => {
        const style = getActiveStyleSettings();
        const mode = (style.aprSpokeColorMode ?? 'dark'); // SAFE: light borders ('dark' mode) are the shipped style's borders
        if (mode !== 'sync') return;
        const eff = effectiveBorderColor(mode, style.aprSpokeColor ?? fallbackColor, style.aprBackgroundColor ?? currentBg);
        spokeColorPickerRef?.setValue(eff);
        spokeColorInputRef?.setValue(eff);
    };

    const spokeModeDropdown = new DropdownComponent(spokeControlRow);
    spokeModeDropdown.addOption('dark', t('settings.authorProgress.styling.strokeLightStrokes'));
    spokeModeDropdown.addOption('light', t('settings.authorProgress.styling.strokeDarkStrokes'));
    spokeModeDropdown.addOption('none', t('settings.authorProgress.styling.strokeNoStrokes'));
    spokeModeDropdown.addOption('sync', t('settings.authorProgress.styling.strokeSyncBackground'));
    spokeModeDropdown.addOption('custom', t('settings.authorProgress.styling.strokeCustomColor'));
    spokeModeDropdown.selectEl.addClass('ert-input', 'ert-input--fit-selected');
    const currentValue = currentSpokeMode !== 'dark' ? currentSpokeMode : (currentTheme !== 'dark' ? currentTheme : 'dark');
    spokeModeDropdown.setValue(currentValue);
    fitSelectToSelectedLabel(spokeModeDropdown.selectEl, { minPx: 132, maxPx: 260, extraPx: 16 });
    spokeModeDropdown.onChange(async (val) => {
        const mode = (val as 'dark' | 'light' | 'none' | 'custom' | 'sync') || 'dark'; // SAFE: the dropdown always has a value; 'dark' is the shipped border mode
        await setAprSettings({
            aprTheme: (mode === 'custom' || mode === 'sync') ? 'dark' : (mode),
            aprSpokeColorMode: mode
        });

        const isCustom = mode === 'custom';
        spokeColorPickerRef?.setDisabled(!isCustom);
        spokeColorInputRef?.setDisabled(!isCustom);

        const style = getActiveStyleSettings();
        const eff = effectiveBorderColor(mode, style.aprSpokeColor ?? fallbackColor, style.aprBackgroundColor ?? currentBg);
        spokeColorInputRef?.setValue(eff);
        spokeColorPickerRef?.setValue(eff);
        fitSelectToSelectedLabel(spokeModeDropdown.selectEl, { minPx: 132, maxPx: 260, extraPx: 16 });
    });

    // Hiding the Radial Timeline mark is a Pro choice, saved with the style.
    if (hasProFeatureAccess(plugin)) {
        const attributionRow = themeBody.createDiv({ cls: ERT_CLASSES.SKIN_PRO });
        const attributionSetting = new Setting(attributionRow)
            .setName(t('settings.authorProgress.attribution.name'))
            .setDesc(t('settings.authorProgress.attribution.desc'))
            .addToggle(toggle => {
                toggle.setValue(getActiveStyleSettings().aprShowRtAttribution !== false)
                    .onChange(async (val) => {
                        await setAprSetting('aprShowRtAttribution', val);
                    });
            });
        attributionSetting.settingEl.addClass('ert-elementBlock', 'ert-settingRow');
    }
}
