export type Triplet<T> = { prev: T | null; current: T; next: T | null };

/**
 * Build prev/current/next triplets by locating each target item within a context list.
 * Neighbors come from the context list; targets define which items to emit.
 */
export function buildTripletsByIndex<T>(
  contextList: readonly T[],
  targets: readonly T[],
  keyFn: (item: T) => string
): Triplet<T>[] {
  const ctxIndexByKey = new Map<string, number>();
  contextList.forEach((item, idx) => ctxIndexByKey.set(keyFn(item), idx));
  const triplets: Triplet<T>[] = [];
  for (const current of targets) {
    const key = keyFn(current);
    const idx = ctxIndexByKey.get(key);
    if (typeof idx !== 'number') {
      // If target not found in context, treat as single with no neighbors
      triplets.push({ prev: null, current, next: null });
      continue;
    }
    const prev = idx > 0 ? contextList[idx - 1] : null;
    const next = idx < contextList.length - 1 ? contextList[idx + 1] : null;
    triplets.push({ prev, current, next });
  }
  return triplets;
}


