'use client'

import { useEffect, useState } from 'react'

export default function PWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [showInstall, setShowInstall] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

    const handler = (e: any) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShowInstall(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
    setShowInstall(false)
  }

  if (!showInstall) return null

  return (
    <div className="fixed left-4 right-4 z-50 safe-bottom" style={{ bottom: 'calc(68px + 16px)' }}>
      <div className="bg-white rounded-[10px] border border-border p-4 flex items-center justify-between shadow-lg">
        <div className="flex-1">
          <p className="t-body font-medium text-text-primary">Install App</p>
          <p className="t-small text-text-secondary">Add to home screen for faster access</p>
        </div>
        <button 
          onClick={handleInstall} 
          className="btn-primary py-2 px-4 min-h-0"
        >
          Install
        </button>
      </div>
    </div>
  )
}