'use client'

// TEMPORARY test page: tap the mic, say menu items, see what Chrome heard and what the parser understood.
// Delete the app/dashboard/voice-test folder once the real voice features are built.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { parseVoiceLines, type VoiceMenuItem, type VoiceParseResult } from '@/lib/voice/parse'
import { Mic, Square, Volume2 } from 'lucide-react'

type Alt = { transcript: string; confidence: number }
type ResultLike = { isFinal: boolean; length: number; [i: number]: Alt }
type EventLike = { resultIndex: number; results: { length: number; [i: number]: ResultLike } }
type RecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: EventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionCtor = new () => RecognitionLike

type Attempt = {
  id: number
  lang: string
  heard: string
  confidence: number
  others: string[]
  result: VoiceParseResult
}

const LANGS = [
  { code: 'en-NG', label: 'English (Nigeria)' },
  { code: 'en-US', label: 'English (US)' },
]

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'The microphone is blocked. Tap the lock icon in the address bar, allow the microphone, then try again.',
  'service-not-allowed': 'The microphone is blocked. Tap the lock icon in the address bar, allow the microphone, then try again.',
  'no-speech': 'Heard nothing. Tap the mic and try again.',
  'audio-capture': 'No microphone was found on this device.',
  network: 'Speech recognition needs internet. Check the connection.',
}

export default function VoiceTestPage() {
  const [items, setItems] = useState<VoiceMenuItem[]>([])
  const [supported, setSupported] = useState<boolean | null>(null)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [lang, setLang] = useState('en-NG')
  const [speakBack, setSpeakBack] = useState(true)
  const [attempts, setAttempts] = useState<Attempt[]>([])

  const recRef = useRef<RecognitionLike | null>(null)
  const itemsRef = useRef<VoiceMenuItem[]>([])
  const speakRef = useRef(true)
  const nextId = useRef(1)

  useEffect(() => {
    itemsRef.current = items
  }, [items])
  useEffect(() => {
    speakRef.current = speakBack
  }, [speakBack])

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null)
    supabase
      .from('menu_items')
      .select('id, name')
      .eq('available', true)
      .order('name')
      .then(({ data, error: err }) => {
        if (err) setError("Couldn't load the menu: " + err.message)
        else setItems(data || [])
      })
    return () => {
      recRef.current?.abort()
      if (typeof window !== 'undefined') window.speechSynthesis?.cancel()
    }
  }, [])

  const say = (text: string) => {
    if (!speakRef.current || typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  }

  const finish = (alts: Alt[], usedLang: string) => {
    const best = alts[0]
    if (!best) return
    const result = parseVoiceLines(best.transcript, itemsRef.current)
    const attempt: Attempt = {
      id: nextId.current++,
      lang: usedLang,
      heard: best.transcript,
      confidence: best.confidence,
      others: alts.slice(1).map(a => a.transcript),
      result,
    }
    setAttempts(prev => [attempt, ...prev].slice(0, 15))

    if (result.lines.length > 0 && result.problems.length === 0) {
      say(result.lines.map(l => `${l.itemName}, ${l.qty}`).join('. '))
    } else if (result.problems.length > 0) {
      say("Sorry, I didn't get that. Say it again.")
    }
  }

  const start = () => {
    const Ctor = getRecognitionCtor()
    if (!Ctor || listening) return
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 3

    rec.onresult = (e) => {
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const first = res?.[0]
        if (!res || !first) continue
        if (res.isFinal) {
          const alts: Alt[] = []
          for (let k = 0; k < res.length; k++) {
            const a = res[k]
            if (a) alts.push(a)
          }
          finish(alts, lang)
        } else {
          interimText += first.transcript
        }
      }
      setInterim(interimText)
    }
    rec.onerror = (e) => setError(ERROR_TEXT[e.error] || 'Voice error: ' + e.error)
    rec.onend = () => {
      setListening(false)
      setInterim('')
    }

    recRef.current = rec
    setError('')
    setListening(true)
    try {
      rec.start()
    } catch {
      setListening(false)
    }
  }

  const stop = () => recRef.current?.stop()

  if (supported === false) {
    return (
      <div className="min-h-full bg-bg-subtle p-4">
        <div className="bg-white rounded-xl p-5 border border-gray-200 text-sm">
          This browser does not support voice recognition. Open this page in Chrome on your Android phone.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-bg-subtle pb-24">
      <div className="bg-white border-b px-4 py-4">
        <p className="font-semibold">Voice test</p>
        <p className="text-sm text-gray-500">
          Tap the mic and say things like &quot;jollof rice 300, beans fifty&quot;. Try it from a few feet away, then in the busy kitchen.
        </p>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex gap-2">
          {LANGS.map(l => (
            <button
              key={l.code}
              onClick={() => !listening && setLang(l.code)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                lang === l.code ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-gray-200 bg-white text-gray-600'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setSpeakBack(v => !v)}
          className={`w-full flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            speakBack ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-gray-200 bg-white text-gray-600'
          }`}
        >
          <Volume2 size={16} /> Speak the answer back: {speakBack ? 'On' : 'Off'}
        </button>

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

        {attempts.map(a => (
          <div key={a.id} className="bg-white rounded-xl p-4 border border-gray-200 space-y-2">
            <p className="text-lg font-medium">&quot;{a.heard}&quot;</p>
            <p className="text-xs text-gray-400">
              {a.lang} · confidence {Math.round(a.confidence * 100)}%
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
            {a.result.problems.map((p, i) => (
              <p key={i} className="text-sm text-warning">
                {p.reason === 'no_item' && `No menu item found in "${p.heard}"`}
                {p.reason === 'no_quantity' && `No number heard for ${p.candidates[0]}`}
                {p.reason === 'ambiguous' && `"${p.heard}" could be ${p.candidates.join(' or ')}`}
              </p>
            ))}
          </div>
        ))}

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
