'use client'

// components/VoiceCountMic.tsx
// The voice assistant for Shift start (opening stock) and Close Shift (the count).
// Staff say "jollof rice 30, fish 20" and the numbers fill the page's boxes. Saying an item again REPLACES
// its number (this is a count, not an order). A missing number is asked about, never assumed.
// Counts stay blind: this component only ever receives what staff typed or said, never the expected stock.
// It never starts or closes the shift: staff tap that button by hand.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { parseBest, type Guess } from '@/lib/voice/best'
import { parseVoiceLines, type VoicePhrase, type VoiceProblem } from '@/lib/voice/parse'
import { RECOGNIZER_ERRORS, useRecognizer } from '@/lib/voice/useRecognizer'
import { promoteLearned, type LearningRow } from '@/lib/voice/learned'
import { useSpeaker } from '@/lib/voice/speak'
import VoiceOverlay, { type VoiceState } from '@/components/VoiceOverlay'
import { Mic, Square, X } from 'lucide-react'

type ItemLite = { id: string; name: string }

type Props = {
  /** 'shift' = opening stock when a shift starts, 'close' = the count when it ends */
  mode: 'shift' | 'close'
  items: ItemLite[]
  /** what is in the page's boxes now (item id -> text) */
  values: Record<string, string>
  /** put a number in the page's box for this item */
  onSet: (itemId: string, qty: number) => void
}

type Option = { itemId: string; name: string }
type Note = {
  key: number
  kind: 'qty' | 'pick'
  itemId: string | null
  itemName: string
  heard: string
  canPick: boolean
  text: string
  qty: number | null
  options: Option[]
}

// the whole sentence means "I am finished"
const DONE = /^(done|i am done|im done|i m done|finish|finished|that is all|that s all|thats all|all done|no more|stop|close|end)$/

const isCount = (v: string | undefined) => v !== undefined && /^\d+$/.test(v.trim())

// "jollof 12 left" -> "jollof 12" and "fish none / finished / empty" -> "fish zero"
const prep = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(left|remaining|remain)\b/g, ' ')
    .replace(/\b(none|nothing|nil|finished|empty)\b/g, 'zero')

const cleanWords = (text: string) => text.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

function QtyAsk({ onSubmit }: { onSubmit: (n: number) => void }) {
  const [v, setV] = useState('')
  const ok = /^\d+$/.test(v.trim())
  const send = () => {
    if (ok) onSubmit(parseInt(v.trim(), 10))
  }
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        min="0"
        value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            send()
          }
        }}
        placeholder="Number"
        className="input-base w-28"
      />
      <button type="button" onClick={send} disabled={!ok} className="btn-primary press px-4 py-2 text-sm disabled:opacity-50">
        OK
      </button>
    </div>
  )
}

export default function VoiceCountMic({ mode, items, values, onSet }: Props) {
  const [taught, setTaught] = useState<VoicePhrase[]>([])
  const [learning, setLearning] = useState<LearningRow[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [status, setStatus] = useState('')
  const [pickKey, setPickKey] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [flash, setFlash] = useState<'ok' | 'maybe' | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextKey = useRef(1)
  const speaker = useSpeaker()

  // latest copies, so the spoken answer never works from an old screen
  const valuesRef = useRef(values)
  valuesRef.current = values
  const notesRef = useRef(notes)
  notesRef.current = notes

  const phrases = useMemo(() => [...taught, ...promoteLearned(learning, taught)], [taught, learning])

  useEffect(() => {
    setMounted(true)
    supabase
      .from('voice_phrases')
      .select('item_id, phrase')
      .then(({ data, error }) => {
        if (error) return
        setTaught((data || []).map((r: { item_id: string; phrase: string }) => ({ itemId: r.item_id, phrase: r.phrase })))
      })
    supabase
      .from('voice_learning')
      .select('item_id, phrase, confirmed, corrected')
      .then(({ data, error }) => {
        if (error) return
        setLearning(
          (data || []).map((r: { item_id: string; phrase: string; confirmed: number; corrected: number }) => ({
            itemId: r.item_id,
            phrase: r.phrase,
            confirmed: r.confirmed,
            corrected: r.corrected,
          }))
        )
      })
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [])

  const showFlash = (kind: 'ok' | 'maybe') => {
    setFlash(kind)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1100)
  }

  const buzz = () => {
    try {
      navigator.vibrate?.(30)
    } catch {
      // some phones do not allow it: not important
    }
  }

  const nameOf = (id: string) => items.find(i => i.id === id)?.name ?? 'that item'

  // put a number in the page, and remember it right away so the next step sees it
  const setCount = (itemId: string, qty: number) => {
    valuesRef.current = { ...valuesRef.current, [itemId]: String(qty) }
    onSet(itemId, qty)
  }

  const missingNow = () => items.filter(i => !isCount(valuesRef.current[i.id])).length

  // what the assistant says after a number was taken, and whether it should keep listening
  const tail = (): { text: string; more: boolean } => {
    if (mode === 'close') {
      const m = missingNow()
      if (m === 0) return { text: 'Everything is counted. Tap Close Shift when you are ready.', more: false }
      return { text: m === 1 ? '1 left to count.' : `${m} left to count.`, more: true }
    }
    return { text: 'Say more, or say done.', more: true }
  }

  const qtyNote = (itemId: string, heard: string): Note => ({
    key: nextKey.current++,
    kind: 'qty',
    itemId,
    itemName: nameOf(itemId),
    heard,
    canPick: false,
    text: `How many ${nameOf(itemId)}?`,
    qty: null,
    options: [],
  })

  const noteFor = (p: VoiceProblem): Note => {
    const qty = p.qty !== undefined && p.qty !== null && p.qty >= 0 ? p.qty : null
    const base = { key: nextKey.current++, kind: 'pick' as const, itemId: null, itemName: '', heard: p.heard, qty }
    if (p.reason === 'no_item') {
      const options = (p.suggestions || []).map(s => ({ itemId: s.itemId, name: s.name }))
      return {
        ...base,
        canPick: true,
        options,
        text: options.length > 0 ? `"${p.heard}". Did you mean:` : `"${p.heard}" is not on this list.`,
      }
    }
    if (p.reason === 'ambiguous') {
      const names = Array.from(new Set(p.candidates))
      const options = names.flatMap(n => items.filter(m => m.name === n).slice(0, 1).map(m => ({ itemId: m.id, name: m.name })))
      return { ...base, canPick: false, options, text: `"${p.heard}". Which one?` }
    }
    return { ...base, canPick: false, options: [], text: 'Say each item with its own number, one by one.' }
  }

  const listenAgain = () => {
    setFlash(null)
    start()
  }

  const handleFinal = (guesses: Guess[]) => {
    const raw = guesses.map(g => cleanWords(g.transcript))

    // 1) "done"
    if (raw.some(t => DONE.test(t))) {
      closeAssistant()
      return
    }

    const prepped: Guess[] = guesses.map(g => ({ ...g, transcript: prep(g.transcript) }))

    // 2) only a number, while the assistant is waiting for one ("How many Beans?" ... "twelve")
    const waiting = [...notesRef.current].reverse().find(n => n.kind === 'qty' && n.itemId)
    if (waiting && waiting.itemId) {
      for (const g of prepped) {
        const r = parseVoiceLines(`qq ${g.transcript}`, [{ id: '__n', name: 'qq' }])
        const only = r.lines[0]
        if (r.lines.length === 1 && r.problems.length === 0 && only) {
          setCount(waiting.itemId, only.qty)
          setNotes(prev => prev.filter(n => n.key !== waiting.key))
          setStatus(`${waiting.itemName}: ${only.qty}`)
          showFlash('ok')
          buzz()
          const left = notesRef.current.filter(n => n.key !== waiting.key)
          const next = left.find(n => n.kind === 'qty')
          if (next) speaker.say(`${waiting.itemName} ${only.qty}. How many ${next.itemName}?`, listenAgain)
          else {
            const t = tail()
            speaker.say(`${waiting.itemName} ${only.qty}. ${t.text}`, t.more && left.length === 0 ? listenAgain : undefined)
          }
          return
        }
      }
    }

    // 3) items with numbers (a missing number is asked about, never assumed)
    const best = parseBest(prepped, items, phrases)
    if (!best) {
      setStatus('I did not catch that. Try again.')
      setThinking(false)
      showFlash('maybe')
      speaker.say('I did not catch that. Try again.', listenAgain)
      return
    }
    const { lines, problems } = best.result

    // keep the sentence (text only) so the app can learn from it later; never blocks the work
    const session = getSession()
    if (session) {
      supabase
        .rpc('log_voice_utterance', {
          p_org: session.org_id,
          p_source: mode,
          p_heard: best.heard,
          p_alternatives: prepped.map(g => g.transcript).filter(t => t !== best.heard),
          p_understood: lines.map(l => ({ item_id: l.itemId, qty: l.qty })),
        })
        .then(
          () => undefined,
          () => undefined
        )
    }

    // the last number said for an item wins
    const final = new Map<string, number>()
    for (const l of lines) final.set(l.itemId, l.qty)
    for (const [id, qty] of final) setCount(id, qty)
    const applied = Array.from(final, ([id, qty]) => `${nameOf(id)} ${qty}`)

    // questions: no number heard, or a word the app is not sure about
    const fresh: Note[] = problems.map(p => {
      if (p.reason === 'no_quantity') {
        const hit = items.find(i => i.name === p.candidates[0])
        if (hit) return qtyNote(hit.id, p.heard)
      }
      return noteFor(p)
    })
    setNotes(prev => [...fresh, ...prev].slice(0, 6))
    setThinking(false)
    setStatus(applied.length > 0 ? applied.join(', ') : `Heard "${best.heard}"`)
    showFlash(applied.length > 0 ? 'ok' : 'maybe')
    if (applied.length > 0) buzz()

    // 4) the assistant says back what it did
    const gotIt = applied.length > 0 ? `Got it. ${applied.join(', ')}. ` : ''
    const ask = fresh.find(n => n.kind === 'qty')
    if (ask) {
      speaker.say(`${gotIt}How many ${ask.itemName}?`, listenAgain)
    } else if (fresh.length > 0) {
      speaker.say(`${gotIt}I am not sure about one word. Please check the choices.`)
    } else if (applied.length > 0) {
      const t = tail()
      speaker.say(`${gotIt}${t.text}`, t.more ? listenAgain : undefined)
    } else {
      speaker.say('Nothing matched the list. Try again.', listenAgain)
    }
  }

  const { supported, listening, interim, error, start, stop } = useRecognizer({
    lang: 'en-NG',
    onFinal: handleFinal,
  })

  // when the words stop changing for a moment, the phone is working out the sentence: show "thinking"
  useEffect(() => {
    if (!listening || !interim) {
      setThinking(false)
      return
    }
    setThinking(false)
    const t = setTimeout(() => setThinking(true), 700)
    return () => clearTimeout(t)
  }, [interim, listening])

  const press = () => {
    speaker.cancel()
    setFlash(null)
    if (listening) stop()
    else start()
  }

  const openAndListen = () => {
    setStatus('')
    setNotes([])
    setOpen(true)
    press()
  }

  const closeAssistant = () => {
    speaker.cancel()
    if (listening) stop()
    setOpen(false)
    setNotes([])
    setPickKey(null)
    setQuery('')
    setFlash(null)
  }

  // staff answered a "which one" or "how many" question with a tap
  const answerQty = (note: Note, n: number) => {
    if (!note.itemId) return
    setCount(note.itemId, n)
    setNotes(prev => prev.filter(x => x.key !== note.key))
    setStatus(`${note.itemName}: ${n}`)
    buzz()
    const left = notesRef.current.filter(x => x.key !== note.key)
    const next = left.find(x => x.kind === 'qty')
    if (next) speaker.say(`${note.itemName} ${n}. How many ${next.itemName}?`, listenAgain)
    else if (left.length === 0) {
      const t = tail()
      speaker.say(`${note.itemName} ${n}. ${t.text}`, t.more ? listenAgain : undefined)
    }
  }

  const choose = (note: Note, opt: Option) => {
    if (note.qty !== null) {
      setCount(opt.itemId, note.qty)
      setNotes(prev => prev.filter(n => n.key !== note.key))
      setStatus(`${opt.name}: ${note.qty}`)
      buzz()
      const left = notesRef.current.filter(n => n.key !== note.key)
      if (left.length === 0) {
        const t = tail()
        speaker.say(`${opt.name} ${note.qty}. ${t.text}`, t.more ? listenAgain : undefined)
      }
    } else {
      // no number was said with it: ask for it
      const ask = qtyNote(opt.itemId, note.heard)
      setNotes(prev => prev.map(n => (n.key === note.key ? ask : n)))
      speaker.say(`How many ${opt.name}?`, listenAgain)
    }
  }

  const dismiss = (key: number) => {
    setNotes(prev => prev.filter(n => n.key !== key))
    if (pickKey === key) setPickKey(null)
  }

  // staff picked an item for words the app did not know: use it, and remember the words for this business
  const pickFromMenu = async (note: Note, opt: Option) => {
    choose(note, opt)
    setPickKey(null)
    setQuery('')
    const phrase = cleanWords(note.heard)
    if (!/^[a-z]+( [a-z]+)*$/.test(phrase) || phrase.length < 2 || phrase.length > 60) return
    const { error: err } = await supabase.rpc('teach_voice_phrase', { p_item_id: opt.itemId, p_phrase: phrase })
    if (err) return
    setTaught(prev => [...prev.filter(x => x.phrase !== phrase), { itemId: opt.itemId, phrase }])
  }

  if (supported === false) return null

  const counted = items.filter(i => isCount(values[i.id]))
  const missing = items.filter(i => !isCount(values[i.id]))

  const vstate: VoiceState = listening ? (thinking ? 'thinking' : 'listening') : flash ?? 'idle'

  const bigText = listening
    ? thinking
      ? 'Working on it…'
      : interim || "I'm listening…"
    : status ||
      (mode === 'close'
        ? 'Say each item and how many are left, for example "jollof rice 12, fish 5"'
        : 'Say each item and how many were cooked, for example "jollof rice 30, fish 20"')

  const hint = listening ? 'Listening. Say "done" when you finish' : 'Tap the mic to speak. Say "done" when you finish'

  const shownError = error === RECOGNIZER_ERRORS['no-speech'] ? '' : error

  return (
    <>
      {mounted &&
        !open &&
        createPortal(
          <div className="fixed right-4 z-[25] bottom-[calc(var(--bottom-nav-h)+104px)] md:bottom-28">
            <button
              type="button"
              onClick={openAndListen}
              aria-label={mode === 'close' ? 'Say the stock count' : 'Say the opening stock'}
              className="press flex h-16 w-16 min-h-0 min-w-0 items-center justify-center rounded-full bg-primary text-white shadow-xl"
            >
              <Mic size={28} />
            </button>
          </div>,
          document.body
        )}

      <VoiceOverlay
        open={open}
        state={vstate}
        level={null}
        pulse={interim.length}
        text={bigText}
        hint={hint}
        error={shownError}
        sound={speaker.on}
        onToggleSound={speaker.toggle}
        onMic={press}
        onClose={closeAssistant}
        micIcon={listening ? <Square size={26} /> : <Mic size={30} />}
      >
        {notes.length > 0 && (
          <div className="space-y-2">
            {notes.map(note => (
              <div key={note.key} className="flex items-start gap-2 rounded-xl bg-accent/10 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="t-small text-text-primary">{note.text}</p>
                  {note.kind === 'qty' && <QtyAsk onSubmit={n => answerQty(note, n)} />}
                  {note.options.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {note.options.map(opt => (
                        <button
                          key={opt.itemId}
                          type="button"
                          onClick={() => choose(note, opt)}
                          className="press rounded-full border border-primary bg-white px-4 py-2 text-sm font-medium text-primary"
                        >
                          {note.qty !== null ? `${opt.name}: ${note.qty}` : opt.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {note.canPick && pickKey !== note.key && (
                    <button
                      type="button"
                      onClick={() => {
                        setPickKey(note.key)
                        setQuery('')
                      }}
                      className="press mt-2 text-sm font-medium text-primary underline"
                    >
                      Pick from list
                    </button>
                  )}
                  {pickKey === note.key && (
                    <div className="mt-2">
                      <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search the list"
                        className="input-base"
                      />
                      <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-border bg-white">
                        {items
                          .filter(m => m.name.toLowerCase().includes(query.trim().toLowerCase()))
                          .slice(0, 30)
                          .map(m => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => void pickFromMenu(note, { itemId: m.id, name: m.name })}
                              className="press press-flat block min-h-0 w-full border-b border-border px-3 py-2.5 text-left text-sm last:border-b-0"
                            >
                              {m.name}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(note.key)}
                  aria-label="Dismiss"
                  className="press flex h-8 w-8 min-h-0 min-w-0 flex-shrink-0 items-center justify-center rounded-full text-text-muted"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-baseline justify-between">
            <p className="t-body font-semibold text-text-primary">{mode === 'close' ? 'Your count' : 'Opening stock'}</p>
            <p className="t-small text-text-secondary">
              {counted.length} of {items.length}
            </p>
          </div>
          {counted.length > 0 && (
            <ul className="mt-2 space-y-1">
              {counted.map(i => (
                <li key={i.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-text-primary">{i.name}</span>
                  <span className="font-medium text-primary">{values[i.id]}</span>
                </li>
              ))}
            </ul>
          )}
          {mode === 'close' && missing.length > 0 && (
            <p className="t-small mt-2 border-t border-gray-100 pt-2 text-text-secondary">
              Still to count: {missing.map(i => i.name).join(', ')}
            </p>
          )}
          {mode === 'shift' && counted.length === 0 && (
            <p className="t-small mt-2 text-text-secondary">Anything you do not say stays at 0.</p>
          )}
        </div>
      </VoiceOverlay>
    </>
  )
}
