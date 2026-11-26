'use client'

// Voice assistant: practise speaking to the app and teach it how this business's menu sounds.
// The mic will also appear inside Orders, Shift and Close Shift once those screens are wired up.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { parseBest, type Guess } from '@/lib/voice/best'
import { useRecognizer } from '@/lib/voice/useRecognizer'
import {
  type VoiceMenuItem,
  type VoiceParseResult,
  type VoicePhrase,
  type VoiceProblem,
} from '@/lib/voice/parse'
import { Mic, Square, Volume2, X } from 'lucide-react'

type Attempt = {
  id: number
  lang: string
  heard: string
  confidence: number
  others: string[]
  guesses: Guess[]
  guessIndex: number
  result: VoiceParseResult
}

type Feedback = 'chime' | 'voice' | 'silent'

type TaughtRow = { id: string; itemId: string; phrase: string }

const LANGS = [
  { code: 'en-NG', label: 'English (Nigeria)' },
  { code: 'en-US', label: 'English (US)' },
]

const FEEDBACK: { id: Feedback; label: string }[] = [
  { id: 'chime', label: 'Chime' },
  { id: 'voice', label: 'Voice' },
  { id: 'silent', label: 'Silent' },
]

const RETRY_PHRASE = 'Come again please'

// the most natural-sounding voice this phone has: "natural/neural" first, then Nigerian, then British, then US
function pickBestVoice(list: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const score = (v: SpeechSynthesisVoice) => {
    const n = v.name.toLowerCase()
    const l = v.lang.toLowerCase().replace('_', '-')
    let s = 0
    if (/natural|neural|wavenet|enhanced|premium/.test(n)) s += 10
    if (!v.localService) s += 2
    if (l === 'en-ng') s += 3
    else if (l === 'en-gb') s += 2
    else if (l === 'en-us') s += 1
    return s
  }
  return [...list].sort((a, b) => score(b) - score(a))[0]
}

function problemText(p: VoiceProblem): string {
  if (p.reason === 'no_item') return `No menu item found in "${p.heard}"`
  if (p.reason === 'no_quantity') return `No number heard for ${p.candidates[0]}`
  if (p.reason === 'multiple_items') {
    return `Heard ${Array.from(new Set(p.candidates)).join(' and ')} with only one number. Say each item with its own number.`
  }
  const names = Array.from(new Set(p.candidates))
  if (names.length === 1) {
    return `Two menu items are both named "${names[0]}". Rename one so voice can tell them apart.`
  }
  return `"${p.heard}" could be ${names.join(' or ')}`
}

export default function VoiceTestPage() {
  const [items, setItems] = useState<VoiceMenuItem[]>([])
  const [lang, setLang] = useState('en-NG')
  const [feedback, setFeedback] = useState<Feedback>('chime')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceName, setVoiceName] = useState('')
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [taught, setTaught] = useState<TaughtRow[]>([])
  const [skipped, setSkipped] = useState<Record<string, string[]>>({})
  const [note, setNote] = useState('')

  const audioRef = useRef<AudioContext | null>(null)
  const itemsRef = useRef<VoiceMenuItem[]>([])
  const taughtRef = useRef<TaughtRow[]>([])
  const feedbackRef = useRef<Feedback>('chime')
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])
  const voiceNameRef = useRef('')
  const nextId = useRef(1)
  const langRef = useRef('en-NG')
  const finishRef = useRef<(guesses: Guess[]) => void>(() => undefined)

  // the hook is called here, at the top, so every part of this page can use it
  const { supported, listening, interim, error, start: startRecognizer, stop, setError } = useRecognizer({
    lang,
    onFinal: guesses => finishRef.current(guesses),
  })

  useEffect(() => {
    itemsRef.current = items
  }, [items])
  useEffect(() => {
    feedbackRef.current = feedback
  }, [feedback])
  useEffect(() => {
    langRef.current = lang
  }, [lang])
  useEffect(() => {
    voicesRef.current = voices
    voiceNameRef.current = voiceName
  }, [voices, voiceName])

  useEffect(() => {
    supabase
      .from('menu_items')
      .select('id, name')
      .eq('available', true)
      .order('name')
      .then(({ data, error: err }) => {
        if (err) setError("Couldn't load the menu: " + err.message)
        else setItems(data || [])
      })

    supabase
      .from('voice_phrases')
      .select('id, item_id, phrase')
      .then(({ data, error: err }) => {
        if (err) return
        const rows: TaughtRow[] = (data || []).map((r: { id: string; item_id: string; phrase: string }) => ({
          id: r.id,
          itemId: r.item_id,
          phrase: r.phrase,
        }))
        taughtRef.current = rows
        setTaught(rows)
      })

    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined
    const loadVoices = () => {
      if (!synth) return
      const list = synth.getVoices().filter(v => v.lang.toLowerCase().startsWith('en'))
      setVoices(list)
      setVoiceName(prev => prev || pickBestVoice(list)?.name || '')
    }
    loadVoices()
    synth?.addEventListener('voiceschanged', loadVoices)

    return () => {
      synth?.cancel()
      synth?.removeEventListener('voiceschanged', loadVoices)
    }
  }, [setError])

  const say = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    const u = new SpeechSynthesisUtterance(text)
    const v = voicesRef.current.find(x => x.name === voiceNameRef.current)
    if (v) {
      u.voice = v
      u.lang = v.lang
    }
    u.rate = 1.05
    u.pitch = 1
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  }

  // two quick rising notes for "got it", one low note for "try again"
  const chime = (ok: boolean) => {
    const ctx = audioRef.current
    if (!ctx) return
    const t0 = ctx.currentTime
    const notes: [number, number][] = ok ? [[659, 0], [880, 0.11]] : [[300, 0]]
    for (const [freq, delay] of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0 + delay)
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + delay + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.16)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t0 + delay)
      osc.stop(t0 + delay + 0.18)
    }
  }

  const toPhrases = (): VoicePhrase[] => taughtRef.current.map(t => ({ itemId: t.itemId, phrase: t.phrase }))

  // after the taught list changes, read every sentence on screen again so you can see what now works
  const applyTaught = (next: TaughtRow[]) => {
    taughtRef.current = next
    setTaught(next)
    setAttempts(prev =>
      prev.map(a => {
        const again = parseBest(a.guesses, itemsRef.current, toPhrases())
        return again ? { ...a, ...splitGuesses(again.heard, a.guesses), guessIndex: again.guessIndex, result: again.result } : a
      })
    )
  }

  const toggleWord = (key: string, word: string) =>
    setSkipped(prev => {
      const now = prev[key] || []
      return { ...prev, [key]: now.includes(word) ? now.filter(w => w !== word) : [...now, word] }
    })

  const teach = async (words: string[], item: VoiceMenuItem) => {
    const phrase = words.join(' ')
    if (phrase.length < 2) {
      setNote('Keep at least one word selected, then tap the item.')
      return
    }
    const { data, error: err } = await supabase.rpc('teach_voice_phrase', { p_item_id: item.id, p_phrase: phrase })
    if (err) {
      setError(err.message)
      return
    }
    setError('')
    applyTaught([...taughtRef.current.filter(t => t.phrase !== phrase), { id: String(data), itemId: item.id, phrase }])
    setNote(`Learned: "${phrase}" means ${item.name}`)
    if (feedbackRef.current !== 'silent') chime(true)
  }

  const forget = async (row: TaughtRow) => {
    const { data, error: err } = await supabase.from('voice_phrases').delete().eq('id', row.id).select('id')
    if (err) {
      setError(err.message)
      return
    }
    if (!data || data.length === 0) {
      setError('Only the owner can remove taught phrases.')
      return
    }
    setError('')
    applyTaught(taughtRef.current.filter(t => t.id !== row.id))
    setNote(`Forgot "${row.phrase}"`)
  }

  const respond = (result: VoiceParseResult) => {
    const mode = feedbackRef.current
    if (mode === 'silent') return
    const ok = result.lines.length > 0 && result.problems.length === 0
    if (mode === 'chime') {
      chime(ok)
      if (!ok) setTimeout(() => say(RETRY_PHRASE), 250)
    } else {
      say(ok ? result.lines.map(l => `${l.itemName}, ${l.qty}`).join('. ') : RETRY_PHRASE)
    }
  }

  // Chrome's guess that was used becomes "heard"; the other guesses are shown as "also heard"
  const splitGuesses = (heard: string, guesses: Guess[]) => ({
    heard,
    confidence: guesses.find(g => g.transcript === heard)?.confidence ?? 0,
    others: guesses.filter(g => g.transcript !== heard).map(g => g.transcript),
  })

  // save the sentence (text only) so we can learn from it later; quietly does nothing if it fails
  const logUtterance = (guesses: Guess[], heard: string, result: VoiceParseResult) => {
    const session = getSession()
    if (!session) return
    void supabase
      .rpc('log_voice_utterance', {
        p_org: session.org_id,
        p_source: 'test',
        p_heard: heard,
        p_alternatives: guesses.map(g => g.transcript).filter(t => t !== heard),
        p_understood: result.lines.map(l => ({ item_id: l.itemId, qty: l.qty })),
      })
      .then(() => undefined, () => undefined)
  }

  const finish = (guesses: Guess[]) => {
    const best = parseBest(guesses, itemsRef.current, toPhrases())
    if (!best) return
    setAttempts(prev =>
      [
        {
          id: nextId.current++,
          lang: langRef.current,
          ...splitGuesses(best.heard, guesses),
          guesses,
          guessIndex: best.guessIndex,
          result: best.result,
        },
        ...prev,
      ].slice(0, 15)
    )
    logUtterance(guesses, best.heard, best.result)
    respond(best.result)
  }

  useEffect(() => {
    finishRef.current = finish
  })

  const start = () => {
    if (listening) return
    // the audio context has to be created from a tap
    if (!audioRef.current && typeof window !== 'undefined') {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AC) audioRef.current = new AC()
    }
    audioRef.current?.resume()
    setNote('')
    startRecognizer()
  }

  if (supported === false) {
    return (
      <div className="min-h-full bg-bg-subtle p-4">
        <div className="bg-white rounded-xl p-5 border border-gray-200 text-sm">
          This browser does not support voice recognition. Open this page in Chrome on your Android phone.
        </div>
      </div>
    )
  }

  const pill = (active: boolean) =>
    `flex-1 rounded-lg border px-3 py-2 text-sm ${
      active ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-gray-200 bg-white text-gray-600'
    }`

  return (
    <div className="min-h-full bg-bg-subtle pb-24">
      <div className="bg-white border-b px-4 py-4">
        <p className="font-semibold">Voice assistant</p>
        <p className="text-sm text-gray-500">
          Tap the mic and say things like &quot;jollof rice 300, beans fifty&quot;. Anything it mishears, you can teach it below.
        </p>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex gap-2">
          {LANGS.map(l => (
            <button key={l.code} onClick={() => !listening && setLang(l.code)} className={pill(lang === l.code)}>
              {l.label}
            </button>
          ))}
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-1">When it understands:</p>
          <div className="flex gap-2">
            {FEEDBACK.map(f => (
              <button key={f.id} onClick={() => setFeedback(f.id)} className={pill(feedback === f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {voices.length > 0 && (
          <div className="flex gap-2">
            <select
              value={voiceName}
              onChange={e => setVoiceName(e.target.value)}
              className="flex-1 min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              {voices.map(v => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
            <button
              onClick={() => say('Jollof rice, three hundred')}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm flex items-center gap-1 text-gray-600"
            >
              <Volume2 size={16} /> Try
            </button>
          </div>
        )}

        <button
          onClick={listening ? stop : start}
          className={`w-full rounded-2xl py-8 flex flex-col items-center justify-center gap-2 text-white font-medium shadow-lg active:scale-[0.98] transition-transform ${
            listening ? 'bg-danger' : 'bg-primary'
          }`}
        >
          {listening ? <Square size={32} /> : <Mic size={32} />}
          {listening ? 'Listening… tap to stop' : 'Tap and speak'}
        </button>

        {interim && (
          <div className="bg-white rounded-xl p-4 border border-gray-200 text-gray-500 italic">{interim}</div>
        )}
        {error && <div className="bg-danger/10 text-danger rounded-xl p-4 text-sm">{error}</div>}
        {note && <div className="bg-success/10 text-success rounded-xl p-4 text-sm font-medium">{note}</div>}

        {attempts.map(a => (
          <div key={a.id} className="bg-white rounded-xl p-4 border border-gray-200 space-y-2">
            <p className="text-lg font-medium">&quot;{a.heard}&quot;</p>
            <p className="text-xs text-gray-400">
              {a.lang} · confidence {Math.round(a.confidence * 100)}%
              {a.guessIndex > 0 && ` · used guess ${a.guessIndex + 1} of ${a.guesses.length}`}
            </p>
            {a.others.length > 0 && (
              <p className="text-xs text-gray-400">Also heard: {a.others.map(o => `"${o}"`).join(', ')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {a.result.lines.map((l, i) => (
                <span key={i} className="bg-success/10 text-success rounded-full px-3 py-1 text-sm font-medium">
                  {l.itemName} × {l.qty}
                </span>
              ))}
            </div>
            {a.result.problems.map((p, i) => {
              const key = `${a.id}-${i}`
              const words = p.heard.split(' ').filter(w => /^[a-z]+$/.test(w))
              const left = skipped[key] || []
              const chosen = words.filter(w => !left.includes(w))
              return (
                <div key={i} className="space-y-2">
                  <p className="text-sm text-warning">{problemText(p)}</p>
                  {p.reason === 'no_item' && (p.suggestions || []).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs text-gray-500">Sounds like. Tap the right one and it will remember:</p>
                      <div className="flex flex-wrap gap-2">
                        {(p.suggestions || []).map(sg => {
                          const it = items.find(i => i.id === sg.itemId)
                          if (!it) return null
                          return (
                            <button
                              key={sg.itemId}
                              onClick={() => teach(chosen, it)}
                              className="rounded-full border border-primary bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                            >
                              {sg.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {p.reason === 'no_item' && words.length > 0 && items.length > 0 && (
                    <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
                      {(p.suggestions || []).length === 0 && (
                        <p className="text-xs text-warning">
                          Nothing on your menu sounds like this. If it is a new item, add it in Menu Items first.
                        </p>
                      )}
                      <p className="text-xs text-gray-500">Teach it. Keep only the words that mean one item:</p>
                      <div className="flex flex-wrap gap-2">
                        {words.map(w => (
                          <button
                            key={w}
                            onClick={() => toggleWord(key, w)}
                            className={`rounded-full px-3 py-1 text-sm border ${
                              left.includes(w)
                                ? 'border-gray-200 bg-white text-gray-300 line-through'
                                : 'border-primary bg-primary/10 text-primary font-medium'
                            }`}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500">Then tap the item it means:</p>
                      <div className="flex flex-wrap gap-2">
                        {items.map(it => (
                          <button
                            key={it.id}
                            onClick={() => teach(chosen, it)}
                            className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700 active:bg-primary/10"
                          >
                            {it.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}

        {taught.length > 0 && (
          <div className="pt-2">
            <p className="text-xs text-gray-400 mb-2">Phrases this business taught:</p>
            <div className="flex flex-wrap gap-2">
              {taught.map(t => (
                <span
                  key={t.id}
                  className="flex items-center gap-1 bg-primary/10 text-primary rounded-full pl-3 pr-1 py-1 text-xs"
                >
                  {t.phrase} → {items.find(i => i.id === t.itemId)?.name ?? '?'}
                  <button onClick={() => forget(t)} aria-label={`Forget ${t.phrase}`} className="p-1 rounded-full">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div className="pt-2">
            <p className="text-xs text-gray-400 mb-2">Menu items it knows:</p>
            <div className="flex flex-wrap gap-2">
              {items.map(i => (
                <span key={i.id} className="bg-white border border-gray-200 rounded-full px-3 py-1 text-xs text-gray-600">
                  {i.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
