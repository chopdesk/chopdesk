'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { loadAuthState, getSession, signOut } from '@/lib/auth'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError('')

    // A saved copy lets the app open instantly; the real check runs in the background.
    if (getSession()) setReady(true)

    loadAuthState()
      .then(async (state) => {
        if (cancelled) return
        if (state.status === 'ready') {
          setReady(true)
          return
        }
        if (state.status === 'no_business') {
          router.replace('/auth/signup?step=business')
          return
        }
        if (state.status === 'suspended') {
          await signOut()
        }
        router.replace('/auth/login')
      })
      .catch((err) => {
        if (cancelled) return
        if (!getSession()) {
          setError(err instanceof Error ? err.message : 'Could not load your account')
        }
      })

    return () => {
      cancelled = true
    }
  }, [router, attempt])

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center bg-white">
        <p className="t-body text-text-secondary mb-6">{error}</p>
        <button className="btn-primary" onClick={() => setAttempt((a) => a + 1)}>
          Try again
        </button>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-7 h-7 border-[3px] border-border border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}