import type RadialTimelinePlugin from '../main';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { getOpenDocuments } from '../utils/documents';

export class ThemeService {
    constructor(private plugin: RadialTimelinePlugin) { }

    /** Apply RT CSS variables to the main window and every open popout window. */
    applyCssVariables(): void {
        getOpenDocuments(this.plugin.app.workspace).forEach((doc) => this.applyCssVariablesToDocument(doc));
    }

    /** Apply RT CSS variables to one window's document (e.g. a popout that just opened). */
    applyCssVariablesToDocument(doc: Document): void {
        const root = doc.documentElement;
        const { publishStageColors, subplotColors } = this.plugin.settings;

        Object.entries(publishStageColors).forEach(([stage, color]) => {
            root.style.setProperty(`--rt-publishStageColors-${stage}`, color);
            const rgbValues = this.hexToRGB(color);
            if (rgbValues) {
                root.style.setProperty(`--rt-publishStageColors-${stage}-rgb`, rgbValues);
            }
        });

        if (Array.isArray(subplotColors)) {
            for (let i = 0; i < 16; i++) {
                const color = subplotColors[i] || DEFAULT_SETTINGS.subplotColors[i];
                if (color) {
                    root.style.setProperty(`--rt-subplot-colors-${i}`, color);
                }
            }
        }
    }

    private hexToRGB(hex: string): string | null {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        if (isNaN(r) || isNaN(g) || isNaN(b)) {
            return null;
        }

        return `${r}, ${g}, ${b}`;
    }
}
