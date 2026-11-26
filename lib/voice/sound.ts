// lib/voice/sound.ts
// Matches words by how they SOUND, not how they are spelled.
// Chrome writes Nigerian food names the way an English speaker would hear them
// ("agoyin" becomes "a going", "gbegiri" becomes "bay gary", "pupuru" becomes "ukuru"),
// so spelling alone cannot connect them. Here every word is reduced to a rough sound
// shape first: similar consonants are treated as the same sound and vowels count for less.
// Pure functions only: no browser or database code.

import type { VoiceMenuItem } from './parse'

export type SoundMatch = { itemId: string; name: string; score: number }

function lev(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, k) => k)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] as number
      prev[j] = Math.min(up + 1, (prev[j - 1] as number) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = up
    }
  }
  return prev[b.length] as number
}

const similarity = (a: string, b: string): number => {
  const longest = Math.max(a.length, b.length)
  return longest === 0 ? 0 : 1 - lev(a, b) / longest
}

// Nigerian sounds first (two letters that make ONE sound), then single letters grouped by how alike they sound.
const PAIRS: [RegExp, string][] = [
  [/gb/g, 'b'], // gbegiri
  [/kp/g, 'p'], // akpu
  [/ny/g, 'n'],
  [/ch/g, 'j'],
  [/sh/g, 's'],
  [/ph/g, 'f'],
  [/th/g, 't'],
  [/ck/g, 'k'],
  [/ng(?=[aeiou]|$)/g, 'n'], // "going" and "goyin" sound alike when said fast
]

const GROUPS: Record<string, string> = {
  p: 'X', b: 'X', t: 'X', d: 'X', k: 'X', g: 'X', c: 'X', q: 'X', // sounds that stop the air: easy to confuse
  f: 'F', v: 'F',
  s: 'S', z: 'S', x: 'S',
  j: 'J',
  l: 'R', r: 'R', // many speakers swap these
  m: 'M', n: 'N',
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y', 'w', 'h'])

function shape(word: string): { full: string; bones: string } {
  let w = word.toLowerCase().replace(/[^a-z]/g, '')
  for (const [re, to] of PAIRS) w = w.replace(re, to)
  let full = ''
  let bones = ''
  for (const ch of w) {
    if (VOWELS.has(ch)) {
      full += ch === 'w' || ch === 'h' ? 'a' : ch
    } else {
      const g = GROUPS[ch] ?? ch.toUpperCase()
      full += g
      // the same sound twice in a row is said once, even with a vowel between ("pupuru" and "ukuru" share a shape),
      // because phones often squash or drop small syllables
      if (bones[bones.length - 1] !== g) bones += g
    }
  }
  return { full: full.replace(/(.)\1+/g, '$1'), bones }
}

/** 0 to 1: how alike two spoken words (or phrases) sound. */
export function soundScore(heard: string, target: string): number {
  const a = shape(heard)
  const b = shape(target)
  if (a.full.length < 3 || b.full.length < 3) return 0
  // the consonant skeleton matters most; the full shape (with vowels) breaks ties
  return 0.6 * similarity(a.bones, b.bones) + 0.4 * similarity(a.full, b.full)
}

/**
 * The menu items that sound most like what was heard, best first.
 * It tries the heard words joined together, and also each single word and each pair of neighbours,
 * against the whole menu name and against each word of the name
 * (so "forever going" can match "Ewa Agoyin" through "going" and "agoyin").
 */
export function rankBySound(heard: string[], items: VoiceMenuItem[], limit = 3, min = 0.75): SoundMatch[] {
  const spans: string[] = [heard.join('')]
  for (let i = 0; i < heard.length; i++) {
    spans.push(heard[i] as string)
    if (i + 1 < heard.length) spans.push((heard[i] as string) + (heard[i + 1] as string))
  }
  const usable = spans.filter(sp => sp.replace(/[^a-z]/gi, '').length >= 3)
  if (usable.length === 0) return []

  const best = new Map<string, SoundMatch>()
  for (const item of items) {
    const nameWords = item.name.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3)
    let score = 0
    for (const sp of usable) {
      score = Math.max(score, soundScore(sp, item.name))
      for (const nw of nameWords) score = Math.max(score, soundScore(sp, nw) * 0.95)
    }
    if (score < min) continue
    const old = best.get(item.id)
    if (!old || score > old.score) best.set(item.id, { itemId: item.id, name: item.name, score })
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}
