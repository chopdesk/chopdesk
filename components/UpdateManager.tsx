'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useOnlineStatus } from '@/components/ConnectionStatus'

// The build ID this copy of the app was built with (see next.config.ts)
const CURRENT_VERSION = process.env.NEXT_PUBLIC_BUILD_ID || 'dev'
const SHORT_VERSION = CURRENT_VERSION.slice(0, 7)

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.version === 'string' ? data.version : null
  } catch {
    return null
  }
}

// Clears the old service worker and saved copies of the app, then reloads
// from the network. Login and the saved cart live in localStorage and
// sessionStorage, which this does not touch.
async function hardUpdate() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } finally {
    window.location.reload()
  }
}

function useUpdateCheck() {
  const [latest, setLatest] = useState<string | null>(null)

  const check = useCallback(async () => {
    const v = await fetchLatestVersion()
    if (v) setLatest(v)
  }, [])

  useEffect(() => {
    check()
    const interval = setInterval(check, 60000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', check)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', check)
    }
  }, [check])

  const updateAvailable = !!latest && latest !== CURRENT_VERSION
  return { latest, updateAvailable }
}

// Floating card shown when a newer version is live
export default function UpdateBanner() {
  const { latest, updateAvailable } = useUpdateCheck()
  const online = useOnlineStatus()
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)

  if (!online || !updateAvailable || dismissedFor === latest) return null

  const run = async () => {
    setUpdating(true)
    await hardUpdate()
  }

  return (
    <div className="fixed top-24 left-3 right-3 md:left-auto md:right-6 md:w-96 z-40 bg-white border border-primary/30 shadow-lg rounded-xl p-3 flex items-center gap-3">
      <RefreshCw size={18} className="text-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary">New update available</p>
        <p className="text-xs text-text-secondary">Update between orders to get the latest fixes.</p>
      </div>
      <button
        onClick={run}
        disabled={!online || updating}
        className="bg-primary text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-50 min-h-0"
      >
        {updating ? 'Updating...' : 'Update'}
      </button>
      <button
        onClick={() => setDismissedFor(latest)}
        aria-label="Dismiss"
        className="text-text-muted min-h-0 min-w-0 p-1"
      >
        <X size={16} />
      </button>
    </div>
  )
}

// Always-available hard update button (for the menu drawer and desktop sidebar)
export function UpdateButton() {
  const { updateAvailable } = useUpdateCheck()
  const online = useOnlineStatus()
  const [updating, setUpdating] = useState(false)

  const run = async () => {
    if (!online) return
    setUpdating(true)
    await hardUpdate()
  }

  return (
    <div>
      <button
        onClick={run}
        disabled={!online || updating}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-[12px] border border-border text-text-secondary t-label hover:bg-bg-subtle transition-colors disabled:opacity-50"
      >
        <RefreshCw size={16} className={updating ? 'animate-spin' : ''} />
        <span>
          {updating ? 'Updating...' : online ? 'Update app' : 'Update app (needs internet)'}
        </span>
        {updateAvailable && !updating && (
          <span className="text-xs bg-orange-500 text-white rounded-full px-2 py-0.5">New</span>
        )}
      </button>
      <p className="text-center text-[11px] text-text-muted mt-1">Version {SHORT_VERSION}</p>
    </div>
  )
}
