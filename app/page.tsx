'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    const session = getSession()
    if (session) {
      router.push('/dashboard')
    } else {
      router.replace('/auth/login')
    }
  }, [router])

  return (
    <div className="min-h-screen flex flex-col bg-primary">
      <div className="flex-1 flex flex-col items-center justify-center text-white text-center px-6">
        <h1 className="t-brand text-white">Uptimyzas Kitchen</h1>
        <p className="t-small text-white/60 mt-2 tracking-widest uppercase">
          Restaurant Management System
        </p>
        <div className="mt-10 w-7 h-7 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
      </div>
      <p className="t-small text-white/40 text-center pb-8">
        Powered by Uptimyzas Ventures
      </p>
    </div>
  )
}