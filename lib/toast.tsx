// lib/toast.tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Info, X, XCircle, type LucideIcon } from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

export type ToastAction = { label: string; onClick: () => void }

export type AlertOptions = {
  title: string
  message: string
  tone?: 'error' | 'warning'
  actionLabel?: string // main button, defaults to "OK"
  onAction?: () => void
  cancelLabel?: string // adds a quiet second button
}

type ToastItem = {
  id: number
  message: string
  type: ToastType
  action?: ToastAction
  duration: number
  leaving: boolean
}

type AlertState = AlertOptions & { id: number; closing: boolean }

type ToastFn = (message: string, type?: ToastType, action?: ToastAction) => void
type AlertFn = (options: AlertOptions) => void

const ToastContext = createContext<{ toast: ToastFn; alert: AlertFn } | null>(null)

const MAX_VISIBLE = 2
const EXIT_MS = 320
const MIN_RESUME_MS = 1200
const SPRING = 'ease-spring'

const DURATIONS: Record<ToastType, number> = {
  success: 3000,
  info: 4000,
  warning: 5000,
  error: 10000,
}

const ICONS: Record<ToastType, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

// Tinted circle behind the icon, one per type (all colours come from the theme tokens)
const TINTS: Record<ToastType, string> = {
  success: 'bg-success/10 text-success',
  error: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
}

type Timer = { handle: ReturnType<typeof setTimeout> | null; left: number; startedAt: number }

export function ToastProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || ''
  const inDashboard = pathname.startsWith('/dashboard')

  const [items, setItems] = useState<ToastItem[]>([])
  const [dialog, setDialog] = useState<AlertState | null>(null)
  const itemsRef = useRef<ToastItem[]>([])
  const timers = useRef(new Map<number, Timer>())
  const idRef = useRef(0)

  const commit = useCallback((next: ToastItem[]) => {
    itemsRef.current = next
    setItems(next)
  }, [])

  const dismiss = useCallback(
    (id: number) => {
      const t = timers.current.get(id)
      if (t?.handle) clearTimeout(t.handle)
      timers.current.delete(id)
      commit(itemsRef.current.map((i) => (i.id === id ? { ...i, leaving: true } : i)))
      setTimeout(() => {
        commit(itemsRef.current.filter((i) => i.id !== id))
      }, EXIT_MS)
    },
    [commit]
  )

  const startTimer = useCallback(
    (id: number, ms: number) => {
      const old = timers.current.get(id)
      if (old?.handle) clearTimeout(old.handle)
      const handle = setTimeout(() => dismiss(id), ms)
      timers.current.set(id, { handle, left: ms, startedAt: Date.now() })
    },
    [dismiss]
  )

  const pause = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (!t || !t.handle) return
    clearTimeout(t.handle)
    t.left = Math.max(MIN_RESUME_MS, t.left - (Date.now() - t.startedAt))
    t.handle = null
  }, [])

  const resume = useCallback(
    (id: number) => {
      const t = timers.current.get(id)
      if (!t || t.handle) return
      startTimer(id, t.left)
    },
    [startTimer]
  )

  const toast = useCallback<ToastFn>(
    (message, type = 'info', action) => {
      const live = itemsRef.current.filter((i) => !i.leaving)

      // Same message already showing: keep it, just restart its timer
      const same = live.find((i) => i.message === message && i.type === type)
      if (same) {
        if (action) {
          commit(itemsRef.current.map((i) => (i.id === same.id ? { ...i, action } : i)))
        }
        startTimer(same.id, same.duration)
        return
      }

      const id = ++idRef.current
      // Toasts with a button stay 5 seconds longer so they can be tapped
      const duration = action ? DURATIONS[type] + 5000 : DURATIONS[type]
      commit([...itemsRef.current, { id, message, type, action, duration, leaving: false }])
      startTimer(id, duration)

      // A short buzz on phones that support it (iPhone ignores this)
      if (type === 'error' && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([40, 60, 40])
        } catch {
          // not allowed right now - the visual alert is enough
        }
      }

      // Never more than MAX_VISIBLE: the oldest ones leave first
      const overflow = live.length + 1 - MAX_VISIBLE
      for (let n = 0; n < overflow; n++) dismiss(live[n].id)
    },
    [commit, dismiss, startTimer]
  )

  const alert = useCallback<AlertFn>((options) => {
    setDialog({ ...options, id: ++idRef.current, closing: false })
  }, [])

  const closeDialog = useCallback((id: number) => {
    setDialog((d) => (d && d.id === id ? { ...d, closing: true } : d))
    setTimeout(() => {
      setDialog((d) => (d && d.id === id ? null : d))
    }, EXIT_MS)
  }, [])

  useEffect(() => {
    const map = timers.current
    return () => {
      map.forEach((t) => {
        if (t.handle) clearTimeout(t.handle)
      })
      map.clear()
    }
  }, [])

  const value = useMemo(() => ({ toast, alert }), [toast, alert])

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* Sits just under the dashboard header and is centred in the content area (clear of the sidebar) */}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className={`pointer-events-none fixed inset-x-0 z-[100] flex flex-col items-center px-4 ${
          inDashboard ? 'md:left-56' : ''
        }`}
        style={{
          top: inDashboard
            ? 'calc(env(safe-area-inset-top, 0px) + 60px)'
            : 'max(1rem, env(safe-area-inset-top, 1rem))',
        }}
      >
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onClose={dismiss} onPause={pause} onResume={resume} />
        ))}
      </div>

      {dialog && <AlertDialog key={dialog.id} dialog={dialog} onClose={closeDialog} />}
    </ToastContext.Provider>
  )
}

function ToastCard({
  item,
  onClose,
  onPause,
  onResume,
}: {
  item: ToastItem
  onClose: (id: number) => void
  onPause: (id: number) => void
  onResume: (id: number) => void
}) {
  const [shown, setShown] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const isError = item.type === 'error'

  // Two frames so the browser paints the closed state first (this is what makes the entrance animate on iPhone)
  useEffect(() => {
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setShown(true))
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [])

  // Errors give a short shake once they have landed (skipped for people who prefer reduced motion)
  useEffect(() => {
    if (!shown || !isError) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    cardRef.current?.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-7px)' },
        { transform: 'translateX(6px)' },
        { transform: 'translateX(-4px)' },
        { transform: 'translateX(3px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 420, delay: 380, easing: 'ease-out' }
    )
  }, [shown, isError])

  const open = shown && !item.leaving
  const Icon = ICONS[item.type]

  return (
    <div
      className={`grid w-full max-w-sm transition-[grid-template-rows,opacity,transform] motion-reduce:transition-none ${
        open
          ? `grid-rows-[1fr] translate-y-0 opacity-100 duration-500 ${SPRING}`
          : 'grid-rows-[0fr] -translate-y-3 opacity-0 duration-300 ease-standard'
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="px-1 pb-2 pt-1">
          <div
            ref={cardRef}
            role={isError ? 'alert' : 'status'}
            onPointerEnter={() => onPause(item.id)}
            onPointerLeave={() => onResume(item.id)}
            onPointerDown={() => onPause(item.id)}
            onPointerUp={() => onResume(item.id)}
            onPointerCancel={() => onResume(item.id)}
            className={`flex items-center gap-3 rounded-lg bg-white shadow-lg ${
              isError
                ? 'border-2 border-danger/50 bg-gradient-to-r from-danger/5 to-danger/5 p-4'
                : 'border border-border p-3'
            } ${open ? 'pointer-events-auto' : 'pointer-events-none'}`}
          >
            <span
              className={`flex shrink-0 items-center justify-center rounded-full ${
                isError ? 'h-10 w-10 bg-danger text-white' : `h-9 w-9 ${TINTS[item.type]}`
              }`}
            >
              <Icon size={isError ? 22 : 18} />
            </span>

            <p
              className={`t-body min-w-0 flex-1 break-words text-text-primary ${isError ? 'font-medium' : ''}`}
            >
              {item.message}
            </p>

            {item.action && (
              <button
                onClick={() => {
                  item.action?.onClick()
                  onClose(item.id)
                }}
                className={`t-label h-8 min-h-0 shrink-0 rounded-sm px-3 transition-colors duration-150 ${
                  isError
                    ? 'bg-danger text-white hover:opacity-90 active:opacity-90'
                    : 'text-primary hover:bg-primary-light active:bg-primary-light'
                }`}
              >
                {item.action.label}
              </button>
            )}

            <button
              onClick={() => onClose(item.id)}
              aria-label="Close notification"
              className="flex h-8 w-8 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AlertDialog({ dialog, onClose }: { dialog: AlertState; onClose: (id: number) => void }) {
  const [shown, setShown] = useState(false)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const messageId = useId()
  const tone = dialog.tone ?? 'error'
  const Icon = tone === 'warning' ? AlertTriangle : XCircle

  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true })
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setShown(true))
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(dialog.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog.id, onClose])

  const open = shown && !dialog.closing

  return (
    <div
      className={`fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-6 transition-opacity motion-reduce:transition-none ${
        open ? 'opacity-100 duration-300' : 'pointer-events-none opacity-0 duration-200'
      }`}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className={`w-full max-w-sm rounded-lg bg-white p-6 text-center shadow-2xl transition-[transform,opacity] motion-reduce:transition-none ${
          open ? `scale-100 opacity-100 duration-500 ${SPRING}` : 'scale-95 opacity-0 duration-200 ease-in'
        }`}
      >
        <span
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${TINTS[tone]}`}
        >
          <Icon size={28} />
        </span>

        <h2 id={titleId} className="t-h3 mt-4 text-text-primary">
          {dialog.title}
        </h2>
        <p id={messageId} className="t-body mt-2 text-text-secondary">
          {dialog.message}
        </p>

        <button
          ref={primaryRef}
          onClick={() => {
            dialog.onAction?.()
            onClose(dialog.id)
          }}
          className="btn-primary mt-6 w-full"
        >
          {dialog.actionLabel ?? 'OK'}
        </button>

        {dialog.cancelLabel && (
          <button
            onClick={() => onClose(dialog.id)}
            className="t-label mt-1 flex h-11 min-h-0 w-full items-center justify-center text-text-muted"
          >
            {dialog.cancelLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx.toast
}

export function useAlert() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useAlert must be used inside ToastProvider')
  return ctx.alert
}