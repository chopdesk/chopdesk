// lib/voice/wake.ts
// Finds the wake phrase ("Hey Chopdesk") at the START of what the phone heard, by SOUND not spelling,
// because Chrome writes it many ways ("hey chop desk", "hey shop desk", "a chopped desk").
// Whatever comes after the wake phrase is the order. Pure functions only: no browser or database code.

import { soundScore } from './sound'

export const WAKE_WORD = 'chopdesk'

// ways the greeting in front of the wake word may be written
const LEAD = new Set(['hey', 'hay', 'he', 'hi', 'high', 'ok', 'okay', 'hello', 'a', 'eh', 'yo'])

export type WakeMatch = {
  /** everything said after the wake phrase (may be empty: they only said the wake phrase) */
  command: string
  score: number
}

const tokensOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[,.!?;:]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

/**
 * With a greeting ("hey ...") the wake word must be fairly close.
 * Without one, it must sound almost exactly right, so ordinary kitchen talk does not wake the app.
 * A false wake is cheap (the app just waits a few seconds and adds nothing), a missed wake is annoying,
 * so the greeting version leans towards waking.
 */
export function matchWake(transcript: string, wake: string = WAKE_WORD): WakeMatch | null {
  const tokens = tokensOf(transcript)
  if (tokens.length === 0) return null

  let best: { score: number; end: number } | null = null
  for (const lead of [0, 1]) {
    if (lead === 1 && !LEAD.has(tokens[0] as string)) continue
    const need = lead === 1 ? 0.85 : 0.97
    for (let k = 1; k <= 3; k++) {
      const win = tokens.slice(lead, lead + k)
      if (win.length < k) break
      if (win.some(w => /\d/.test(w))) break
      // "ch" and "sh" are often swapped by speakers and by the phone; an extra "s" before "d" (chops desk) is dropped
      const heard = win.join('').replace(/sh/g, 'ch').replace(/s(?=d)/g, '')
      const score = soundScore(heard, wake)
      if (score >= need && (!best || score > best.score + 0.02 || (score >= best.score - 0.02 && lead + k > best.end))) {
        best = { score, end: lead + k }
      }
    }
  }
  if (!best) return null
  return { command: tokens.slice(best.end).join(' '), score: best.score }
}

/**
 * Some Android phones repeat the whole sentence twice in one result ("two jollof two jollof").
 * If the words are exactly one phrase said twice, keep one copy.
 */
export function dropRepeat(text: string): string {
  const w = text.trim().split(/\s+/).filter(Boolean)
  if (w.length >= 2 && w.length % 2 === 0) {
    const half = w.length / 2
    if (w.slice(0, half).join(' ').toLowerCase() === w.slice(half).join(' ').toLowerCase()) return w.slice(0, half).join(' ')
  }
  return w.join(' ')
}
