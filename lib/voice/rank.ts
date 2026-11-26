// lib/voice/rank.ts
// Like a map app: sound closeness decides first, then "what this kitchen sells most"
// and "what staff chose before for these words" break close calls.
// Pure functions only: no browser or database code.

import type { SoundMatch } from './sound'

/** item id -> 0 to 1 (1 = the best seller) */
export type Popularity = Record<string, number>

/** Orders keep their lines in items_json as [{ item_id, qty }]. Counts units sold per item, scaled to 0..1. */
export function popularityFromOrders(itemsJson: unknown[]): Popularity {
  const sold: Record<string, number> = {}
  for (const lines of itemsJson) {
    if (!Array.isArray(lines)) continue
    for (const l of lines as { item_id?: unknown; qty?: unknown }[]) {
      if (typeof l?.item_id !== 'string') continue
      const q = typeof l.qty === 'number' && l.qty > 0 ? l.qty : 1
      sold[l.item_id] = (sold[l.item_id] ?? 0) + q
    }
  }
  const max = Math.max(0, ...Object.values(sold))
  const out: Popularity = {}
  if (max > 0) for (const [id, n] of Object.entries(sold)) out[id] = n / max
  return out
}

/** Re-orders "did you mean" matches. The boosts are small, so they only settle close calls. */
export function rerank(matches: SoundMatch[], popularity: Popularity, learned: Record<string, number>): SoundMatch[] {
  const boosted = (m: SoundMatch) =>
    m.score + 0.06 * (popularity[m.itemId] ?? 0) + 0.1 * (Math.min(learned[m.itemId] ?? 0, 3) / 3)
  return [...matches].sort((a, b) => boosted(b) - boosted(a))
}

/** Best sellers first (used when the app heard a real menu word that fits several items, like "chicken"). */
export function byPopularity<T extends { itemId: string }>(options: T[], popularity: Popularity): T[] {
  return options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => (popularity[b.o.itemId] ?? 0) - (popularity[a.o.itemId] ?? 0) || a.i - b.i)
    .map(x => x.o)
}
