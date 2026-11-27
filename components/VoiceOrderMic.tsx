'use client'

// components/VoiceOrderMic.tsx
// The voice assistant for the Orders screen.
// A round mic button sits at the bottom right (easy for the thumb). Tapping it, or saying "Hey Chopdesk",
// opens a full-screen assistant. Staff say an order ("2 jollof, ewa agoyin 3") and it is ADDED to the cart.
// Things the app is not sure about never block the order: they show as small tap-to-confirm choices.
// The page's own controls (filters, menu, cart) are passed in as children and are always usable.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { parseBest, type Guess } from '@/lib/voice/best'
import { useRecognizer } from '@/lib/voice/useRecognizer'
import { promoteLearned, learnedCounts, type LearningRow } from '@/lib/voice/learned'
import { byPopularity, popularityFromOrders, rerank, type Popularity } from '@/lib/voice/rank'
import { addVoiceMarks, tagVoiceMarks, type VoiceMark } from '@/lib/voice/feedback'
import type { VoicePhrase, VoiceProblem } from '@/lib/voice/parse'
import VoiceOverlay, { type VoiceState } from '@/components/VoiceOverlay'
import { useWakeRecognizer } from '@/lib/voice/useWakeRecognizer'
import { Mic, Radio, Square, X } from 'lucide-react'

type MenuLite = { id: string; name: string }
export type VoiceAdded = { itemId: string; name: string; qty: number }

type Props = {
  menu: MenuLite[]
  /** Puts items in the cart. Returns what was really added (stock may cut a number down or block it). */
  onAdd: (lines: { itemId: string; qty: number }[]) => VoiceAdded[]
  /** true while the phone cart bar is showing, so the mic button sits above it */
  lift?: boolean
  /** The page's own controls (the filter row). Always shown, always usable. */
  children?: ReactNode
}

type Option = { itemId: string; name: string }
type Note = { key: number; batch: number; heard: string; canPick: boolean; text: string; qty: number; options: Option[] }

export default function VoiceOrderMic({ menu, onAdd, lift = false, children }: Props) {
  const [taught, setTaught] = useState<VoicePhrase[]>([])
  const [learning, setLearning] = useState<LearningRow[]>([])
  const [popularity, setPopularity] = useState<Popularity>({})
  const [notes, setNotes] = useState<Note[]>([])
  const [status, setStatus] = useState('')
  const [pickKey, setPickKey] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [mounted, setMounted] = useState(false)
  // the full-screen assistant
  const [open, setOpen] = useState(false)
  // "thinking" = waiting for the phone to hand over the sentence; flash = brief result colour
  const [thinking, setThinking] = useState(false)
  const [flash, setFlash] = useState<'ok' | 'maybe' | null>(null)
  // live loudness needs a second microphone stream, which some phones do not allow while listening.
  // It is off unless you open the page once with ?meter=1 (turn it off again with ?meter=0).
  const [meter, setMeter] = useState(false)
  // hands-free ("Hey Chopdesk"): off until someone turns it on, and remembered on this phone only
  const [wakeOn, setWakeOn] = useState(false)
  const [wakePaused, setWakePaused] = useState(false)
  const [wakeNotice, setWakeNotice] = useState(false)
  const [wakeMsg, setWakeMsg] = useState('')
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextKey = useRef(1)
  // id of the newest logged sentence; the learning step will use it later
  const lastLogId = useRef<string | null>(null)
  // sentence group -> saved sentence id, so marks made before the id arrived can still be tagged
  const batchIds = useRef(new Map<number, string>())

  // phrases staff taught by hand, plus phrases the app learned and staff backed enough times
  const phrases = useMemo(() => [...taught, ...promoteLearned(learning, taught)], [taught, learning])

  useEffect(() => {
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

    // what this kitchen sold lately: helps settle close calls, like a map app preferring busy places
    supabase
      .from('orders')
      .select('items_json')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) return
        setPopularity(popularityFromOrders((data || []).map((r: { items_json: unknown }) => r.items_json)))
      })
  }, [])

  useEffect(() => {
    setMounted(true)
    try {
      const q = new URLSearchParams(window.location.search).get('meter')
      if (q === '1') localStorage.setItem('voice_meter', '1')
      if (q === '0') localStorage.removeItem('voice_meter')
      setMeter(localStorage.getItem('voice_meter') === '1')
      setWakeOn(localStorage.getItem('voice_wake') === '1')
    } catch {
      // storage blocked: the meter simply stays off
    }
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
      if (pressTimer.current) clearTimeout(pressTimer.current)
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  const showFlash = (kind: 'ok' | 'maybe') => {
    setFlash(kind)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1100)
  }

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }

  // a clean order closes the assistant by itself, so staff are back on the menu
  const closeSoon = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 1500)
  }

  const cleanWords = (text: string) => text.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

  const buzz = () => {
    try {
      navigator.vibrate?.(30)
    } catch {
      // some phones do not allow it: not important
    }
  }

  const noteFor = (p: VoiceProblem, batch: number): Note => {
    const qty = p.qty && p.qty > 0 ? p.qty : 1
    if (p.reason === 'no_item') {
      const ranked = rerank(p.suggestions || [], popularity, learnedCounts(learning, cleanWords(p.heard)))
      const options = ranked.map(s => ({ itemId: s.itemId, name: s.name }))
      return {
        key: nextKey.current++,
        batch,
        heard: p.heard,
        canPick: true,
        qty,
        options,
        text: options.length > 0 ? `"${p.heard}". Did you mean:` : `"${p.heard}" is not on the menu.`,
      }
    }
    if (p.reason === 'ambiguous') {
      const names = Array.from(new Set(p.candidates))
      const found = names.flatMap(n => menu.filter(m => m.name === n).slice(0, 1).map(m => ({ itemId: m.id, name: m.name })))
      const options = byPopularity(found, popularity) // best sellers first
      return { key: nextKey.current++, batch, heard: p.heard, canPick: false, qty, options, text: `"${p.heard}". Which one?` }
    }
    if (p.reason === 'multiple_items') {
      return { key: nextKey.current++, batch, heard: p.heard, canPick: false, qty, options: [], text: 'Say each item with its own number, one by one.' }
    }
    return { key: nextKey.current++, batch, heard: p.heard, canPick: false, qty, options: [], text: `How many ${p.candidates[0] ?? 'of that'}?` }
  }

  const handleFinal = (guesses: Guess[]) => {
    const best = parseBest(guesses, menu, phrases, { assumeOne: true })
    if (!best) {
      setStatus('I did not catch that. Tap the mic and try again.')
      setThinking(false)
      showFlash('maybe')
      return
    }
    const { lines, problems } = best.result
    const batch = Date.now()

    // keep the sentence (text only) so the app can learn from it later; never blocks the order
    const session = getSession()
    if (session) {
      supabase
        .rpc('log_voice_utterance', {
          p_org: session.org_id,
          p_source: 'orders',
          p_heard: best.heard,
          p_alternatives: guesses.map(g => g.transcript).filter(t => t !== best.heard),
          p_understood: lines.map(l => ({ item_id: l.itemId, qty: l.qty })),
        })
        .then(
          ({ data }) => {
            if (typeof data === 'string') {
              lastLogId.current = data
              batchIds.current.set(batch, data)
              tagVoiceMarks(batch, data)
            }
          },
          () => undefined
        )
    }

    let line = `Heard: "${best.heard}"`
    let understood = false
    if (lines.length > 0) {
      const added = onAdd(lines.map(l => ({ itemId: l.itemId, qty: l.qty })))
      // evidence for later: if this item is still in the order when it is paid, the app understood correctly
      const marks: VoiceMark[] = []
      for (const l of lines) {
        const phrase = cleanWords(l.heard)
        if (phrase.length >= 2 && phrase !== cleanWords(l.itemName) && added.some(a => a.itemId === l.itemId)) {
          marks.push({ itemId: l.itemId, phrase, kind: 'confirmed', batch, uid: batchIds.current.get(batch) ?? null })
        }
      }
      addVoiceMarks(marks)
      if (added.length > 0) {
        line = `Added ${added.map(a => `${a.qty} × ${a.name}`).join(', ')}`
        buzz()
        understood = true
      }
    } else if (problems.length === 0) {
      line = `Heard "${best.heard}". Nothing matched the menu.`
    }
    setStatus(line)
    setThinking(false)
    showFlash(understood ? 'ok' : 'maybe')
    setNotes(prev => [...problems.map(p => noteFor(p, batch)), ...prev].slice(0, 4))
    if (understood && problems.length === 0) closeSoon()
    else cancelClose()
  }

  const { supported, listening, interim, error, level, start, stop } = useRecognizer({
    lang: 'en-NG',
    onFinal: handleFinal,
    withLevel: meter,
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

  // hands-free: listens for "Hey Chopdesk" while this screen is open. It pauses while the mic button is used.
  const wake = useWakeRecognizer({
    enabled: wakeOn && !wakePaused && supported !== false,
    lang: 'en-NG',
    onWake: () => {
      cancelClose()
      setFlash(null)
      setWakeMsg('')
      setOpen(true)
      buzz()
    },
    onSleep: () => {
      setStatus('')
      setOpen(false)
    },
    onCommand: text => {
      setOpen(true)
      handleFinal([{ transcript: text, confidence: 1 }])
    },
    onFatal: message => {
      setWakeOn(false)
      setWakeMsg(message)
      try {
        localStorage.removeItem('voice_wake')
      } catch {
        // ignore
      }
    },
  })

  // after the mic button was used, hands-free comes back a moment after the listening ends
  useEffect(() => {
    if (!wakePaused || listening) return
    const t = setTimeout(() => setWakePaused(false), 1200)
    return () => clearTimeout(t)
  }, [wakePaused, listening])

  const turnWake = (on: boolean) => {
    setWakeOn(on)
    setWakeNotice(false)
    setWakeMsg('')
    try {
      if (on) {
        localStorage.setItem('voice_wake', '1')
        localStorage.setItem('voice_wake_ack', '1')
      } else {
        localStorage.removeItem('voice_wake')
      }
    } catch {
      // ignore: it just will not be remembered
    }
  }

  const toggleWake = () => {
    if (wakeOn) return turnWake(false)
    let acknowledged = false
    try {
      acknowledged = localStorage.getItem('voice_wake_ack') === '1'
    } catch {
      // ignore
    }
    if (acknowledged) turnWake(true)
    else setWakeNotice(true)
  }

  const vstate: VoiceState = listening
    ? thinking
      ? 'thinking'
      : 'listening'
    : wake.phase === 'awake'
      ? 'listening'
      : flash ?? (wake.phase === 'armed' ? 'armed' : 'idle')

  const bigText = listening
    ? thinking
      ? 'Working on it…'
      : interim || "I'm listening…"
    : wake.phase === 'awake'
      ? wake.heard || 'Yes? Say the order…'
      : status || 'Say the order, for example "two jollof and one fish"'

  // start (or stop) the one-shot listening. The phone can only listen one way at a time,
  // so hands-free pauses for a moment first.
  const press = () => {
    cancelClose()
    setFlash(null)
    if (listening) {
      stop()
      return
    }
    if (wakeOn) {
      setWakePaused(true)
      if (pressTimer.current) clearTimeout(pressTimer.current)
      pressTimer.current = setTimeout(() => start(), 350)
    } else {
      start()
    }
  }

  const openAndListen = () => {
    setStatus('')
    setOpen(true)
    press()
  }

  const closeAssistant = () => {
    cancelClose()
    if (listening) stop()
    setOpen(false)
    setNotes([])
    setPickKey(null)
    setQuery('')
    setFlash(null)
  }

  const choose = (note: Note, opt: Option) => {
    const added = onAdd([{ itemId: opt.itemId, qty: note.qty }])
    if (added.length > 0) {
      setStatus(`Added ${added.map(a => `${a.qty} × ${a.name}`).join(', ')}`)
      buzz()
      // staff chose this item for words the app did not know: evidence, counted once the order is paid
      const phrase = cleanWords(note.heard)
      if (note.canPick && phrase.length >= 2 && added.some(a => a.itemId === opt.itemId)) {
        addVoiceMarks([{ itemId: opt.itemId, phrase, kind: 'corrected', batch: note.batch, uid: batchIds.current.get(note.batch) ?? null }])
      }
    }
    const rest = notes.filter(n => n.key !== note.key)
    setNotes(rest)
    // the last open question is answered: close the assistant
    if (rest.length === 0 && added.length > 0) closeSoon()
  }

  const dismiss = (key: number) => {
    const rest = notes.filter(n => n.key !== key)
    setNotes(rest)
    if (pickKey === key) setPickKey(null)
    if (rest.length === 0) closeSoon()
  }

  // Staff picked an item for words the app did not know: add it, and remember the words for this business
  const pickFromMenu = async (note: Note, opt: Option) => {
    choose(note, opt)
    setPickKey(null)
    setQuery('')
    const phrase = cleanWords(note.heard)
    if (!/^[a-z]+( [a-z]+)*$/.test(phrase) || phrase.length < 2 || phrase.length > 60) return
    const { error: err } = await supabase.rpc('teach_voice_phrase', { p_item_id: opt.itemId, p_phrase: phrase })
    if (err) return
    setTaught(prev => [...prev.filter(x => x.phrase !== phrase), { itemId: opt.itemId, phrase }])
    setStatus(`Added. Learned: "${phrase}" means ${opt.name}`)
  }

  // no speech support in this browser: show only the page's own controls
  if (supported === false) return <div className="pt-3">{children}</div>

  const armed = wakeOn && wake.phase === 'armed'

  // phone: above the cart bar when it shows. Tablet: same idea. PC: left of the cart panel.
  const place = lift
    ? 'bottom-[calc(var(--bottom-nav-h)+104px)] md:bottom-28 lg:bottom-6'
    : 'bottom-[calc(var(--bottom-nav-h)+16px)] md:bottom-6'

  return (
    <>
      <div className="pt-3">{children}</div>

      {mounted &&
        !open &&
        createPortal(
          <div
            className={`fixed right-4 z-[25] flex flex-col items-center gap-3 transition-[bottom] duration-200 lg:right-[23.5rem] xl:right-[25.5rem] ${place}`}
          >
            <button
              type="button"
              onClick={toggleWake}
              aria-pressed={wakeOn}
              aria-label={wakeOn ? 'Hands-free is on. Tap to turn off' : 'Turn on hands-free, say Hey Chopdesk'}
              title="Hands-free: say Hey Chopdesk"
              className={`press flex h-11 w-11 min-h-0 min-w-0 items-center justify-center rounded-full border shadow-md transition-colors ${
                wakeOn ? 'border-primary bg-primary text-white' : 'border-gray-200 bg-white text-gray-500'
              }`}
            >
              <Radio size={18} />
            </button>
            <button
              type="button"
              onClick={openAndListen}
              aria-label="Speak an order"
              className={`press flex h-16 w-16 min-h-0 min-w-0 items-center justify-center rounded-full bg-primary text-white shadow-xl ${
                armed ? 'ring-4 ring-green-400/50 animate-pulse' : ''
              }`}
            >
              <Mic size={28} />
            </button>
          </div>,
          document.body
        )}

      {mounted &&
        (wakeNotice || wakeMsg) &&
        !open &&
        createPortal(
          <div className="fixed inset-x-4 bottom-[calc(var(--bottom-nav-h)+16px)] z-[55] mx-auto max-w-md md:bottom-6">
            {wakeNotice && (
              <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-xl">
                <p className="t-small text-text-primary">
                  Hands-free keeps the microphone listening while this screen is open. Chrome sends what it hears to
                  Google to turn it into text, the whole time it is on. Turn it on at the counter only, where customers
                  cannot be heard. Chopdesk keeps no sound. It keeps only the words said after "Hey Chopdesk".
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => turnWake(true)} className="btn-primary press px-4 py-2 text-sm">
                    Turn on
                  </button>
                  <button type="button" onClick={() => setWakeNotice(false)} className="btn-secondary press px-4 py-2 text-sm">
                    Not now
                  </button>
                </div>
              </div>
            )}
            {wakeMsg && !wakeNotice && (
              <div className="flex items-start gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-xl">
                <p className="t-small min-w-0 flex-1 text-danger">{wakeMsg}</p>
                <button
                  type="button"
                  onClick={() => setWakeMsg('')}
                  aria-label="Dismiss"
                  className="press flex h-7 w-7 min-h-0 min-w-0 items-center justify-center rounded-full text-text-muted"
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </div>,
          document.body
        )}

      <VoiceOverlay
        open={open}
        state={vstate}
        level={meter && listening ? level : null}
        pulse={listening ? interim.length : wake.heard.length}
        text={bigText}
        hint={listening ? 'Tap the mic to stop' : 'Tap the mic to speak again'}
        error={error}
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
                  {note.options.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {note.options.map(opt => (
                        <button
                          key={opt.itemId}
                          type="button"
                          onClick={() => choose(note, opt)}
                          className="press rounded-full border border-primary bg-white px-4 py-2 text-sm font-medium text-primary"
                        >
                          {note.qty} × {opt.name}
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
                      Pick from menu
                    </button>
                  )}
                  {pickKey === note.key && (
                    <div className="mt-2">
                      <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search the menu"
                        className="input-base"
                      />
                      <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-border bg-white">
                        {menu
                          .filter(m => m.name.toLowerCase().includes(query.trim().toLowerCase()))
                          .slice(0, 30)
                          .map(m => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => void pickFromMenu(note, { itemId: m.id, name: m.name })}
                              className="press press-flat block min-h-0 w-full border-b border-border px-3 py-2.5 text-left text-sm last:border-b-0"
                            >
                              {note.qty} × {m.name}
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
      </VoiceOverlay>
    </>
  )
}
