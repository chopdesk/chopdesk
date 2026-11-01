'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

type Key = 'login' | 'signup'

type VTDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => unknown
}

const tabs: { key: Key; label: string; path: string }[] = [
  { key: 'login', label: 'Sign in', path: '/auth/login' },
  { key: 'signup', label: 'Create account', path: '/auth/signup' },
]

// Runs before paint in the browser, and falls back to useEffect during server prerender
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export default function AuthTabs() {
  const router = useRouter()
  const pathname = usePathname() || ''
  const current: Key = pathname.startsWith('/auth/signup') ? 'signup' : 'login'

  const [active, setActive] = useState<Key>(current)
  const [invite, setInvite] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const settle = useRef<(() => void) | null>(null)

  // Entrance animation is on when arriving at the auth pages, and cleaned up on leaving
  useIsoLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.authEnter = 'true'
    return () => {
      delete root.dataset.authEnter
      delete root.dataset.authDir
      if (settle.current) settle.current()
    }
  }, [])

  // Warm up both pages so a switch is instant
  useEffect(() => {
    router.prefetch('/auth/login')
    router.prefetch('/auth/signup')
  }, [router])

  // Stay in sync with the real route, and tell a running transition the new page is in place
  useIsoLayoutEffect(() => {
    setActive(current)
    if (settle.current) {
      const done = settle.current
      settle.current = null
      done()
    }
  }, [current])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setInvite(params.get('invite'))
    setHidden(params.get('step') === 'business')
  }, [pathname])

  if (hidden) return null

  const suffix = invite ? '?invite=' + encodeURIComponent(invite) : ''

  const onTabClick = (e: React.MouseEvent, key: Key, href: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return
    }
    e.preventDefault()
    if (key === active) return

    const root = document.documentElement
    root.dataset.authDir = key === 'signup' ? 'forward' : 'back'
    setActive(key)

    const doc = document as VTDocument
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (doc.startViewTransition && !reduceMotion) {
      // The browser cross-dissolves the old and new form together
      delete root.dataset.authEnter
      doc.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            settle.current = resolve
            router.push(href)
            window.setTimeout(resolve, 1500) // safety: never hang if navigation stalls
          })
      )
    } else {
      // Browsers without view transitions: switch at once, new form eases in
      root.dataset.authEnter = 'true'
      router.push(href)
    }
  }

  return (
    <div className="auth-tabs relative mb-8 grid grid-cols-2 overflow-hidden rounded-[14px] bg-bg-subtle p-1">
      <span
        aria-hidden
        className="auth-indicator absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-[10px] bg-white shadow-sm"
        style={{ transform: active === 'signup' ? 'translateX(100%)' : 'translateX(0)' }}
      />
      {tabs.map((tab) => {
        const href = tab.path + suffix
        return (
          <Link
            key={tab.key}
            href={href}
            onClick={(e) => onTabClick(e, tab.key, href)}
            aria-current={current === tab.key ? 'page' : undefined}
            className={`relative z-10 flex h-11 items-center justify-center rounded-[10px] text-sm font-semibold transition-[color,transform] duration-200 active:scale-[0.96] ${
              active === tab.key ? 'text-primary' : 'text-text-secondary'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
