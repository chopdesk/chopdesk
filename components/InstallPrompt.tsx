'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { Download, Gauge, Maximize, Share, SquarePlus, Zap } from 'lucide-react'
import Logo from '@/components/brand/Logo'
import { brand } from '@/lib/brand'

// ---------------------------------------------------------------------------
// Shared install state. Lives outside React so the card and the menu buttons
// see the same browser install event, and so the event is caught early.
// ---------------------------------------------------------------------------

type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type InstallState = {
  canPrompt: boolean // Chrome / Android: the browser can show its own install dialog
  ios: boolean // iPhone / iPad: install is manual (Share > Add to Home Screen)
  installed: boolean // already running as an installed app
  forced: number // goes up each time the menu button asks to open the card
}

const SERVER_STATE: InstallState = { canPrompt: false, ios: false, installed: false, forced: 0 }

let state: InstallState = SERVER_STATE
let deferred: InstallEvent | null = null
let started = false
const listeners = new Set<() => void>()

function update(patch: Partial<InstallState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function detectIos(): boolean {
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || iPadOS
}

function detectInstalled(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  state = { ...state, ios: detectIos(), installed: detectInstalled() }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallEvent
    update({ canPrompt: true })
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    update({ canPrompt: false, installed: true })
  })
}

start()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE)
}

async function promptInstall(): Promise<void> {
  const event = deferred
  if (!event) return
  deferred = null // the browser only allows one use per event
  update({ canPrompt: false })
  await event.prompt()
  await event.userChoice
}

function requestGuide() {
  update({ forced: state.forced + 1 })
}

// ---------------------------------------------------------------------------
// "Not now" memory: comes back after 1 day, then 3, then every 7.
// ---------------------------------------------------------------------------

const KEY = 'chopdesk_install_prompt'
const DAY = 24 * 60 * 60 * 1000
const GAPS = [1 * DAY, 3 * DAY, 7 * DAY]

function readDismissals(): { count: number; at: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null')
    return { count: Number(raw?.count) || 0, at: Number(raw?.at) || 0 }
  } catch {
    return { count: 0, at: 0 }
  }
}

function isDue(): boolean {
  const { count, at } = readDismissals()
  if (count === 0) return true
  return Date.now() - at >= GAPS[Math.min(count - 1, GAPS.length - 1)]
}

function recordDismissal() {
  const { count } = readDismissals()
  try {
    localStorage.setItem(KEY, JSON.stringify({ count: count + 1, at: Date.now() }))
  } catch {
    // storage unavailable - the card just stays hidden for this visit
  }
}

// Only calm screens. Pages with a fixed action bar (orders, payment, shifts) are left alone.
const CALM_PAGES = [
  '/dashboard',
  '/dashboard/stock',
  '/dashboard/menu',
  '/dashboard/team',
  '/dashboard/order-history',
  '/dashboard/shifts',
]

const SHOW_AFTER_MS = 3500
const EXIT_MS = 320

const BENEFITS = [
  { icon: Zap, text: 'Opens in one tap from your home screen' },
  { icon: Maximize, text: 'Full screen, no browser bars in the way' },
  { icon: Gauge, text: 'Faster to open when the rush hits' },
]

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export default function InstallPrompt() {
  const pathname = usePathname() || ''
  const path = pathname.replace(/\/+$/, '') || '/'
  const { canPrompt, ios, installed, forced } = useInstallState()

  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [guide, setGuide] = useState(false)
  const [closedThisVisit, setClosedThisVisit] = useState(false)
  const [pinned, setPinned] = useState(false) // opened from the menu, so keep it on any page

  // Keep the app updating itself: the service worker is registered here
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  const available = !installed && (canPrompt || ios)
  const eligible = available && !closedThisVisit && CALM_PAGES.includes(path)

  // Show the card shortly after landing on a calm page (if it is due)
  useEffect(() => {
    if (!eligible || !isDue()) return
    let raf = 0
    const timer = setTimeout(() => {
      setMounted(true)
      raf = requestAnimationFrame(() => setVisible(true))
    }, SHOW_AFTER_MS)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
  }, [eligible])

  // Hide when leaving a calm page
  useEffect(() => {
    if (eligible || pinned) return
    const timer = setTimeout(() => setVisible(false), 0)
    const gone = setTimeout(() => setMounted(false), EXIT_MS)
    return () => {
      clearTimeout(timer)
      clearTimeout(gone)
    }
  }, [eligible, pinned])

  // The menu "Install app" button on iPhone opens the card with the steps showing
  useEffect(() => {
    if (forced === 0) return
    const raf = requestAnimationFrame(() => {
      setGuide(true)
      setPinned(true)
      setMounted(true)
      requestAnimationFrame(() => setVisible(true))
    })
    return () => cancelAnimationFrame(raf)
  }, [forced])

  const close = (remember: boolean) => {
    if (remember) recordDismissal()
    setClosedThisVisit(true)
    setVisible(false)
    setTimeout(() => {
      setMounted(false)
      setGuide(false)
      setPinned(false)
    }, EXIT_MS)
  }

  const handlePrimary = () => {
    if (canPrompt) {
      close(false)
      promptInstall()
    } else {
      setGuide(true)
    }
  }

  if (!mounted || installed) return null

  return (
    <div
      role="dialog"
      aria-label={`Install ${brand.name}`}
      className={`fixed inset-x-3 bottom-[calc(var(--bottom-nav-h)+12px)] z-50 md:inset-x-auto md:bottom-6 md:right-6 md:w-[380px] overflow-hidden rounded-lg border border-primary/20 bg-white shadow-2xl motion-reduce:transition-none ${
        visible
          ? 'translate-y-0 opacity-100 duration-500 ease-spring'
          : 'pointer-events-none translate-y-10 opacity-0 duration-300 ease-in'
      } transition-[transform,opacity]`}
    >
      {/* Brand strip */}
      <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-accent" />

      <div className="p-4">
        <div className="flex items-center gap-3">
          <Logo size={48} showName={false} />
          <div className="min-w-0">
            <p className="t-h3 text-text-primary">Put {brand.name} on your home screen</p>
            <p className="t-small text-text-secondary">Open it in one tap, like a real app.</p>
          </div>
        </div>

        {guide && ios ? (
          <ol className="mt-4 flex flex-col gap-3">
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary">
                <Share size={16} />
              </span>
              <span className="t-body text-text-primary">
                Tap the <strong className="font-semibold">Share</strong> button at the bottom of Safari
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary">
                <SquarePlus size={16} />
              </span>
              <span className="t-body text-text-primary">
                Scroll down and tap <strong className="font-semibold">Add to Home Screen</strong>
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-light font-semibold text-accent">
                3
              </span>
              <span className="t-body text-text-primary">
                Tap <strong className="font-semibold">Add</strong>, then open {brand.name} from your home screen
              </span>
            </li>
          </ol>
        ) : (
          <ul className="mt-4 flex flex-col gap-2.5">
            {BENEFITS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary">
                  <Icon size={16} />
                </span>
                <span className="t-body text-text-primary">{text}</span>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={guide && ios ? () => close(true) : handlePrimary}
          className="btn-primary mt-4 w-full shadow-lg"
        >
          {guide && ios ? (
            'Got it'
          ) : canPrompt ? (
            <>
              <Download size={18} /> Install {brand.name}
            </>
          ) : (
            'Show me how'
          )}
        </button>

        <button
          onClick={() => close(true)}
          className="t-small mt-1 flex h-10 min-h-0 w-full items-center justify-center text-text-muted"
        >
          Not now
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Always-available button for the sidebar and the More sheet
// ---------------------------------------------------------------------------

export function InstallButton({ onAction }: { onAction?: () => void }) {
  const { canPrompt, ios, installed } = useInstallState()
  if (installed || (!canPrompt && !ios)) return null

  return (
    <button
      onClick={() => {
        onAction?.()
        if (canPrompt) promptInstall()
        else requestGuide()
      }}
      className="t-label mb-2 flex w-full items-center justify-center gap-2 rounded-[12px] bg-primary py-3 text-white transition-colors duration-150 hover:bg-primary-hover active:bg-primary-hover"
    >
      <Download size={16} />
      <span>Install {brand.name}</span>
    </button>
  )
}