import type { MatterMeta, LegacyMatterOrder } from '../types';

export type MatterSide = 'front' | 'back';
export type MatterBodyMode = 'latex' | 'plain';
export type MatterClass = 'frontmatter' | 'backmatter';

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized.length) return undefined;
    if (normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === 'no' || normalized === '0' || normalized === 'off') return false;
  }
  return undefined;
}

function parseOrder(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Parse the BodyMode field. Defaults to `plain` when missing or unrecognized.
 * `plain` is the safe default — body text is escaped for LaTeX, no injection.
 * Authors who need raw LaTeX must declare `BodyMode: latex` explicitly.
 */
export function normalizeMatterBodyMode(value: unknown): MatterBodyMode {
  if (typeof value === 'string' && value.trim().toLowerCase() === 'latex') return 'latex';
  return 'plain';
}

export function normalizeMatterClassValue(value: unknown): MatterClass | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (normalized === 'frontmatter' || normalized === 'front') return 'frontmatter';
  if (normalized === 'backmatter' || normalized === 'back') return 'backmatter';
  return null;
}

export function isMatterClassValue(value: unknown): boolean {
  return normalizeMatterClassValue(value) !== null;
}

/**
 * Parse matter metadata from frontmatter.
 *
 * Required: `Class: Frontmatter | Backmatter`. Returns null if absent.
 * Recognized fields (canonical names only — no aliases):
 *   - Class
 *   - Role
 *   - UseBookMeta
 *   - BodyMode
 *   - Enabled       (default true; `Enabled: false` keeps the note on disk
 *                    but excludes it from the resolved Book Pages list and
 *                    the export — lets a canonical-role note step aside so
 *                    the BookMeta page for that role surfaces again)
 */
export function parseMatterMetaFromFrontmatter(
  frontmatter: Record<string, unknown> | undefined
): MatterMeta | null {
  if (!frontmatter) return null;

  const classValue = normalizeMatterClassValue(frontmatter.Class);
  if (!classValue) return null;

  const side: MatterSide = classValue === 'backmatter' ? 'back' : 'front';

  const meta: MatterMeta = {
    side,
    bodyMode: normalizeMatterBodyMode(frontmatter.BodyMode),
  };

  const role = asNonEmptyString(frontmatter.Role);
  if (role) meta.role = role;

  const usesBookMeta = parseOptionalBoolean(frontmatter.UseBookMeta);
  if (usesBookMeta !== undefined) meta.usesBookMeta = usesBookMeta;

  const order = parseOrder(frontmatter.Order);
  if (order !== undefined) (meta as LegacyMatterOrder).order = order;

  // Enabled defaults to true. Only an explicit `Enabled: false` is recorded;
  // absence or `true` leaves `meta.enabled` undefined (treated as enabled
  // everywhere), so existing notes need no migration.
  const enabled = parseOptionalBoolean(frontmatter.Enabled);
  if (enabled === false) meta.enabled = false;

  return meta;
}
