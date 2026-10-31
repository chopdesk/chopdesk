'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import {
  signUp,
  createBusiness,
  acceptInvite,
  getInviteInfo,
  loadAuthState,
} from '@/lib/auth'

type Mode = 'loading' | 'owner' | 'join' | 'business' | 'bad_invite'

export default function SignupPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('loading')
  const [invite, setInvite] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [firstName, setFirstName] = useState('')
  const [surname, setSurname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [businessName, setBusinessName] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('invite')
    const step = params.get('step')

    async function init() {
      if (token) {
        setInvite(token)
        const name = await getInviteInfo(token)
        if (name) {
          setOrgName(name)
          setMode('join')
        } else {
          setMode('bad_invite')
        }
        return
      }

      if (step === 'business') {
        try {
          const state = await loadAuthState()
          if (state.status === 'signed_out') {
            router.replace('/auth/login')
            return
          }
          if (state.status === 'ready') {
            router.replace('/dashboard')
            return
          }
        } catch {
          // fall through and show the business form
        }
        setMode('business')
        return
      }

      setMode('owner')
    }

    init()
  }, [router])

  const needsAccount = mode === 'owner' || mode === 'join'
  const needsBusiness = mode === 'owner' || mode === 'business'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (needsAccount) {
      if (password !== confirmPassword) {
        setError('Passwords do not match')
        return
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters')
        return
      }
    }
    if (needsBusiness && businessName.trim().length < 2) {
      setError('Please enter your business name')
      return
    }

    setLoading(true)

    if (needsAccount) {
      const account = await signUp({ email, password, firstName, surname })
      if (!account.success) {
        setError(account.error || 'Could not create your account')
        setLoading(false)
        return
      }
    }

    if (mode === 'join' && invite) {
      const joined = await acceptInvite(invite)
      if (!joined.success) {
        setError(joined.error || 'Could not use this invite link')
        setLoading(false)
        return
      }
    } else {
      const made = await createBusiness(businessName.trim())
      if (!made.success) {
        setError(made.error || 'Could not create your business')
        setLoading(false)
        return
      }
    }

    router.push('/dashboard')
  }

  const heading =
    mode === 'join'
      ? 'Join ' + orgName
      : mode === 'business'
        ? 'Name your business'
        : 'Create your business account'

  const subheading =
    mode === 'join'
      ? 'Create your account to join your team'
      : mode === 'business'
        ? 'One last step to get started'
        : 'Set up your restaurant on Chopdesk'

  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* Top brand section */}
      <div className="bg-primary px-6 pt-16 pb-10">
        <h1 className="t-brand text-white">Chopdesk</h1>
        <p className="t-small text-white/60 mt-2 tracking-widest uppercase">
          Restaurant Management
        </p>
      </div>

      <div className="flex-1 px-6 pt-8 pb-10 overflow-y-auto">

        {mode === 'loading' && (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-[3px] border-border border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {mode === 'bad_invite' && (
          <div className="text-center py-8">
            <h2 className="t-h1 text-text-primary mb-3">Invite link not valid</h2>
            <p className="t-body text-text-secondary mb-8">
              This invite link is invalid or has expired. Ask the owner of the business to send you a new one.
            </p>
            <Link href="/auth/login" className="btn-primary inline-block">
              Go to sign in
            </Link>
          </div>
        )}

        {(mode === 'owner' || mode === 'join' || mode === 'business') && (
          <>
            <h2 className="t-h1 text-text-primary mb-1">{heading}</h2>
            <p className="t-body text-text-secondary mb-8">{subheading}</p>

            {error && (
              <div className="bg-danger/10 border border-danger/30 rounded-[10px] p-3 mb-6">
                <p className="text-danger t-small">{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {needsBusiness && (
                <div>
                  <label className="block t-label text-text-primary mb-2">Business name *</label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    className="input-base"
                    placeholder="e.g. Mama Put Kitchen"
                    required
                  />
                </div>
              )}

              {needsAccount && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block t-label text-text-primary mb-2">First name *</label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="input-base"
                        placeholder="John"
                        required
                      />
                    </div>
                    <div>
                      <label className="block t-label text-text-primary mb-2">Surname *</label>
                      <input
                        type="text"
                        value={surname}
                        onChange={(e) => setSurname(e.target.value)}
                        className="input-base"
                        placeholder="Doe"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block t-label text-text-primary mb-2">Email address *</label>
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
                    <label className="block t-label text-text-primary mb-2">Password *</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="input-base pr-12"
                        placeholder="Min. 6 characters"
                        autoComplete="new-password"
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

                  <div>
                    <label className="block t-label text-text-primary mb-2">Confirm password *</label>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="input-base"
                      placeholder="Re-enter your password"
                      autoComplete="new-password"
                      required
                    />
                  </div>
                </>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
                {loading
                  ? 'Please wait...'
                  : mode === 'join'
                    ? 'Join team'
                    : mode === 'business'
                      ? 'Create business'
                      : 'Create account'}
              </button>
            </form>

            {mode !== 'business' && (
              <p className="t-body text-text-secondary text-center mt-8">
                Already have an account?{' '}
                <Link
                  href={invite ? '/auth/login?invite=' + invite : '/auth/login'}
                  className="text-primary font-semibold"
                >
                  Sign in
                </Link>
              </p>
            )}
          </>
        )}
      </div>

    </div>
  )
}