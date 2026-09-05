import { formatRuntimeValue } from '../../utils/runtimeEstimator';
import { t } from '../../i18n';
import type { ProgressStageState } from '../../progress/progressSnapshot';

export function renderCenterGrid(params: {
  statusesForGrid: string[];
  stagesForGrid: string[];
  gridCounts: Record<string, Record<string, number>>;
  gridSceneNames: Record<string, Record<string, string[]>>;
  gridStageStates: Record<string, ProgressStageState>;
  isBookComplete: boolean;
  PUBLISH_STAGE_COLORS: Record<string, string>;
  currentYearLabel: string;
  estimatedTotalScenes: number;
  totalRuntimeSeconds: number;
  startXGrid: number;
  startYGrid: number;
  cellWidth: number;
  cellHeight: number;
  cellGapX: number;
  cellGapY: number;
  headerY: number;
  stageTooltips: Record<string, string>;
  statusTooltips: Record<string, string>;
  runtimeContentType?: 'novel' | 'screenplay';
}): string {
  const {
    statusesForGrid,
    stagesForGrid,
    gridCounts,
    gridSceneNames,
    gridStageStates,
    isBookComplete,
    PUBLISH_STAGE_COLORS,
    currentYearLabel,
    estimatedTotalScenes,
    totalRuntimeSeconds,
    startXGrid,
    startYGrid,
    cellWidth,
    cellHeight,
    cellGapX,
    cellGapY,
    headerY,
  } = params;

  const gridWidth = statusesForGrid.length * cellWidth + (statusesForGrid.length - 1) * cellGapX;
  const gridHeight = stagesForGrid.length * cellHeight + (stagesForGrid.length - 1) * cellGapY;

  const renderGridCell = (stage: string, status: string, x: number, y: number, count: number, sceneNames: string[]): string => {
    let fillAttr = '';
    if (status === 'Completed') {
      const solid = (PUBLISH_STAGE_COLORS[stage] || '#888888');
      fillAttr = `fill="${solid}"`;
    } else if (status === 'Working') {
      fillAttr = `fill="url(#plaidWorking${stage})"`;
    } else if (status === 'Todo') {
      fillAttr = `fill="url(#plaidTodo${stage})"`;
    } else if (status === 'Due') {
      fillAttr = `fill="var(--rt-color-due)"`;
    } else {
      fillAttr = `fill="#888888"`;
    }
    const cellOpacity = count <= 0 ? 0.10 : 1;
    
    // Build tooltip: show scene names for non-Completed statuses
    let tooltipText = '';
    if (count > 0) {
      if (status === 'Completed') {
        // Don't list scene names for Completed (too many)
        tooltipText = `${stage} • ${status}: ${count}`;
      } else {
        // Show scene names for Todo, Working, Due
        const sceneList = sceneNames.join(', ');
        tooltipText = `${stage} • ${status}: ${sceneList}`;
      }
      // Escape special characters for HTML attribute
      tooltipText = tooltipText.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    }
    
    return `
      <g transform="translate(${x}, ${y})" ${tooltipText ? `class="rt-tooltip-target rt-grid-cell" data-tooltip="${tooltipText}" data-tooltip-placement="bottom"` : ''}>
        <rect x="0" y="0" width="${cellWidth}" height="${cellHeight}" ${fillAttr} fill-opacity="${cellOpacity}" pointer-events="all" />
        ${count > 0 ? `<text x="${cellWidth - 2}" y="${cellHeight - 3}" text-anchor="end" dominant-baseline="alphabetic" class="grid-cell-count">${count}</text>` : ''}
      </g>
    `;
  };

  const header = `
    <g class="color-key-center rt-center-stage-grid">
      ${statusesForGrid.map((status, c) => {
        const label = status === 'Todo' ? t('timeline.grid.statusHeader.todo')
          : status === 'Working' ? t('timeline.grid.statusHeader.working')
          : status === 'Completed' ? t('timeline.grid.statusHeader.completed')
          : t('timeline.grid.statusHeader.due');
        const x = startXGrid + c * (cellWidth + cellGapX) + (cellWidth / 2);
        const y = headerY;
        const tip = params.statusTooltips[status] || status;
        return `
          <g class="status-header rt-tooltip-target" data-tooltip="${tip}" data-tooltip-placement="bottom">
            <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="alphabetic" class="center-key-text status-header-letter">${label}</text>
            <rect x="${x - 18}" y="${y - 18}" width="36" height="24" fill="transparent" pointer-events="all" />
          </g>
        `;
      }).join('')}
      ${(() => {
        const runtimeY = startYGrid + gridHeight + (cellGapY + 16);
        const runtimeText = totalRuntimeSeconds > 0 ? formatRuntimeValue(totalRuntimeSeconds) : 'No Data';
        return `<g class="rt-runtime-display">
          <text x="${startXGrid}" y="${runtimeY}" text-anchor="start" dominant-baseline="alphabetic" class="center-key-text rt-runtime-total">${runtimeText}</text>
        </g>`;
      })()}
      <text x="${startXGrid + gridWidth}" y="${startYGrid + gridHeight + (cellGapY + 16)}" text-anchor="end" dominant-baseline="alphabetic" class="center-key-text">${currentYearLabel}//${estimatedTotalScenes}</text>
    `;

  const rows = stagesForGrid.map((stage, r) => {
    const xh = startXGrid - 12;
    const yh = startYGrid + r * (cellHeight + cellGapY) + (cellHeight / 2 + 1);
    const stageTip = params.stageTooltips[stage] || stage;
    const stageKey = stage.toLowerCase();
    const stageHeader = `
      <g class="stage-header rt-tooltip-target" data-tooltip="${stageTip}" data-tooltip-placement="right">
        <text x="${xh}" y="${yh}" text-anchor="end" dominant-baseline="middle" class="center-key-text stage-header-letter" data-stage="${stageKey}">${stage === 'Zero' ? t('timeline.grid.stageHeader.zero') : stage === 'Author' ? t('timeline.grid.stageHeader.author') : stage === 'House' ? t('timeline.grid.stageHeader.house') : t('timeline.grid.stageHeader.press')}</text>
        <rect x="${xh - 14}" y="${yh - 14}" width="28" height="28" fill="transparent" pointer-events="all" />
      </g>
    `;
    const cells = statusesForGrid.map((status, c) => {
      const count = gridCounts[stage][status] || 0;
      const sceneNames = gridSceneNames[stage]?.[status] || [];
      const x = startXGrid + c * (cellWidth + cellGapX);
      const y = startYGrid + r * (cellHeight + cellGapY);
      const completeRow = gridStageStates[stage]?.isComplete ?? false;
      if (completeRow) {
        const fillStage = isBookComplete ? 'Press' : stage;
        const solid = (PUBLISH_STAGE_COLORS[fillStage] || '#888888');
        
        // Use smile face for ALL rows when final book completion is reached
        const iconId = isBookComplete ? 'icon-smile' : 'icon-bookmark-check';
        const completedTooltip = isBookComplete ? 'Book Complete!' : `${stage} stage complete`;
        
        return `
          <g transform="translate(${x}, ${y})" class="rt-tooltip-target rt-grid-cell-complete" data-tooltip="${completedTooltip}" data-tooltip-placement="bottom">
            <rect x="0" y="0" width="${cellWidth}" height="${cellHeight}" fill="${solid}" pointer-events="all" />
            <use href="#${iconId}" x="${(cellWidth - 18) / 2}" y="${(cellHeight - 18) / 2}" width="18" height="18" class="completed-icon" />
          </g>
        `;
      }
      return renderGridCell(stage, status, x, y, count, sceneNames);
    }).join('');
    return `${stageHeader}${cells}`;
  }).join('');

  const arrows = (() => {
    const maxStageIdxForGrid = stagesForGrid.reduce((acc, s, idx) => {
      const counts = gridCounts[s];
      const total = (counts.Todo || 0) + (counts.Working || 0) + (counts.Due || 0) + (counts.Completed || 0);
      return total > 0 ? Math.max(acc, idx) : acc;
    }, -1);
    if (maxStageIdxForGrid === -1) return '';
    return stagesForGrid.map((stage, r) => {
      // Only show arrows for rows up to and including the most advanced stage
      if (r > maxStageIdxForGrid) return '';
      
      const isComplete = gridStageStates[stage]?.isComplete ?? false;
      const ax = startXGrid + gridWidth + 4;
      const ay = startYGrid + r * (cellHeight + cellGapY) + (cellHeight / 2);
      
      if (isComplete) {
        // Complete rows get down arrow colored with that stage's color
        const stageKey = stage.toLowerCase();
        return `<use href="#icon-arrow-down" x="${ax}" y="${ay - 12}" width="24" height="24" class="rt-grid-arrow rt-grid-arrow-complete" data-stage="${stageKey}" />`;
      } else {
        // Incomplete rows (still working on this stage) get right arrow
        return `<use href="#icon-arrow-right-dash" x="${ax}" y="${ay - 12}" width="24" height="24" class="rt-grid-arrow" />`;
      }
    }).join('');
  })();

  return `${header}${rows}${arrows}</g>`;
}
