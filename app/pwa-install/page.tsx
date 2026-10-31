'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

const DISMISS_KEY = 'chopdesk_install_dismissed_at'
const HIDE_FOR_MS = 14 * 24 * 60 * 60 * 1000

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    return raw ? Date.now() - Number(raw) < HIDE_FOR_MS : false
  } catch {
    return false
  }
}

export default function PWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<InstallPromptEvent | null>(null)
  const [showInstall, setShowInstall] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as InstallPromptEvent)
      if (!recentlyDismissed()) setShowInstall(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
    setShowInstall(false)
  }

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // storage unavailable - the banner just hides for this visit
    }
    setShowInstall(false)
  }

  if (!showInstall) return null

  return (
    <div className="fixed left-4 right-4 z-50 safe-bottom" style={{ bottom: 'calc(68px + 16px)' }}>
      <div className="bg-white rounded-[10px] border border-border p-4 flex items-center gap-3 shadow-lg">
        <div className="flex-1">
          <p className="t-body font-medium text-text-primary">Install App</p>
          <p className="t-small text-text-secondary">Add to home screen for faster access</p>
        </div>
        <button onClick={handleInstall} className="btn-primary py-2 px-4 min-h-0">
          Install
        </button>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="text-text-muted min-h-0 min-w-0 w-9 h-9 flex items-center justify-center"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  )
}