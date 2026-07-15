/*
 * Scene splitting (step 1 — deterministic, no AI).
 *
 * Turns one source file's prose into a *proposed* split into scenes, which the
 * author confirms/adjusts at Checkpoint 1 before extraction. Two deterministic
 * signals drive the proposal:
 *
 *   1. Explicit scene-break markers (*** , * * *, ---, ⁂, heading rules) — the
 *      reliable path for modern manuscripts. Markers become breaks and are
 *      dropped from the prose.
 *   2. A Butler-style "argument" header — an all-caps first paragraph whose
 *      clauses are dash-separated, enumerating the book's scenes (the Odyssey).
 *      This yields scene *labels* (and their count) but not boundaries; the
 *      author places the breaks in step 1, and AI proposes them in step 2.
 *
 * Everything here is pure (Obsidian-free) so it is fully unit-testable. A break
 * at index `i` means paragraph `i` *starts* a new scene; index 0 is an implicit
 * start and is never stored.
 */

import type { ManuscriptScene, ManuscriptModel } from './adapters/manuscriptModel';

/** A paragraph that is purely a scene-break marker (not narrative prose). */
const MARKER_RE =
  /^\s*(?:\*\s*\*\s*\*|\*\s*\*|\*{3,}|-{3,}|_{3,}|~{3,}|#{1,6}|•(?:\s*•)+|⁂|◆|❖|\.\s*\.\s*\.)\s*$/;

export function isSceneBreakMarker(paragraph: string): boolean {
  return MARKER_RE.test(paragraph.trim());
}

/** Split prose into paragraphs on blank-line runs; trims and drops empties. */
export function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Detect a Butler-style "argument" header and parse its dash-separated clauses
 * into scene labels. Returns the labels (empty when none) and the body with the
 * header paragraph removed.
 */
export function parseArgumentHeader(text: string): { labels: string[]; body: string } {
  const paragraphs = splitIntoParagraphs(text);
  if (paragraphs.length === 0) return { labels: [], body: text };
  const first = paragraphs[0];
  if (!isArgumentLine(first)) return { labels: [], body: text };
  const labels = first
    .split(/\s*[—–]\s*|\s+-\s+/) // em dash, en dash, or spaced hyphen
    .map((clause) => normalizeLabel(clause))
    .filter((clause) => clause.length > 0);
  if (labels.length < 2) return { labels: [], body: text };
  return { labels, body: paragraphs.slice(1).join('\n\n') };
}

/** True when a paragraph looks like an all-caps, dash-separated argument line. */
function isArgumentLine(paragraph: string): boolean {
  const s = paragraph.trim();
  if (s.length === 0 || s.length > 300) return false;
  if (!/[—–]|\s-\s/.test(s)) return false; // must have a dash separator
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4) return false;
  const upper = s.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.7; // predominantly uppercase
}

/** ALL CAPS ARGUMENT CLAUSE → "Sentence case argument clause" (trailing period dropped). */
function normalizeLabel(clause: string): string {
  const trimmed = clause.trim().replace(/\.+$/, '').replace(/\s+/g, ' ').trim();
  if (trimmed.length === 0) return '';
  const lower = trimmed.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** A per-file split proposal the author edits at Checkpoint 1. */
export interface ScenePlan {
  sourceRef: string;
  baseTitle: string | null;
  /** Body paragraphs — argument header and marker paragraphs already removed. */
  paragraphs: string[];
  /** Argument-derived scene labels (may be empty); used to title/guide segments. */
  labels: string[];
  /** Sorted unique break indices in the open range (0, paragraphs.length). */
  breaks: number[];
  alreadyOnboarded: boolean;
  knownMetadata: Record<string, string>;
  knownSynopsis: string | null;
}

/** Build the initial split proposal for one scene: markers → breaks; argument → labels. */
export function planSceneSplit(scene: ManuscriptScene): ScenePlan {
  const { labels, body } = parseArgumentHeader(scene.rawText);
  const paragraphs: string[] = [];
  const breaks: number[] = [];
  for (const paragraph of splitIntoParagraphs(body)) {
    if (isSceneBreakMarker(paragraph)) {
      if (paragraphs.length > 0) breaks.push(paragraphs.length); // break before the next paragraph
    } else {
      paragraphs.push(paragraph);
    }
  }
  return {
    sourceRef: scene.sourceRef,
    baseTitle: scene.title,
    paragraphs,
    labels,
    breaks: normalizeBreaks(breaks, paragraphs.length),
    alreadyOnboarded: scene.alreadyOnboarded,
    knownMetadata: scene.knownMetadata,
    knownSynopsis: scene.knownSynopsis,
  };
}

/** Toggle a break before paragraph `index` (no-op for out-of-range/0). Returns a new break array. */
export function toggleBreak(plan: ScenePlan, index: number): number[] {
  if (index <= 0 || index >= plan.paragraphs.length) return plan.breaks;
  const set = new Set(plan.breaks);
  if (set.has(index)) set.delete(index);
  else set.add(index);
  return normalizeBreaks([...set], plan.paragraphs.length);
}

/** How many scenes a plan currently yields. */
export function segmentCount(plan: ScenePlan): number {
  if (plan.alreadyOnboarded || plan.paragraphs.length === 0) return 1;
  return plan.breaks.length + 1;
}

/** Resolve a plan into its ordered scene segments (title + prose). */
export function planSegments(plan: ScenePlan): Array<{ title: string | null; text: string }> {
  if (plan.paragraphs.length === 0) {
    return [{ title: plan.baseTitle, text: '' }];
  }
  const bounds = [0, ...plan.breaks, plan.paragraphs.length];
  const total = bounds.length - 1;
  const segments: Array<{ title: string | null; text: string }> = [];
  for (let i = 0; i < total; i++) {
    const text = plan.paragraphs.slice(bounds[i], bounds[i + 1]).join('\n\n');
    segments.push({ title: segmentTitle(plan, i, total), text });
  }
  return segments;
}

function segmentTitle(plan: ScenePlan, index: number, total: number): string | null {
  if (total <= 1) return plan.baseTitle;
  const label = plan.labels[index];
  const suffix = label && label.length > 0 ? label : `Scene ${index + 1}`;
  return plan.baseTitle ? `${plan.baseTitle} — ${suffix}` : suffix;
}

/** Expand a plan into ManuscriptScenes. Already-onboarded notes are never split. */
export function scenesFromPlan(plan: ScenePlan): ManuscriptScene[] {
  const base = {
    knownMetadata: plan.knownMetadata,
    alreadyOnboarded: plan.alreadyOnboarded,
  };
  if (plan.alreadyOnboarded || segmentCount(plan) <= 1) {
    return [{
      ...base,
      title: plan.baseTitle,
      rawText: plan.paragraphs.join('\n\n'),
      knownSynopsis: plan.knownSynopsis,
      sourceRef: plan.sourceRef,
    }];
  }
  return planSegments(plan).map((segment, i) => ({
    ...base,
    title: segment.title,
    rawText: segment.text,
    // A source-carried synopsis described the whole file — keep it only on scene 1.
    knownSynopsis: i === 0 ? plan.knownSynopsis : null,
    sourceRef: `${plan.sourceRef}#${i + 1}`,
  }));
}

/** Apply a map of edited plans (keyed by sourceRef) to a model, expanding split scenes. */
export function applySplitsToModel(
  model: ManuscriptModel,
  plans: Map<string, ScenePlan>
): ManuscriptModel {
  return {
    ...model,
    chapters: model.chapters.map((chapter) => ({
      title: chapter.title,
      scenes: chapter.scenes.flatMap((scene) => {
        const plan = plans.get(scene.sourceRef);
        return plan ? scenesFromPlan(plan) : [scene];
      }),
    })),
  };
}

function normalizeBreaks(breaks: number[], paragraphCount: number): number[] {
  return [...new Set(breaks)]
    .filter((b) => b > 0 && b < paragraphCount)
    .sort((a, b) => a - b);
}
