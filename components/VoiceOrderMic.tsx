'use client'

// components/VoiceOrderMic.tsx
// The voice assistant for the Orders screen.
// A round mic button sits at the bottom right (easy for the thumb). Tapping it opens a full-screen assistant.
// Staff say an order ("2 jollof, ewa agoyin 3") and it is ADDED to the cart. The assistant then says back what
// it added and asks "Proceed to payment?". Saying "yes" / "proceed" goes to the payment screen. Saying more items
// adds them. Saying "no" closes the assistant and staff continue by hand.
// Things the app is not sure about never block the order: they show as small tap-to-confirm choices.
// The page's own controls (filters, menu, cart) are passed in as children and are always usable.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { parseBest, type Guess } from '@/lib/voice/best'
import { RECOGNIZER_ERRORS, useRecognizer } from '@/lib/voice/useRecognizer'
import { promoteLearned, learnedCounts, type LearningRow } from '@/lib/voice/learned'
import { byPopularity, popularityFromOrders, rerank, type Popularity } from '@/lib/voice/rank'
import { addVoiceMarks, tagVoiceMarks, type VoiceMark } from '@/lib/voice/feedback'
import type { VoicePhrase, VoiceProblem } from '@/lib/voice/parse'
import VoiceOverlay, { type VoiceState } from '@/components/VoiceOverlay'
import { Mic, Square, X } from 'lucide-react'

type MenuLite = { id: string; name: string }
export type VoiceAdded = { itemId: string; name: string; qty: number }
type CartLite = { id: string; name: string; price: number; quantity: number }

type Props = {
  menu: MenuLite[]
  /** Puts items in the cart. Returns what was really added (stock may cut a number down or block it). */
  onAdd: (lines: { itemId: string; qty: number }[]) => VoiceAdded[]
  /** The current order, so the assistant can show it and know when it is empty. */
  cart: CartLite[]
  /** Goes to the payment screen. */
  onProceed: () => void
  /** true while the phone cart bar is showing, so the mic button sits above it */
  lift?: boolean
  /** The page's own controls (the filter row). Always shown, always usable. */
  children?: ReactNode
}

type Option = { itemId: string; name: string }
type Note = { key: number; batch: number; heard: string; canPick: boolean; text: string; qty: number; options: Option[] }

// what staff may say instead of an item
const YES =
  /^((yes|yeah|yep|yup|ok|okay|sure)( please)?( proceed| go ahead| confirm)?|please proceed|proceed|proceed to (payment|checkout|pay)|go to (payment|checkout)|go ahead|checkout|check out|pay|payment|confirm|that is all|that s all|thats all|done)$/
const NO = /^(no|nope|nah|cancel|stop|not yet|wait|close|never mind|nevermind|leave it)$/

const naira = (n: number) => '\u20A6' + n.toLocaleString()

export default function VoiceOrderMic({ menu, onAdd, cart, onProceed, lift = false, children }: Props) {
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
  // spoken reply: on by default, remembered on this phone only
  const [voiceReply, setVoiceReply] = useState(true)
  const voiceReplyRef = useRef(true)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // counts up every time speaking or listening is cancelled, so late callbacks know they are out of date
  const run = useRef(0)
  const nextKey = useRef(1)
  // id of the newest logged sentence; the learning step will use it later
  const lastLogId = useRef<string | null>(null)
  // sentence group -> saved sentence id, so marks made before the id arrived can still be tagged
  const batchIds = useRef(new Map<number, string>())
  // the latest order, for the "yes" check
  const cartRef = useRef(cart)
  cartRef.current = cart

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
      const on = localStorage.getItem('voice_reply') !== '0'
      setVoiceReply(on)
      voiceReplyRef.current = on
    } catch {
      // storage blocked: defaults stay
    }
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
      run.current++
      try {
        window.speechSynthesis?.cancel()
      } catch {
        // ignore
      }
    }
  }, [])

  const toggleSound = () => {
    const next = !voiceReplyRef.current
    voiceReplyRef.current = next
    setVoiceReply(next)
    if (!next) {
      run.current++
      try {
        window.speechSynthesis?.cancel()
      } catch {
        // ignore
      }
    }
    try {
      if (next) localStorage.removeItem('voice_reply')
      else localStorage.setItem('voice_reply', '0')
    } catch {
      // ignore: it just will not be remembered
    }
  }

  const showFlash = (kind: 'ok' | 'maybe') => {
    setFlash(kind)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1100)
  }

  const cleanWords = (text: string) => text.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

  const buzz = () => {
    try {
      navigator.vibrate?.(30)
    } catch {
      // some phones do not allow it: not important
    }
  }

  const cancelSpeech = () => {
    run.current++
    try {
      window.speechSynthesis?.cancel()
    } catch {
      // ignore
    }
  }

  // The assistant says something out loud, then (optionally) does `then`, for example listen again.
  // If the spoken reply is off, `then` runs after a short pause. If staff close the assistant or tap the mic
  // in the meantime, `then` is dropped.
  const say = (text: string, then?: () => void) => {
    try {
      window.speechSynthesis?.cancel()
    } catch {
      // ignore
    }
    const token = ++run.current
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      if (run.current === token) then?.()
    }
    const canSpeak = voiceReplyRef.current && typeof window !== 'undefined' && 'speechSynthesis' in window
    if (!canSpeak) {
      if (then) setTimeout(finish, 450)
      return
    }
    try {
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en-NG'
      u.rate = 1.05
      u.onend = finish
      u.onerror = finish
      window.speechSynthesis.speak(u)
      // some phones never say "finished": do not wait for ever
      setTimeout(finish, Math.min(9000, 2500 + text.length * 80))
    } catch {
      finish()
    }
  }

  const addedText = (added: { qty: number; name: string }[]) => added.map(a => `${a.qty} ${a.name}`).join(', ')

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

  // go to the payment screen
  const proceed = () => {
    cancelSpeech()
    if (listening) stop()
    setOpen(false)
    setNotes([])
    setPickKey(null)
    onProceed()
  }

  // listen again after the assistant finished talking (only if the assistant is still open)
  const listenAgain = () => {
    setFlash(null)
    start()
  }

  const handleFinal = (guesses: Guess[]) => {
    // 1) "yes" / "no" instead of an item
    const spoken = guesses.map(g => cleanWords(g.transcript))
    if (spoken.some(t => YES.test(t))) {
      if (cartRef.current.length === 0) {
        setStatus('Your order is empty. Say the items first.')
        showFlash('maybe')
        say('Your order is empty. Say the items first.', listenAgain)
        return
      }
      say('Okay, going to payment.')
      proceed()
      return
    }
    if (spoken.some(t => NO.test(t))) {
      closeAssistant()
      return
    }

    // 2) an order
    const best = parseBest(guesses, menu, phrases, { assumeOne: true })
    if (!best) {
      setStatus('I did not catch that. Try again.')
      setThinking(false)
      showFlash('maybe')
      say('I did not catch that. Try again.', listenAgain)
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
    let added: VoiceAdded[] = []
    if (lines.length > 0) {
      added = onAdd(lines.map(l => ({ itemId: l.itemId, qty: l.qty })))
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
      }
    } else if (problems.length === 0) {
      line = `Heard "${best.heard}". Nothing matched the menu.`
    }
    setStatus(line)
    setThinking(false)
    showFlash(added.length > 0 ? 'ok' : 'maybe')
    setNotes(prev => [...problems.map(p => noteFor(p, batch)), ...prev].slice(0, 4))

    // 3) the assistant says back what it did
    if (added.length > 0 && problems.length === 0) {
      say(`Added ${addedText(added)}. Proceed to payment?`, listenAgain)
    } else if (added.length > 0) {
      say(`Added ${addedText(added)}. I am not sure about one word. Please check the choices.`)
    } else if (problems.length > 0) {
      say('I am not sure about that. Please check the choices.')
    } else {
      say('Nothing matched the menu. Try again.', listenAgain)
    }
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

  const vstate: VoiceState = listening ? (thinking ? 'thinking' : 'listening') : flash ?? 'idle'

  const orderCount = cart.reduce((n, c) => n + c.quantity, 0)
  const orderTotal = cart.reduce((n, c) => n + c.price * c.quantity, 0)

  const bigText = listening
    ? thinking
      ? 'Working on it…'
      : interim || "I'm listening…"
    : status || 'Say the order, for example "two jollof and one fish"'

  const hint = listening
    ? 'Listening. Say "yes" to pay, or say more items'
    : orderCount > 0
      ? 'Say "yes" to proceed, or tap the mic to add more'
      : 'Tap the mic and say the order'

  // start (or stop) listening by hand
  const press = () => {
    cancelSpeech()
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
    cancelSpeech()
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
    // the last open question is answered: ask about payment again
    if (rest.length === 0 && added.length > 0) say(`Added ${addedText(added)}. Proceed to payment?`, listenAgain)
  }

  const dismiss = (key: number) => {
    setNotes(prev => prev.filter(n => n.key !== key))
    if (pickKey === key) setPickKey(null)
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

  // phone: above the cart bar when it shows. Tablet: same idea. PC: left of the cart panel.
  const place = lift
    ? 'bottom-[calc(var(--bottom-nav-h)+104px)] md:bottom-28 lg:bottom-6'
    : 'bottom-[calc(var(--bottom-nav-h)+16px)] md:bottom-6'

  const shownError = error === RECOGNIZER_ERRORS['no-speech'] ? '' : error

  return (
    <>
      <div className="pt-3">{children}</div>

      {mounted &&
        !open &&
        createPortal(
          <div
            className={`fixed right-4 z-[25] transition-[bottom] duration-200 lg:right-[23.5rem] xl:right-[25.5rem] ${place}`}
          >
            <button
              type="button"
              onClick={openAndListen}
              aria-label="Speak an order"
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
        level={meter && listening ? level : null}
        pulse={interim.length}
        text={bigText}
        hint={hint}
        error={shownError}
        sound={voiceReply}
        onToggleSound={toggleSound}
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

        {cart.length > 0 && (
          <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-baseline justify-between">
              <p className="t-body font-semibold text-text-primary">Current order</p>
              <p className="t-small text-text-secondary">
                {orderCount} item{orderCount !== 1 ? 's' : ''}
              </p>
            </div>
            <ul className="mt-2 space-y-1">
              {cart.map(c => (
                <li key={c.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-text-primary">
                    {c.quantity} × {c.name}
                  </span>
                  <span className="text-text-secondary">{naira(c.price * c.quantity)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-baseline justify-between border-t border-gray-100 pt-2">
              <span className="t-body font-semibold text-text-primary">Total</span>
              <span className="text-lg font-bold text-primary">{naira(orderTotal)}</span>
            </div>
            <button type="button" onClick={proceed} className="btn-primary press mt-3 w-full">
              Proceed to payment
            </button>
          </div>
        )}
      </VoiceOverlay>
    </>
  )
}
