'use client'

import { useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { usePathname } from 'next/navigation'
import Logo from '@/components/brand/Logo'
import ReportCard from '@/components/brand/ReportCard'
import { ChecklistCard, ReceiptCard, StockCard } from '@/components/brand/PanelCards'

type Scenario = 'login' | 'signup'
type Phase = 'down' | 'up'
type CardComponent = ComponentType<{ className?: string }>

const scenes: Record<
  Scenario,
  { lines: [string, string]; sub: string; cards: CardComponent[] }
> = {
  login: {
    lines: ['Welcome back.', 'Your shift is ready.'],
    sub: 'Your sales, stock and team are right where you left them.',
    cards: [ReportCard, StockCard],
  },
  signup: {
    lines: ['Beat the rush hour.', 'Ditch the paper.'],
    sub: 'Take orders in seconds, track stock live and close every shift with a clear report. Set up in minutes.',
    cards: [ChecklistCard, ReceiptCard],
  },
}

const TYPE_MS = 42 // time per character
const RISE_MS = 1100 // card rising
const HOLD_MS = 4200 // card resting in view
const SINK_MS = 650 // card sinking
const GAP_MS = 450 // pause before the next card
const SWAP_MS = 720 // wait until the card is fully out of sight before changing scenes

export default function AuthPanel() {
  const pathname = usePathname() || ''
  const scenario: Scenario = pathname.startsWith('/auth/signup') ? 'signup' : 'login'

  const [shown, setShown] = useState<Scenario>(scenario)
  const [epoch, setEpoch] = useState(0)
  const [textVisible, setTextVisible] = useState(false)
  const [typed, setTyped] = useState(0)
  const [caretOn, setCaretOn] = useState(true)
  const [showSub, setShowSub] = useState(false)
  const [cardIdx, setCardIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('down')

  const lastScenario = useRef<Scenario>(scenario)
  const swapTimer = useRef<number | null>(null)
  const timersRef = useRef<number[]>([])

  const clearTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t))
    timersRef.current = []
  }

  // Route changed: hide everything now, stop the old scene, then restart for the new scene
  useEffect(() => {
    if (lastScenario.current === scenario) return
    lastScenario.current = scenario

    clearTimers()
    setTextVisible(false)
    setPhase('down')

    if (swapTimer.current) window.clearTimeout(swapTimer.current)
    swapTimer.current = window.setTimeout(() => {
      // One render: nothing from the old scene can show through
      setShown(lastScenario.current)
      setTyped(0)
      setShowSub(false)
      setCaretOn(true)
      setCardIdx(0)
      setEpoch((e) => e + 1)
    }, SWAP_MS)
  }, [scenario])

  useEffect(
    () => () => {
      if (swapTimer.current) window.clearTimeout(swapTimer.current)
      clearTimers()
    },
    []
  )

  // Choreography for the scene on screen: reveal, type the headline, then loop the cards
  useEffect(() => {
    const scene = scenes[shown]
    const text = scene.lines[0] + scene.lines[1]
    const total = text.length

    const later = (fn: () => void, ms: number) => {
      timersRef.current.push(window.setTimeout(fn, ms))
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTyped(total)
      setCaretOn(false)
      setShowSub(true)
      setCardIdx(0)
      setPhase('up')
      setTextVisible(true)
      return
    }

    setTyped(0)
    setCaretOn(true)
    setShowSub(false)
    setCardIdx(0)
    setPhase('down')

    const cycle = (idx: number) => {
      setCardIdx(idx) // swapped while the card is out of sight
      later(() => setPhase('up'), 80)
      later(() => setPhase('down'), 80 + RISE_MS + HOLD_MS)
      later(
        () => cycle((idx + 1) % scene.cards.length),
        80 + RISE_MS + HOLD_MS + SINK_MS + GAP_MS
      )
    }

    let i = 0
    const type = () => {
      i += 1
      setTyped(i)
      if (i < total) {
        const ch = text[i - 1]
        later(type, TYPE_MS + (ch === '.' || ch === ',' ? 240 : 0))
      } else {
        later(() => setCaretOn(false), 900)
        later(() => setShowSub(true), 300)
        later(() => cycle(0), 1000)
      }
    }

    later(() => setTextVisible(true), 150)
    later(type, 350)

    return () => clearTimers()
  }, [shown, epoch])

  const scene = scenes[shown]
  const [l1, l2] = scene.lines
  const t1 = l1.slice(0, typed)
  const t2 = l2.slice(0, Math.max(0, typed - l1.length))
  const onLine1 = typed < l1.length
  const Card = scene.cards[cardIdx % scene.cards.length]

  return (
    <>
      <div className="relative z-10 flex w-full flex-col p-10 pb-[17rem] lg:p-14 lg:pb-[17rem]">
        <Logo size={44} tone="light" />

        <div
          className="mt-14 max-w-xl lg:mt-20"
          style={{
            opacity: textVisible ? 1 : 0,
            transition: textVisible ? 'none' : 'opacity 280ms ease',
          }}
        >
          <h2
            aria-label={`${l1} ${l2}`}
            className="text-4xl font-bold leading-[1.08] tracking-tight lg:text-5xl"
          >
            <span aria-hidden="true">
              {t1}
              {onLine1 && caretOn && <span className="auth-caret" />}
              <span className="invisible">{l1.slice(t1.length)}</span>
            </span>
            <br />
            <span aria-hidden="true" className="text-accent">
              {t2}
              {!onLine1 && caretOn && <span className="auth-caret" />}
              <span className="invisible">{l2.slice(t2.length)}</span>
            </span>
          </h2>

          <p
            className="mt-6 max-w-md text-lg text-white/70"
            style={{
              opacity: showSub ? 1 : 0,
              transform: showSub ? 'none' : 'translateY(12px)',
              transition: showSub
                ? 'opacity 700ms ease, transform 700ms cubic-bezier(0.22, 1, 0.36, 1)'
                : 'none',
            }}
          >
            {scene.sub}
          </p>
        </div>
      </div>

      <div
        className="auth-peek absolute bottom-0 left-10 right-10 z-10 max-w-sm lg:left-14 lg:right-14"
        data-phase={phase}
        aria-hidden="true"
      >
        <div className="auth-float">
          <Card />
        </div>
      </div>
    </>
  )
}
