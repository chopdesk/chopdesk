// lib/toast.tsx
'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

type Toast = {
  id: string
  message: string
  type: ToastType
}

type ToastContextType = {
  toast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3500)
  }, [])

  const remove = (id: string) => setToasts(prev => prev.filter(t => t.id !== id))

  const icons: Record<ToastType, string> = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  }

  const colors: Record<ToastType, string> = {
    success: 'bg-white border-l-4 border-l-[#2E7D32]',
    error:   'bg-white border-l-4 border-l-[#C62828]',
    warning: 'bg-white border-l-4 border-l-[#E65100]',
    info:    'bg-white border-l-4 border-l-[#1565C0]',
  }

  const iconColors: Record<ToastType, string> = {
    success: 'text-[#2E7D32]',
    error:   'text-[#C62828]',
    warning: 'text-[#E65100]',
    info:    'text-[#1565C0]',
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast container - FIXED: Added safe area insets */}
      <div 
        className="fixed left-0 right-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none"
        style={{ 
          top: 'max(1rem, env(safe-area-inset-top, 1rem))',
        }}
      >
        {toasts.map(t => (
          <div
            key={t.id}
            className={`
              ${colors[t.type]}
              w-full max-w-sm rounded-[10px] shadow-sm border border-border
              flex items-start gap-3 px-4 py-3
              pointer-events-auto
              animate-in slide-in-from-top-2 duration-200
            `}
          >
            <span className={`${iconColors[t.type]} t-label mt-0.5 flex-shrink-0`}>
              {icons[t.type]}
            </span>
            <p className="t-body text-text-primary flex-1 break-words">{t.message}</p>
            <button
              onClick={() => remove(t.id)}
              className="text-text-muted hover:text-text-primary flex-shrink-0 min-h-0 min-w-0 w-5 h-5 flex items-center justify-center rounded-full"
              aria-label="Close notification"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx.toast
}