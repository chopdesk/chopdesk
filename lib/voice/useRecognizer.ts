'use client'

// lib/voice/useRecognizer.ts
// One place that owns Chrome's speech recognition, so Voice, Orders, Shift and Close Shift
// all listen the same way. It hands back ALL of Chrome's guesses, not only the first.
// `level` (0 to 1) is how loud the voice is right now, so the screen can glow and move with it.
// The level meter uses a second microphone stream; it is off unless you ask for `withLevel`.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Guess } from './best'

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

export const RECOGNIZER_ERRORS: Record<string, string> = {
  'not-allowed': 'The microphone is blocked. Tap the lock icon in the address bar, allow the microphone, then try again.',
  'service-not-allowed': 'The microphone is blocked. Tap the lock icon in the address bar, allow the microphone, then try again.',
  'no-speech': 'Heard nothing. Tap the mic and try again.',
  'audio-capture': 'No microphone was found on this device.',
  network: 'Speech recognition needs internet. Check the connection.',
}

function getCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

type Options = {
  lang: string
  /** Called once for each finished sentence, with every guess Chrome made (best first). */
  onFinal: (guesses: Guess[]) => void
  /** Measure how loud the voice is (for animations). Off by default. */
  withLevel?: boolean
}

export function useRecognizer({ lang, onFinal, withLevel = false }: Options) {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [level, setLevel] = useState(0)

  const recRef = useRef<RecognitionLike | null>(null)
  const onFinalRef = useRef(onFinal)
  const meterRef = useRef<{ stop: () => void } | null>(null)

  useEffect(() => {
    onFinalRef.current = onFinal
  }, [onFinal])

  useEffect(() => {
    setSupported(getCtor() !== null)
    return () => {
      recRef.current?.abort()
      meterRef.current?.stop()
    }
  }, [])

  const stopMeter = useCallback(() => {
    meterRef.current?.stop()
    meterRef.current = null
    setLevel(0)
  }, [])

  const startMeter = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) {
        stream.getTracks().forEach(t => t.stop())
        return
      }
      const ctx = new AC()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      let raf = 0
      let smooth = 0
      let alive = true
      const tick = () => {
        if (!alive) return
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = ((data[i] as number) - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        // quick to rise, slow to fall, so the glow feels alive and not jumpy
        const target = Math.min(1, rms * 4)
        smooth = target > smooth ? smooth * 0.5 + target * 0.5 : smooth * 0.88 + target * 0.12
        setLevel(smooth)
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      meterRef.current = {
        stop: () => {
          alive = false
          cancelAnimationFrame(raf)
          stream.getTracks().forEach(t => t.stop())
          void ctx.close()
        },
      }
    } catch {
      // the meter is only decoration: if it cannot start, listening still works
    }
  }, [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor || recRef.current) return

    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = false
    rec.interimResults = true
    rec.maxAlternatives = 3

    rec.onresult = e => {
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const first = res?.[0]
        if (!res || !first) continue
        if (res.isFinal) {
          const guesses: Guess[] = []
          for (let k = 0; k < res.length; k++) {
            const a = res[k]
            if (a) guesses.push({ transcript: a.transcript, confidence: a.confidence })
          }
          onFinalRef.current(guesses)
        } else {
          interimText += first.transcript
        }
      }
      setInterim(interimText)
    }
    rec.onerror = e => setError(RECOGNIZER_ERRORS[e.error] || 'Voice error: ' + e.error)
    rec.onend = () => {
      recRef.current = null
      setListening(false)
      setInterim('')
      stopMeter()
    }

    recRef.current = rec
    setError('')
    setListening(true)
    try {
      rec.start()
      if (withLevel) void startMeter()
    } catch {
      recRef.current = null
      setListening(false)
    }
  }, [lang, withLevel, startMeter, stopMeter])

  const stop = useCallback(() => recRef.current?.stop(), [])
  const clearError = useCallback(() => setError(''), [])

  return { supported, listening, interim, error, level, start, stop, clearError, setError }
}
