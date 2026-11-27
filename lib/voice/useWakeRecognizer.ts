'use client'

// lib/voice/useWakeRecognizer.ts
// Hands-free mode: keeps Chrome's speech recognition running while the screen is open and waits for the
// wake phrase ("Hey Chopdesk"). The words after it are the order. Words that do not start with the wake phrase
// are ignored: they are not kept and not sent anywhere by Chopdesk.
// Limits of a web app: it only works while this screen is open and visible (the screen is kept awake for it),
// and Chrome itself sends the sound to Google's speech service the whole time it is on.

import { useEffect, useRef, useState } from 'react'
import { dropRepeat, matchWake } from './wake'

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
  abort: () => void
}
type RecognitionCtor = new () => RecognitionLike
type LockLike = { release: () => Promise<void> }

function getCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export type WakePhase = 'off' | 'armed' | 'awake'

type Options = {
  enabled: boolean
  lang: string
  wake?: string
  /** the wake phrase was heard (can come before the sentence is finished) */
  onWake: () => void
  /** only the wake phrase was said and no order followed in time */
  onSleep: () => void
  /** the order, with the wake phrase already removed */
  onCommand: (text: string) => void
  /** hands-free cannot continue (microphone blocked, or it keeps stopping) */
  onFatal: (message: string) => void
}

const WAIT_FOR_ORDER_MS = 8000

export function useWakeRecognizer({ enabled, lang, wake, onWake, onSleep, onCommand, onFatal }: Options) {
  const [phase, setPhase] = useState<WakePhase>('off')
  const [heard, setHeard] = useState('')

  const handlers = useRef({ onWake, onSleep, onCommand, onFatal })
  useEffect(() => {
    handlers.current = { onWake, onSleep, onCommand, onFatal }
  })

  useEffect(() => {
    const Ctor = getCtor()
    if (!enabled || !Ctor) {
      setPhase('off')
      setHeard('')
      return
    }

    let alive = true
    let paused = false
    let rec: RecognitionLike | null = null
    let restartTimer: ReturnType<typeof setTimeout> | null = null
    let sleepTimer: ReturnType<typeof setTimeout> | null = null
    let lock: LockLike | null = null
    let failures = 0
    let startedAt = 0
    let wakeIdx: number | null = null // which result held the wake phrase
    let awaiting = false // only the wake phrase was said: the next sentence is the order
    const done = new Set<number>()

    const clearSleep = () => {
      if (sleepTimer) clearTimeout(sleepTimer)
      sleepTimer = null
    }

    const goArmed = () => {
      wakeIdx = null
      awaiting = false
      clearSleep()
      setHeard('')
      setPhase('armed')
    }

    const deliver = (text: string) => {
      const t = dropRepeat(text)
      goArmed()
      if (t) handlers.current.onCommand(t)
    }

    // the sentence that held the wake phrase is finished
    const finishWakeSentence = (command: string | null) => {
      if (command) {
        deliver(command)
      } else if (command === '') {
        awaiting = true
        clearSleep()
        sleepTimer = setTimeout(() => {
          if (awaiting) {
            goArmed()
            handlers.current.onSleep()
          }
        }, WAIT_FOR_ORDER_MS)
      } else {
        goArmed()
      }
    }

    const onResult = (e: EventLike) => {
      failures = 0
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (!res || done.has(i)) continue
        const text = res[0]?.transcript ?? ''
        const final = res.isFinal

        if (wakeIdx === i) {
          // the sentence with the wake phrase: the words after it are the order
          const m = matchWake(text, wake)
          if (m) setHeard(m.command)
          if (final) {
            done.add(i)
            finishWakeSentence(m ? m.command : null)
          }
          continue
        }

        if (awaiting && wakeIdx !== null && i > wakeIdx) {
          setHeard(text)
          if (final) {
            done.add(i)
            deliver(text)
          }
          continue
        }

        // waiting for the wake phrase: everything else is ignored and forgotten
        const m = matchWake(text, wake)
        if (m) {
          wakeIdx = i
          setPhase('awake')
          setHeard(m.command)
          handlers.current.onWake()
          if (final) {
            done.add(i)
            finishWakeSentence(m.command)
          }
        } else if (final) {
          done.add(i)
        }
      }
    }

    const fatal = (message: string) => {
      alive = false
      clearSleep()
      if (restartTimer) clearTimeout(restartTimer)
      rec?.abort()
      setPhase('off')
      setHeard('')
      handlers.current.onFatal(message)
    }

    const schedule = () => {
      if (!alive || paused) return
      const lived = Date.now() - startedAt
      failures = lived > 5000 ? 0 : failures + 1
      if (failures >= 8) {
        fatal('Hands-free keeps stopping on this phone, so it was turned off. Tap the mic to speak.')
        return
      }
      restartTimer = setTimeout(start, Math.min(250 * 2 ** failures, 5000))
    }

    function start() {
      if (!alive || paused || !Ctor) return
      if (restartTimer) clearTimeout(restartTimer)
      restartTimer = null
      const r = new Ctor()
      rec = r
      r.lang = lang
      r.continuous = true
      r.interimResults = true
      r.maxAlternatives = 1
      r.onresult = onResult
      r.onerror = ev => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'audio-capture') {
          fatal('The microphone is blocked, so hands-free was turned off. Allow the microphone, then turn it on again.')
        }
        // no-speech, aborted, network: the end handler restarts it
      }
      r.onend = () => {
        if (rec === r) rec = null
        schedule()
      }
      // a new session starts counting results from 0 again
      done.clear()
      wakeIdx = awaiting ? -1 : null
      startedAt = Date.now()
      try {
        r.start()
      } catch {
        schedule()
      }
    }

    const getLock = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<LockLike> } }).wakeLock
        if (wl && !lock) lock = await wl.request('screen')
      } catch {
        // the screen may sleep on this phone: hands-free then pauses until the screen is back
      }
    }

    const onVisibility = () => {
      if (document.hidden) {
        paused = true
        if (restartTimer) clearTimeout(restartTimer)
        restartTimer = null
        rec?.abort()
        lock = null // the system drops the lock when the page is hidden
      } else if (alive) {
        paused = false
        void getLock()
        if (!rec) start()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    goArmed()
    void getLock()
    start()

    return () => {
      alive = false
      clearSleep()
      if (restartTimer) clearTimeout(restartTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      rec?.abort()
      void lock?.release().catch(() => undefined)
    }
  }, [enabled, lang, wake])

  return { phase, heard }
}
