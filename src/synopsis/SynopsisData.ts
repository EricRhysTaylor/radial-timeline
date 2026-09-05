import { decodeHtmlEntities } from '../utils/text';

export interface SynopsisScene {
  title?: string;
  date?: string;
  path?: string;
  subplot?: string;
  act?: string;
  pov?: string;
  location?: string;
  number?: number;
  synopsis?: string;
  when?: Date;
  actNumber?: number;
  Character?: string[];
  status?: string | string[];
  "Publish Stage"?: string;
  due?: string;
  pendingEdits?: string;
}

export function getPublishStageStyle(stageInput: unknown, publishStageColors: Record<string, string>): { stageClass: string; titleColor: string } {
  const stage = (stageInput as string) || 'Zero';
  const stageClass = `rt-title-stage-${String(stage).toLowerCase()}`;
  // A stage string the settings do not know has no colour of its own; show it muted.
  const titleColor = publishStageColors[stage] || 'var(--text-muted)';
  return { stageClass, titleColor };
}

export function splitSynopsisLines(contentLines: string[]): { synopsisEndIndex: number; metadataItems: string[] } {
  let synopsisEndIndex = contentLines.findIndex(line => line === '\u00A0' || line === '');
  if (synopsisEndIndex === -1) synopsisEndIndex = Math.max(0, contentLines.length - 2);
  const metadataItems = contentLines.slice(synopsisEndIndex + 1);
  return { synopsisEndIndex, metadataItems };
}

export function decodeContentLines(lines: string[]): string[] {
  return lines.map(line => decodeHtmlEntities(line));
}

export function isOverdueAndIncomplete(scene: SynopsisScene, today: Date = new Date()): boolean {
  const dueString = scene.due;
  if (!dueString || typeof dueString !== 'string') return false;
  const parts = dueString.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return false;
  const [dueYear, dueMonth1, dueDay] = parts;
  const dueMonth = dueMonth1 - 1;

  const todayY = today.getFullYear();
  const todayM = today.getMonth();
  const todayD = today.getDate();

  let isOverdue = false;
  if (dueYear < todayY) isOverdue = true; else if (dueYear === todayY) {
    if (dueMonth < todayM) isOverdue = true; else if (dueMonth === todayM) {
      if (dueDay < todayD) isOverdue = true;
    }
  }

  let normalizedStatus = '';
  if (scene.status) {
    if (Array.isArray(scene.status) && scene.status.length > 0) normalizedStatus = String(scene.status[0]).trim().toLowerCase();
    else if (typeof scene.status === 'string') normalizedStatus = scene.status.trim().toLowerCase();
  }
  const isComplete = normalizedStatus === 'complete' || normalizedStatus === 'done';
  return isOverdue && !isComplete;
}
