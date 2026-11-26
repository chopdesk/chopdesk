// lib/voice/parse.ts
// Turns what the phone heard ("jollof rice 300, beans fifty") into item + quantity lines.
// Pure functions only: no browser or database code, so it is easy to test and reuse
// for stock logging, closing counts and order taking.

export type VoiceMenuItem = {
  id: string
  name: string
  /** Set when this entry is a phrase the business taught for the item: it is matched instead of `name`, and more strictly. */
  matchText?: string
}

/** A phrase a business taught: when this is heard, it means this menu item. */
export type VoicePhrase = { itemId: string; phrase: string }

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

// taught phrases are exact by design (they are what the phone really wrote), so only forgive tiny slips in long words
function phraseWordsMatch(heard: string, target: string): boolean {
  const h = heard.replace(/s$/, '')
  const t = target.replace(/s$/, '')
  if (h === t) return true
  return t.length >= 6 && distance(h, t) <= 1
}

/** Adds each taught phrase as an extra way to say its menu item. Nothing here depends on what the menu contains. */
export function withPhrases(items: VoiceMenuItem[], phrases: VoicePhrase[]): VoiceMenuItem[] {
  const byId = new Map(items.map(i => [i.id, i]))
  const extra: VoiceMenuItem[] = []
  for (const p of phrases) {
    const item = byId.get(p.itemId)
    if (item) extra.push({ id: item.id, name: item.name, matchText: p.phrase })
  }
  return [...items, ...extra]
}

type Scored = { item: VoiceMenuItem; score: number; matched: number; used: Set<number> }

/** `blocked` are unit positions already claimed by an earlier mention in the same run of words. */
function matchItems(words: string[], items: VoiceMenuItem[], blocked: Set<number>): Scored[] {
  // single words first, then neighbours joined together ("nutri choco" can be one menu word, "NutriChoko")
  const units: { text: string; idx: number[] }[] = []
  words.forEach((w, i) => {
    if (!blocked.has(i)) units.push({ text: w, idx: [i] })
  })
  for (let i = 0; i < words.length - 1; i++) {
    if (blocked.has(i) || blocked.has(i + 1)) continue
    units.push({ text: (words[i] as string) + (words[i + 1] as string), idx: [i, i + 1] })
  }

  const scored: Scored[] = []
  for (const item of items) {
    const strict = item.matchText !== undefined
    const nameWords = normalizeWords(item.matchText ?? item.name).filter(w => w !== '|' && !NAME_STOP.has(w))
    if (nameWords.length === 0) continue
    const used = new Set<number>()
    let matched = 0
    for (const nw of nameWords) {
      const same = strict ? phraseWordsMatch : wordsMatch
      const hit = units.find(u => (u.idx.length === 1 || nw.length >= 7) && same(u.text, nw))
      if (hit) {
        matched++
        hit.idx.forEach(k => used.add(k))
      }
    }
    // a taught phrase counts only when every word of it was heard
    if (strict && matched < nameWords.length) continue
    const score = matched / nameWords.length
    if (matched >= 1 && score >= 0.5) scored.push({ item, score, matched, used })
  }
  // best score first; on a tie, the item that matched more words wins
  scored.sort((a, b) => b.score - a.score || b.matched - a.matched)

  // an item can match through its name and through taught phrases: keep only its best match
  const seen = new Set<string>()
  const best: Scored[] = []
  for (const r of scored) {
    if (seen.has(r.item.id)) continue
    seen.add(r.item.id)
    best.push(r)
  }
  return best
}

const isDisjoint = (a: Set<number>, b: Set<number>) => {
  for (const k of a) if (b.has(k)) return false
  return true
}

// words staff say around an item that are never part of one ("two plates of jollof, please")
const FILLER = new Set([
  'please', 'pls', 'plate', 'plates', 'portion', 'portions', 'scoop', 'scoops', 'pack', 'packs',
  'wrap', 'wraps', 'of', 'a', 'an', 'the', 'i', 'want', 'give', 'me', 'add', 'get', 'order',
  'x', 'naira', 'ok', 'okay', 'um', 'uh', 'er', 'hmm', 'thanks', 'thank', 'you', 'with', 'and',
])

type Num = { value: number; pos: number }
type Mention = {
  kind: 'known' | 'unknown'
  /** token positions this mention occupies */
  positions: number[]
  words: string[]
  item?: VoiceMenuItem
  /** more than one menu item fits these words equally well */
  candidates: string[]
}

// distance in tokens between a mention and a number (0 = right next to each other)
function gap(m: Mention, n: Num): number {
  let d = Infinity
  for (const p of m.positions) d = Math.min(d, Math.abs(p - n.pos))
  return Math.max(0, d - 1)
}

/**
 * Pairs mentions with numbers. Both lists are in spoken order and pairs never cross, so
 * "2 jollof 3 beans", "jollof 2 beans 3" and "2 jollof, chicken 3" all work with no rules to follow.
 * A known item beats an unrecognised word run; closer beats farther; ties follow the sentence's own style.
 */
function pairUp(mentions: Mention[], nums: Num[], numbersFirst: boolean): Map<number, number> {
  const M = mentions.length
  const N = nums.length
  const score = (m: Mention, n: Num): number => {
    const base = m.kind === 'known' ? 100 : 90
    const d = gap(m, n)
    // a number far from an item is probably not that item's number
    const bias = numbersFirst === (n.pos < (m.positions[0] as number)) ? 1 : 0
    return base - Math.min(d, 5) * 15 + bias
  }
  const dp: number[][] = Array.from({ length: M + 1 }, () => new Array<number>(N + 1).fill(0))
  for (let i = M - 1; i >= 0; i--) {
    for (let j = N - 1; j >= 0; j--) {
      const skipM = dp[i + 1]?.[j] as number
      const skipN = dp[i]?.[j + 1] as number
      const pairScore = score(mentions[i] as Mention, nums[j] as Num)
      const both = pairScore > 0 ? pairScore + (dp[i + 1]?.[j + 1] as number) : -Infinity
      ;(dp[i] as number[])[j] = Math.max(skipM, skipN, both)
    }
  }
  const out = new Map<number, number>()
  let i = 0
  let j = 0
  while (i < M && j < N) {
    const here = dp[i]?.[j] as number
    const pairScore = score(mentions[i] as Mention, nums[j] as Num)
    if (pairScore > 0 && here === pairScore + (dp[i + 1]?.[j + 1] as number)) {
      out.set(i, j)
      i++
      j++
    } else if (here === (dp[i + 1]?.[j] as number)) i++
    else j++
  }
  return out
}

export type VoiceParseOptions = {
  /** Orders: an item said with no number means one. Stock counts leave this off, so a missing number is asked about. */
  assumeOne?: boolean
}

/**
 * Parses a spoken sentence into item + quantity lines.
 * It finds every menu item and every number in the sentence, then pairs them by closeness and order,
 * so staff can say things in any natural order. Anything it cannot place is returned in `problems`.
 * If the same item is heard twice, both lines are returned; the caller decides
 * whether the later one replaces the earlier (stock) or adds to it (orders).
 */
export function parseVoiceLines(
  transcript: string,
  menu: VoiceMenuItem[],
  phrases: VoicePhrase[] = [],
  options: VoiceParseOptions = {}
): VoiceParseResult {
  const items = withPhrases(menu, phrases)
  const toks = tokenize(transcript)
  const lines: VoiceLine[] = []
  const problems: VoiceProblem[] = []

  // 1. numbers, and runs of words between numbers / commas
  const nums: Num[] = []
  const runs: { text: string; pos: number }[][] = [[]]
  toks.forEach((t, pos) => {
    if (t.kind === 'num') {
      nums.push({ value: t.value, pos })
      runs.push([])
    } else if (t.kind === 'sep') runs.push([])
    else (runs[runs.length - 1] as { text: string; pos: number }[]).push({ text: t.text, pos })
  })

  // 2. menu items heard in each run (a run can hold several: "jollof rice beans")
  const known: Mention[] = []
  const claimed = new Set<number>() // token positions that belong to a menu item
  const runLeft: { text: string; pos: number }[][] = []
  for (const run of runs) {
    const texts = run.map(w => w.text)
    const blocked = new Set<number>()
    while (true) {
      const ranked = matchItems(texts, items, blocked)
      const top = ranked[0]
      if (!top) break
      // equally good matches that share words with the best one ("rice" fits Jollof Rice and Fried Rice)
      const ties = ranked.slice(1).filter(r => r.score === top.score && r.matched === top.matched && !isDisjoint(r.used, top.used))
      const idx = [...top.used].sort((a, b) => a - b)
      known.push({
        kind: 'known',
        positions: idx.map(k => (run[k] as { pos: number }).pos),
        words: idx.map(k => texts[k] as string),
        item: top.item,
        candidates: ties.length > 0 ? [top.item.name, ...ties.map(r => r.item.name)] : [],
      })
      idx.forEach(k => {
        blocked.add(k)
        claimed.add((run[k] as { pos: number }).pos)
      })
    }
    runLeft.push(run.filter((_, k) => !blocked.has(k)))
  }
  known.sort((a, b) => (a.positions[0] as number) - (b.positions[0] as number))

  // 3. words nobody recognised (a misheard item name), kept in order so a number can still find its owner
  const unknown: Mention[] = []
  for (const left of runLeft) {
    let cur: { text: string; pos: number }[] = []
    const flush = () => {
      const real = cur.filter(w => !FILLER.has(w.text) && !has(HOMOPHONES, w.text))
      if (real.length > 0) unknown.push({ kind: 'unknown', positions: real.map(w => w.pos), words: real.map(w => w.text), candidates: [] })
      cur = []
    }
    let prevPos = -2
    for (const w of left) {
      if (w.pos !== prevPos + 1 && cur.length > 0) flush() // a known item sat in between
      cur.push(w)
      prevPos = w.pos
    }
    flush()
  }

  // 4. pair every number with the item it belongs to
  const mentions = [...known, ...unknown].sort((a, b) => (a.positions[0] as number) - (b.positions[0] as number))
  const numbersFirst = toks[0]?.kind === 'num'
  const pairs = pairUp(mentions, nums, numbersFirst)

  // 5. "Ewa for scoop" means "Ewa four scoops": use look-alike words only for an item still missing its number
  const homophones = toks
    .map((t, pos) => ({ t, pos }))
    .filter(x => x.t.kind === 'word' && has(HOMOPHONES, x.t.text) && !claimed.has(x.pos))
  const homoUsed = new Set<number>()

  mentions.forEach((m, mi) => {
    const nj = pairs.get(mi)
    let qty: number | null = nj !== undefined ? (nums[nj] as Num).value : null
    if (qty === null && m.kind === 'known') {
      let best: { pos: number; value: number; d: number } | null = null
      for (const h of homophones) {
        if (homoUsed.has(h.pos)) continue
        const d = gap(m, { value: 0, pos: h.pos })
        if (d <= 2 && (!best || d < best.d)) best = { pos: h.pos, value: HOMOPHONES[(h.t as { text: string }).text] as number, d }
      }
      if (best) {
        homoUsed.add(best.pos)
        qty = best.value
      }
    }

    const heard = m.words.join(' ')
    if (m.kind === 'unknown') {
      if (nj !== undefined) problems.push({ heard, reason: 'no_item', candidates: [] })
      return
    }
    const item = m.item as VoiceMenuItem
    if (m.candidates.length > 0) {
      problems.push({ heard, reason: 'ambiguous', candidates: m.candidates })
      return
    }
    if (qty === null && options.assumeOne) qty = 1
    if (qty === null) problems.push({ heard, reason: 'no_quantity', candidates: [item.name] })
    else lines.push({ itemId: item.id, itemName: item.name, qty, heard })
  })

  // 6. nothing made sense: say what was heard, so the screen can offer to teach it
  if (lines.length === 0 && problems.length === 0) {
    const stray = unknown.map(u => u.words.join(' ')).join(' ')
    const heard = stray || toks.map(t => (t.kind === 'word' ? t.text : t.kind === 'num' ? String(t.value) : '')).join(' ').trim()
    if (heard) problems.push({ heard, reason: 'no_item', candidates: [] })
  }

  return { lines, problems }
}