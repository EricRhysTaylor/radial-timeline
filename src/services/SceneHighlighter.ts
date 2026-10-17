import type RadialTimelinePlugin from '../main';

const SPOTLIGHT_SELECTOR = '.rt-scene-path, .rt-number-square, .rt-number-text, .rt-scene-title, .rt-discontinuity-marker';

export class SceneHighlighter {
    constructor(private plugin: RadialTimelinePlugin) {}

    /**
     * Light up one scene on every open timeline the way the timeline's own
     * hover does (SceneInteractionManager.applySelection): the scene's cells,
     * numbers and titles in every ring it sits on are selected and the rest are
     * muted. Null clears it. Used for Timetable rows and for scene notes hovered
     * in the file explorer or a tab header.
     */
    spotlight(filePath: string | null): void {
        for (const svg of this.timelineSvgs()) {
            svg.classList.remove('ert-scene-spotlight');
            const all = svg.querySelectorAll(SPOTLIGHT_SELECTOR);
            const gossamer = svg.getAttribute('data-mode') === 'gossamer';
            all.forEach(element => {
                element.classList.remove('rt-selected');
                if (!gossamer) element.classList.remove('rt-non-selected');
            });
            if (!filePath) continue;
            const groups = svg.querySelectorAll(`.rt-scene-group[data-path="${encodeURIComponent(filePath)}"]`);
            if (groups.length === 0) continue;
            svg.classList.add('ert-scene-spotlight');
            groups.forEach(group => {
                const scenePath = group.querySelector('.rt-scene-path');
                scenePath?.classList.add('rt-selected');
                group.querySelector('.rt-scene-title')?.classList.add('rt-selected');
                const sceneId = scenePath?.id;
                if (!sceneId) return;
                svg.querySelector(`.rt-number-square[data-scene-id="${sceneId}"]`)?.classList.add('rt-selected');
                svg.querySelector(`.rt-number-text[data-scene-id="${sceneId}"]`)?.classList.add('rt-selected');
            });
            all.forEach(element => {
                if (!element.classList.contains('rt-selected')) element.classList.add('rt-non-selected');
            });
        }
    }

    private timelineSvgs(): Element[] {
        return this.plugin.getTimelineViews()
            .map(view => view.contentEl.querySelector('.radial-timeline-container svg'))
            .filter((svg): svg is SVGSVGElement => svg !== null);
    }
}
