// lib/voice/learned.ts
// Turns what staff did (confirmed / corrected counts) into things the parser can use.
// Pure functions only: no browser or database code.

import type { VoicePhrase } from './parse'

export type LearningRow = { itemId: string; phrase: string; confirmed: number; corrected: number }

const total = (r: LearningRow) => r.confirmed + r.corrected

/**
 * A phrase becomes a normal "taught" phrase once staff have backed it enough times:
 * at least `threshold` times in total, at least one of them a real correction,
 * and clearly ahead of any other item for the same words.
 * Phrases a person taught by hand always win, so they are never replaced here.
 */
export function promoteLearned(rows: LearningRow[], taught: VoicePhrase[], threshold = 2): VoicePhrase[] {
  const taughtSet = new Set(taught.map(t => t.phrase))
  const byPhrase = new Map<string, LearningRow[]>()
  for (const r of rows) {
    const list = byPhrase.get(r.phrase)
    if (list) list.push(r)
    else byPhrase.set(r.phrase, [r])
  }
  const out: VoicePhrase[] = []
  for (const [phrase, list] of byPhrase) {
    if (taughtSet.has(phrase)) continue
    const ranked = [...list].sort((a, b) => total(b) - total(a))
    const top = ranked[0]
    if (!top || total(top) < threshold || top.corrected < 1) continue
    const second = ranked[1]
    if (second && total(top) < total(second) * 2) continue // staff disagree: do not decide for them
    out.push({ itemId: top.itemId, phrase })
  }
  return out
}

/** How often each item was backed for exactly these heard words (used to lift it in the "did you mean" list). */
export function learnedCounts(rows: LearningRow[], phrase: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) if (r.phrase === phrase) out[r.itemId] = (out[r.itemId] ?? 0) + total(r)
  return out
}
