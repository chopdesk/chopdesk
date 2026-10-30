'use client'

import { useRouter } from 'next/navigation'
import { Clock } from 'lucide-react'

export default function PendingPage() {
  const router = useRouter()

  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* Top brand section */}
      <div className="bg-primary px-6 pt-16 pb-10">
        <h1 className="t-brand text-white">Uptimyzas Kitchen</h1>
        <p className="t-small text-white/60 mt-2 tracking-widest uppercase">
          Restaurant Management System
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-[#E65100]/10 flex items-center justify-center mb-6">
          <Clock size={32} className="text-[#E65100]" />
        </div>

        <h2 className="t-h1 text-text-primary mb-3">Awaiting Approval</h2>

        <p className="t-body text-text-secondary max-w-xs leading-relaxed mb-2">
          Your account has been created and is pending admin approval.
        </p>
        <p className="t-body text-text-secondary max-w-xs leading-relaxed mb-10">
          You'll be able to sign in once an admin approves your request.
        </p>

        <button
          onClick={() => router.push('/auth/login')}
          className="btn-primary w-full max-w-xs"
        >
          Back to Sign In
        </button>
      </div>

    </div>
  )
}