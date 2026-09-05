import type { TimelineItem } from '../../types';
import { isBeatNote, type PluginRendererFacade } from '../../utils/sceneHelpers';
import { renderGossamerMonthSpokes } from '../components/MonthSpokes';
import { renderGossamerLayer } from '../gossamerLayer';

export type StageColorMap = Record<string, string> & { Zero: string };

type GossamerOverlayOptions = {
    plugin: PluginRendererFacade;
    scenes: TimelineItem[];
    innerRadius: number;
    actualOuterRadius: number;
    ringStartRadii: number[];
    numRings: number;
    publishStageColors: StageColorMap;
};

export function renderGossamerOverlay({
    plugin,
    scenes,
    innerRadius,
    actualOuterRadius,
    ringStartRadii,
    numRings,
    publishStageColors
}: GossamerOverlayOptions): string {
    if (numRings <= 0) {
        return '';
    }

    // Detect whether any timeline view is in Gossamer mode
    const views = plugin.app.workspace.getLeavesOfType('radial-timeline');
    const isGossamerMode = views.some(leaf => leaf.view?.currentMode === 'gossamer');

    if (!isGossamerMode) {
        return '';
    }

    let svg = '';
    const polar = { innerRadius, outerRadius: actualOuterRadius };
    const outerRingInnerRadius = ringStartRadii[numRings - 1];
    const run = plugin._gossamerLastRun || null;
    const anglesByBeat = plugin._beatAngles || new Map<string, number>();

    const beatPathByName = new Map<string, string>();
    scenes.forEach(scene => {
        if (!isBeatNote(scene) || !scene.title || !scene.path) return;
        const titleWithoutNumber = scene.title.replace(/^\s*\d+(?:\.\d+)?\s+/, '').trim();
        beatPathByName.set(titleWithoutNumber, scene.path);
    });

    const publishStageColorByBeat = new Map<string, string>();
    scenes.forEach(scene => {
        if (!isBeatNote(scene) || !scene.title) return;
        const titleWithoutNumber = scene.title.replace(/^\s*\d+(?:\.\d+)?\s+/, '').trim();
        const publishStage = scene['Publish Stage'] || 'Zero';
        const stageColor = publishStageColors[publishStage] || publishStageColors.Zero;
        publishStageColorByBeat.set(titleWithoutNumber, stageColor);
    });

    const beatSlicesByName = plugin._beatSlices || new Map();

    // Render spokes before the gossamer traces so they sit beneath the data layer
    const numActs = Math.max(3, Math.floor(plugin.settings.actCount ?? 3));
    svg += renderGossamerMonthSpokes({ innerRadius, outerRadius: actualOuterRadius, numActs });

    const historicalRuns = plugin._gossamerHistoricalRuns || [];
    const minMax = plugin._gossamerMinMax || undefined;
    const hasAnyScores = plugin._gossamerHasAnyScores || false;

    const layer = renderGossamerLayer(
        scenes,
        run,
        polar,
        anglesByBeat.size ? anglesByBeat : undefined,
        beatPathByName,
        historicalRuns,
        minMax,
        outerRingInnerRadius,
        publishStageColorByBeat,
        beatSlicesByName,
        publishStageColors,
        hasAnyScores
    );
    if (layer) {
        svg += layer;
    }

    return svg;
}
