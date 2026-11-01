'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

type Key = 'login' | 'signup'

type VTDocument = Document & {
  startViewTransition?: (update: () => Promise<void>) => { finished: Promise<unknown> }
}

const tabs: { key: Key; label: string; path: string }[] = [
  { key: 'login', label: 'Sign in', path: '/auth/login' },
  { key: 'signup', label: 'Create account', path: '/auth/signup' },
]

export default function AuthTabs() {
  const router = useRouter()
  const pathname = usePathname() || ''
  const current: Key = pathname.startsWith('/auth/signup') ? 'signup' : 'login'

  const [active, setActive] = useState<Key>(current)
  const [invite, setInvite] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<(() => void) | null>(null)

  // Stay in sync with the real route, and let a running transition capture the new page
  useEffect(() => {
    setActive(current)
    delete document.documentElement.dataset.authLeaving
    if (pending.current) {
      const done = pending.current
      pending.current = null
      requestAnimationFrame(() => done())
    }
  }, [current])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setInvite(params.get('invite'))
    setHidden(params.get('step') === 'business')
  }, [pathname])

  // Clean up when leaving the auth pages
  useEffect(() => {
    return () => {
      delete document.documentElement.dataset.authDir
      delete document.documentElement.dataset.authLeaving
      delete document.documentElement.dataset.authVt
      if (timer.current) clearTimeout(timer.current)
      if (pending.current) pending.current()
    }
  }, [])

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

    const doc = document as VTDocument
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Best path: the browser cross-dissolves the old and new form together
    if (doc.startViewTransition && !reduceMotion) {
      root.dataset.authVt = 'true'
      const transition = doc.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            pending.current = resolve
            router.push(href)
            setTimeout(resolve, 1200) // safety: never hang if navigation stalls
          })
      )
      const cleanup = () => {
        delete root.dataset.authVt
      }
      transition.finished.then(cleanup, cleanup)
      return
    }

    // Fallback: short exit, then the new form eases in
    root.dataset.authLeaving = 'true'
    setActive(key)
    timer.current = setTimeout(() => router.push(href), 180)
    setTimeout(() => {
      delete root.dataset.authLeaving
    }, 2000)
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
