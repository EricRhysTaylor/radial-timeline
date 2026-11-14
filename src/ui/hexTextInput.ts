import type { TextComponent } from 'obsidian';
import { completeHexColor } from '../utils/colour';

/**
 * Wire a hex color text field to `save`. A full #rrggbb saves as it is typed.
 * A shorthand #rgb saves only once the field is committed (Enter or leaving
 * it), and the field then shows the expanded #rrggbb, so typing "#F9E784"
 * never saves "#FF99EE" on the way.
 */
export function bindHexTextInput(text: TextComponent, save: (hex: string) => void | Promise<void>): void {
    text.onChange(async (value) => {
        const hex = completeHexColor(value, { shorthand: false });
        if (hex) await save(hex);
    });
    // The input's own change event: it fires once the field is committed. The
    // handler lives and dies with the element, so no Component owns it.
    text.inputEl.onchange = () => {
        const value = text.getValue();
        // A full color was already saved while it was typed.
        if (completeHexColor(value, { shorthand: false })) return;
        const hex = completeHexColor(value);
        if (!hex) return;
        text.setValue(hex);
        void save(hex);
    };
}
