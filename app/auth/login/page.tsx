'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from '@/lib/auth'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = await signIn(email, password)

    if (result.success && result.session) {
      router.push('/dashboard')
    } else {
      setError(result.error || 'Login failed')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* Top brand section */}
      <div className="bg-primary px-6 pt-16 pb-10">
        <h1 className="t-brand text-white">Uptimyzas Kitchen</h1>
        <p className="t-small text-white/60 mt-2 tracking-widest uppercase">
          Restaurant Management System
        </p>
      </div>

      {/* Form section */}
      <div className="flex-1 px-6 pt-8 pb-10">
        <h2 className="t-h1 text-text-primary mb-1">Welcome back</h2>
        <p className="t-body text-text-secondary mb-8">Sign in to your account to continue</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block t-label text-text-primary mb-2">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-base"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="block t-label text-text-primary mb-2">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-base pr-12"
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted min-h-0 min-w-0 w-8 h-8 flex items-center justify-center"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-[10px] p-3">
              <p className="text-danger t-small">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full mt-2"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="t-body text-text-secondary text-center mt-8">
          Don't have an account?{' '}
          <Link href="/auth/signup" className="text-primary font-semibold">
            Create account
          </Link>
        </p>
      </div>

    </div>
  )
}