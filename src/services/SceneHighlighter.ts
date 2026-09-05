import type RadialTimelinePlugin from '../main';

export class SceneHighlighter {
    constructor(private plugin: RadialTimelinePlugin) {}

    highlight(filePath: string, isHighlighting: boolean): void {
        if (!filePath) return;
        const views = this.plugin.getTimelineViews();
        if (views.length === 0) return;

        for (const view of views) {
            try {
                const container = view.contentEl.querySelector('.radial-timeline-container');
                if (!container) continue;
                const svgElement = container.querySelector('svg');
                if (!svgElement) continue;

                if (isHighlighting) {
                    const allElements = svgElement.querySelectorAll('.rt-scene-path, .rt-number-square, .rt-number-text, .rt-scene-title');
                    allElements.forEach(element => {
                        element.classList.remove('rt-selected');
                        const currentMode = svgElement.getAttribute('data-mode');
                        if (currentMode !== 'gossamer') {
                            element.classList.remove('rt-non-selected');
                        }
                    });
                }

                let foundScene = false;
                let encodedPath = encodeURIComponent(filePath);
                let sceneGroup = svgElement.querySelector(`.scene-group[data-path="${encodedPath}"]`);
                if (!sceneGroup && filePath.startsWith('/')) {
                    encodedPath = encodeURIComponent(filePath.substring(1));
                    sceneGroup = svgElement.querySelector(`.scene-group[data-path="${encodedPath}"]`);
                } else if (!sceneGroup && !filePath.startsWith('/')) {
                    encodedPath = encodeURIComponent(`/${filePath}`);
                    sceneGroup = svgElement.querySelector(`.scene-group[data-path="${encodedPath}"]`);
                }

                if (sceneGroup) {
                    foundScene = true;
                    if (isHighlighting) {
                        const currentPath = sceneGroup.querySelector('.rt-scene-path');
                        if (currentPath) {
                            currentPath.classList.add('rt-selected');
                            const sceneId = (currentPath as SVGPathElement).id;
                            const numberSquare = svgElement.querySelector(`.rt-number-square[data-scene-id="${sceneId}"]`);
                            const numberText = svgElement.querySelector(`.rt-number-text[data-scene-id="${sceneId}"]`);
                            if (numberSquare) numberSquare.classList.add('rt-selected');
                            if (numberText) numberText.classList.add('rt-selected');
                            const sceneTitle = sceneGroup.querySelector('.rt-scene-title');
                            if (sceneTitle) sceneTitle.classList.add('rt-selected');
                            const allScenePaths = svgElement.querySelectorAll('.rt-scene-path:not(.rt-selected)');
                            allScenePaths.forEach(element => element.classList.add('rt-non-selected'));
                            const synopsis = svgElement.querySelector(`.rt-scene-info[data-for-scene="${sceneId}"]`);
                            if (synopsis) synopsis.classList.add('rt-visible');
                        }
                    } else {
                        const allElements = svgElement.querySelectorAll('.rt-scene-path, .rt-number-square, .rt-number-text, .rt-scene-title');
                        allElements.forEach(element => element.classList.remove('selected', 'non-selected'));
                        const currentPath = sceneGroup.querySelector('.rt-scene-path');
                        if (currentPath) {
                            const sceneId = (currentPath as SVGPathElement).id;
                            const synopsis = svgElement.querySelector(`.rt-scene-info[data-for-scene="${sceneId}"]`);
                            if (synopsis) synopsis.classList.remove('rt-visible');
                        }
                    }
                }
                if (!foundScene) {
                    // Not found; nothing to do.
                }
            } catch {
                // Ignore highlighting errors.
            }
        }
    }
}
