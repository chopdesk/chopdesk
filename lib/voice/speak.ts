'use client'

// lib/voice/speak.ts
// The assistant's spoken reply. One place for it, so every screen talks the same way.
// say(text, then): speaks, then runs `then` (for example "listen again").
// If staff close the assistant or tap the mic in the meantime, `then` is dropped.
// The on/off choice is remembered on this phone and shared with the Orders screen.

import { useCallback, useEffect, useRef, useState } from 'react'

export function useSpeaker() {
  const [on, setOn] = useState(true)
  const onRef = useRef(true)
  // counts up every time speaking is cancelled, so late callbacks know they are out of date
  const run = useRef(0)

  useEffect(() => {
    try {
      const v = localStorage.getItem('voice_reply') !== '0'
      setOn(v)
      onRef.current = v
    } catch {
      // storage blocked: the default stays
    }
    return () => {
      run.current++
      try {
        window.speechSynthesis?.cancel()
      } catch {
        // ignore
      }
    }
  }, [])

  const cancel = useCallback(() => {
    run.current++
    try {
      window.speechSynthesis?.cancel()
    } catch {
      // ignore
    }
  }, [])

  const say = useCallback((text: string, then?: () => void) => {
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
    const canSpeak = onRef.current && typeof window !== 'undefined' && 'speechSynthesis' in window
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
  }, [])

  const toggle = useCallback(() => {
    const next = !onRef.current
    onRef.current = next
    setOn(next)
    if (!next) cancel()
    try {
      if (next) localStorage.removeItem('voice_reply')
      else localStorage.setItem('voice_reply', '0')
    } catch {
      // ignore: it just will not be remembered
    }
  }, [cancel])

  return { on, say, cancel, toggle }
}
