// lib/voice/best.ts
// Chrome gives up to 3 guesses for every sentence. This reads all of them and keeps the one
// the menu understands best, instead of always trusting the first guess.
// Pure functions only: no browser or database code.

import {
  parseVoiceLines,
  type VoiceMenuItem,
  type VoiceParseOptions,
  type VoiceParseResult,
  type VoicePhrase,
} from './parse'

export type Guess = { transcript: string; confidence: number }

export type BestParse = {
  result: VoiceParseResult
  /** 0 = Chrome's first guess, 1 = its second guess, and so on */
  guessIndex: number
  heard: string
  confidence: number
}

// More understood items is better, every problem is worse, and on a tie Chrome's own order wins.
function quality(result: VoiceParseResult, index: number): number {
  return result.lines.length * 2 - result.problems.length * 3 - index * 0.1
}

export function parseBest(
  guesses: Guess[],
  menu: VoiceMenuItem[],
  phrases: VoicePhrase[] = [],
  options: VoiceParseOptions = {}
): BestParse | null {
  let best: BestParse | null = null
  let bestQuality = -Infinity
  guesses.forEach((g, index) => {
    if (!g.transcript.trim()) return
    const result = parseVoiceLines(g.transcript, menu, phrases, options)
    const q = quality(result, index)
    if (q > bestQuality) {
      bestQuality = q
      best = { result, guessIndex: index, heard: g.transcript, confidence: g.confidence }
    }
  })
  return best
}
