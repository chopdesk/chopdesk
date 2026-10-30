'use client'

import { useEffect, useRef, useState } from 'react'

// A real connectivity check: navigator.onLine only says whether the phone is
// attached to a network, not whether the internet actually works. HEAD requests
// skip the service worker, so this always hits the real network.
async function checkConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    await fetch('/', { method: 'HEAD', cache: 'no-store', signal: controller.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    let active = true
    const run = async () => {
      const result = await checkConnection()
      if (active) setOnline(result)
    }
    const goOffline = () => setOnline(false)

    run()
    window.addEventListener('online', run)
    window.addEventListener('offline', goOffline)
    document.addEventListener('visibilitychange', run)
    const interval = setInterval(run, 30000)

    return () => {
      active = false
      window.removeEventListener('online', run)
      window.removeEventListener('offline', goOffline)
      document.removeEventListener('visibilitychange', run)
      clearInterval(interval)
    }
  }, [])

  return online
}

export default function ConnectionStatus({ variant = 'banner' }: { variant?: 'banner' | 'dot' }) {
  const online = useOnlineStatus()
  const [showBackOnline, setShowBackOnline] = useState(false)
  const wasOffline = useRef(false)

  useEffect(() => {
    if (!online) {
      wasOffline.current = true
      setShowBackOnline(false)
      return undefined
    }
    if (wasOffline.current) {
      wasOffline.current = false
      setShowBackOnline(true)
      const timer = setTimeout(() => setShowBackOnline(false), 3000)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [online])

  if (variant === 'dot') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium">
        <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
        <span className={online ? 'text-green-700' : 'text-red-600'}>
          {online ? 'Online' : 'Offline'}
        </span>
      </span>
    )
  }

  if (online && !showBackOnline) return null

  return (
    <div
      className={`w-full text-center text-xs font-medium py-1.5 px-3 text-white ${
        online ? 'bg-green-600' : 'bg-red-600'
      }`}
    >
      {online ? 'Back online' : "You're offline. Check your data or Wi-Fi."}
    </div>
  )
}
