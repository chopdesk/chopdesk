// lib/voice/parse.ts
// Turns what the phone heard ("jollof rice 300, beans fifty") into item + quantity lines.
// Pure functions only: no browser or database code, so it is easy to test and reuse
// for stock logging, closing counts and order taking.

export type VoiceMenuItem = { id: string; name: string }

export type VoiceLine = {
  itemId: string
  itemName: string
  qty: number
  heard: string
}

export type VoiceProblem = {
  heard: string
  reason: 'no_item' | 'no_quantity' | 'ambiguous'
  candidates: string[]
}

export type VoiceParseResult = {
  lines: VoiceLine[]
  problems: VoiceProblem[]
}

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

// words that split one spoken sentence into separate items
const SEPARATORS = new Set(['and', 'then', 'plus', 'next', 'also'])
// words in a menu name that carry no meaning for matching
const NAME_STOP = new Set(['and', 'with', 'of', 'the'])

const has = (map: Record<string, number>, key: string) =>
  Object.prototype.hasOwnProperty.call(map, key)

const isNumberWord = (w: string) =>
  has(ONES, w) || has(TENS, w) || w === 'hundred' || w === 'thousand'

type Tok =
  | { kind: 'word'; text: string }
  | { kind: 'num'; value: number }
  | { kind: 'sep' }

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1$2') // 1,500 becomes 1500
    .replace(/[,;.\n]/g, ' | ') // punctuation that means "next item"
    .replace(/[^a-z0-9|\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function tokenize(text: string): Tok[] {
  const raw = normalizeWords(text)
  const out: Tok[] = []
  let i = 0
  while (i < raw.length) {
    const w = raw[i] as string
    if (w === '|') {
      out.push({ kind: 'sep' })
      i++
    } else if (/^\d+$/.test(w)) {
      out.push({ kind: 'num', value: parseInt(w, 10) })
      i++
    } else if (isNumberWord(w)) {
      // read a spoken number such as "three hundred and fifty"
      let total = 0
      let current = 0
      let j = i
      while (j < raw.length) {
        const t = raw[j] as string
        if (has(ONES, t)) current += ONES[t] as number
        else if (has(TENS, t)) current += TENS[t] as number
        else if (t === 'hundred') current = (current || 1) * 100
        else if (t === 'thousand') {
          total += (current || 1) * 1000
          current = 0
        } else if (
          t === 'and' &&
          j > i &&
          (raw[j - 1] === 'hundred' || raw[j - 1] === 'thousand') &&
          j + 1 < raw.length &&
          isNumberWord(raw[j + 1] as string)
        ) {
          // the "and" inside "three hundred and fifty": part of the number
        } else break
        j++
      }
      out.push({ kind: 'num', value: total + current })
      i = j
    } else if (SEPARATORS.has(w)) {
      out.push({ kind: 'sep' })
      i++
    } else {
      out.push({ kind: 'word', text: w })
      i++
    }
  }
  return out
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, k) => k)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] as number
      prev[j] = Math.min(
        up + 1,
        (prev[j - 1] as number) + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      diag = up
    }
  }
  return prev[b.length] as number
}

// does a word the phone heard match a word in a menu name? tolerates plurals and small mishearings
function wordsMatch(heard: string, target: string): boolean {
  const h = heard.replace(/s$/, '')
  const t = target.replace(/s$/, '')
  if (h === t) return true
  if (t.length < 4) return false
  const allowed = t.length >= 8 ? 2 : 1
  return distance(h, t) <= allowed
}

type Scored = { item: VoiceMenuItem; score: number; matched: number }

function matchItems(words: string[], items: VoiceMenuItem[]): Scored[] {
  const scored: Scored[] = []
  for (const item of items) {
    const nameWords = normalizeWords(item.name).filter(w => w !== '|' && !NAME_STOP.has(w))
    if (nameWords.length === 0) continue
    const matched = nameWords.filter(nw => words.some(w => wordsMatch(w, nw))).length
    const score = matched / nameWords.length
    if (matched >= 1 && score >= 0.5) scored.push({ item, score, matched })
  }
  // best score first; on a tie, the item that matched more words wins
  return scored.sort((a, b) => b.score - a.score || b.matched - a.matched)
}

function splitSegment(seg: Tok[]): Tok[][] {
  const nums = seg.filter(t => t.kind === 'num').length
  if (nums <= 1) return [seg]
  const chunks: Tok[][] = []
  let cur: Tok[] = []
  const numberFirst = seg[0]?.kind === 'num' // "2 jollof 1 chicken" vs "jollof 300 beans 50"
  for (const t of seg) {
    if (numberFirst) {
      if (t.kind === 'num' && cur.length > 0) {
        chunks.push(cur)
        cur = []
      }
      cur.push(t)
    } else {
      cur.push(t)
      if (t.kind === 'num') {
        chunks.push(cur)
        cur = []
      }
    }
  }
  if (cur.length > 0) chunks.push(cur)
  return chunks
}

/**
 * Parses a spoken sentence into item + quantity lines.
 * Anything it cannot place is returned in `problems` so the screen can ask again.
 * If the same item is heard twice, both lines are returned; the caller decides
 * whether the later one replaces the earlier (stock) or adds to it (orders).
 */
export function parseVoiceLines(transcript: string, items: VoiceMenuItem[]): VoiceParseResult {
  const lines: VoiceLine[] = []
  const problems: VoiceProblem[] = []

  // split into segments at separators
  const segments: Tok[][] = [[]]
  for (const t of tokenize(transcript)) {
    if (t.kind === 'sep') segments.push([])
    else (segments[segments.length - 1] as Tok[]).push(t)
  }

  for (const seg of segments) {
    for (const chunk of splitSegment(seg)) {
      const words = chunk.flatMap(t => (t.kind === 'word' ? [t.text] : []))
      const num = chunk.find(t => t.kind === 'num')
      if (words.length === 0 && !num) continue

      const heard = chunk.map(t => (t.kind === 'word' ? t.text : t.kind === 'num' ? String(t.value) : '')).join(' ')
      const ranked = matchItems(words, items)
      const top = ranked[0]

      if (!top) {
        problems.push({ heard, reason: 'no_item', candidates: [] })
        continue
      }
      const second = ranked[1]
      if (second && second.score === top.score && second.matched === top.matched) {
        const best = ranked.filter(r => r.score === top.score && r.matched === top.matched)
        problems.push({ heard, reason: 'ambiguous', candidates: best.map(r => r.item.name) })
        continue
      }
      if (!num || num.kind !== 'num') {
        problems.push({ heard, reason: 'no_quantity', candidates: [top.item.name] })
        continue
      }
      lines.push({ itemId: top.item.id, itemName: top.item.name, qty: num.value, heard })
    }
  }

  return { lines, problems }
}
