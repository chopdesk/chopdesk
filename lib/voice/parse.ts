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
  reason: 'no_item' | 'no_quantity' | 'ambiguous' | 'multiple_items'
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

// Chrome often writes a spoken number as a look-alike word ("Ewa for scoop" = "Ewa four scoops").
// Only used when no real number was heard next to an item.
const HOMOPHONES: Record<string, number> = {
  for: 4, fore: 4, to: 2, too: 2, won: 1, wan: 1, warm: 1, ate: 8,
}

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

type Scored = { item: VoiceMenuItem; score: number; matched: number; used: Set<number> }

function matchItems(words: string[], items: VoiceMenuItem[]): Scored[] {
  // single words first, then neighbours joined together ("nutri choco" can be one menu word, "NutriChoko")
  const units: { text: string; idx: number[] }[] = words.map((w, i) => ({ text: w, idx: [i] }))
  for (let i = 0; i < words.length - 1; i++) {
    units.push({ text: (words[i] as string) + (words[i + 1] as string), idx: [i, i + 1] })
  }

  const scored: Scored[] = []
  for (const item of items) {
    const nameWords = normalizeWords(item.name).filter(w => w !== '|' && !NAME_STOP.has(w))
    if (nameWords.length === 0) continue
    const used = new Set<number>()
    let matched = 0
    for (const nw of nameWords) {
      const hit = units.find(u => (u.idx.length === 1 || nw.length >= 7) && wordsMatch(u.text, nw))
      if (hit) {
        matched++
        hit.idx.forEach(k => used.add(k))
      }
    }
    const score = matched / nameWords.length
    if (matched >= 1 && score >= 0.5) scored.push({ item, score, matched, used })
  }
  // best score first; on a tie, the item that matched more words wins
  return scored.sort((a, b) => b.score - a.score || b.matched - a.matched)
}

const isDisjoint = (a: Set<number>, b: Set<number>) => {
  for (const k of a) if (b.has(k)) return false
  return true
}

type Evaluated = { line?: VoiceLine; problem?: VoiceProblem }

// Understands one chunk of speech: one item and one number. Never guesses when unsure.
function evaluateChunk(chunk: Tok[], items: VoiceMenuItem[]): Evaluated | null {
  const words = chunk.flatMap(t => (t.kind === 'word' ? [t.text] : []))
  const num = chunk.find(t => t.kind === 'num')
  if (words.length === 0 && !num) return null

  const heard = chunk.map(t => (t.kind === 'word' ? t.text : t.kind === 'num' ? String(t.value) : '')).join(' ')
  const ranked = matchItems(words, items)
  const top = ranked[0]
  if (!top) return { problem: { heard, reason: 'no_item', candidates: [] } }

  // two different foods in one chunk but only one number: do not pick one silently
  const others = ranked.slice(1)
  const disjoint = others.filter(r => isDisjoint(r.used, top.used))
  if (disjoint.length > 0) {
    return {
      problem: { heard, reason: 'multiple_items', candidates: [top, ...disjoint].map(r => r.item.name) },
    }
  }
  // two menu items that match equally well (for example "rice" with Jollof Rice and Fried Rice)
  const ties = others.filter(r => r.score === top.score && r.matched === top.matched)
  if (ties.length > 0) {
    return { problem: { heard, reason: 'ambiguous', candidates: [top, ...ties].map(r => r.item.name) } }
  }

  let qty: number | null = num && num.kind === 'num' ? num.value : null
  if (qty === null) {
    const idx = words.findIndex((w, i) => has(HOMOPHONES, w) && !top.used.has(i))
    if (idx >= 0) qty = HOMOPHONES[words[idx] as string] as number
  }
  if (qty === null) return { problem: { heard, reason: 'no_quantity', candidates: [top.item.name] } }

  return { line: { itemId: top.item.id, itemName: top.item.name, qty, heard } }
}

function splitSegment(seg: Tok[], direction: 'item-first' | 'number-first'): Tok[][] {
  const nums = seg.filter(t => t.kind === 'num').length
  if (nums <= 1) return [seg]
  const chunks: Tok[][] = []
  let cur: Tok[] = []
  for (const t of seg) {
    if (direction === 'number-first') {
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

function evaluateAll(chunks: Tok[][], items: VoiceMenuItem[]): Evaluated[] {
  return chunks.flatMap(c => {
    const r = evaluateChunk(c, items)
    return r ? [r] : []
  })
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
    // "jollof 300 beans 50" (item then number) or "2 jollof 1 chicken" (number then item):
    // try both readings and keep the one that understands more
    const itemFirst = evaluateAll(splitSegment(seg, 'item-first'), items)
    const numberFirst = evaluateAll(splitSegment(seg, 'number-first'), items)
    const countLines = (r: Evaluated[]) => r.filter(e => e.line).length
    let chosen = itemFirst
    if (countLines(numberFirst) > countLines(itemFirst)) chosen = numberFirst
    else if (countLines(numberFirst) === countLines(itemFirst) && seg[0]?.kind === 'num') chosen = numberFirst

    for (const e of chosen) {
      if (e.line) lines.push(e.line)
      if (e.problem) problems.push(e.problem)
    }
  }

  return { lines, problems }
}
