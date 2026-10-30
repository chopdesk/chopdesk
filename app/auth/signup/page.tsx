'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import bcrypt from 'bcryptjs'
import { Eye, EyeOff, ChevronLeft } from 'lucide-react'

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [formData, setFormData] = useState({
    firstName: '',
    surname: '',
    email: '',
    phone: '',
    additionalPhone: '',
    isStudent: false,
    password: '',
    confirmPassword: '',
    state: '',
    city: '',
    address: '',
  })

  const updateField = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    setError('')
    setStep(2)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { count, error: countError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })

      if (countError) {
        setError('Database error: ' + countError.message)
        setLoading(false)
        return
      }

      const isFirstUser = count === 0
      const userRole = isFirstUser ? 'admin' : 'staff'
      const userStatus = isFirstUser ? 'active' : 'pending'

      const passwordHash = await bcrypt.hash(formData.password, 10)

      const { data, error: insertError } = await supabase
        .from('users')
        .insert({
          email: formData.email.toLowerCase(),
          password_hash: passwordHash,
          first_name: formData.firstName,
          surname: formData.surname,
          phone: formData.phone,
          additional_phone: formData.additionalPhone || null,
          is_student: formData.isStudent,
          state: formData.state || null,
          city: formData.city || null,
          address: formData.address || null,
          role: userRole,
          status: userStatus,
          approved_at: isFirstUser ? new Date().toISOString() : null,
        })
        .select()

      if (insertError) {
        if (insertError.code === '23505') {
          setError('An account with this email already exists')
        } else {
          setError('Failed to create account: ' + insertError.message)
        }
        setLoading(false)
        return
      }

      if (isFirstUser && data && data[0]) {
        const session = {
          id: data[0].id,
          email: data[0].email,
          first_name: data[0].first_name,
          surname: data[0].surname,
          role: 'admin',
          status: 'active',
        }
        localStorage.setItem('uk_session', JSON.stringify(session))
        router.push('/admin')
      } else {
        router.push('/auth/pending')
      }
    } catch {
      setError('Something went wrong. Please try again.')
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

      {/* Step indicator */}
      <div className="bg-white border-b border-border px-6 py-3 flex items-center gap-4">
        {step === 2 && (
          <button
            onClick={() => setStep(1)}
            className="text-text-secondary min-h-0 min-w-0 w-8 h-8 flex items-center justify-center"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <div className="flex items-center gap-2 flex-1">
          <div className={`h-1.5 flex-1 rounded-full transition-colors ${
            step >= 1 ? 'bg-primary' : 'bg-border'
          }`} />
          <div className={`h-1.5 flex-1 rounded-full transition-colors ${
            step >= 2 ? 'bg-primary' : 'bg-border'
          }`} />
        </div>
        <p className="t-small text-text-muted">Step {step} of 2</p>
      </div>

      {/* Form section */}
      <div className="flex-1 px-6 pt-8 pb-10 overflow-y-auto">

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-[10px] p-3 mb-6">
            <p className="text-danger t-small">{error}</p>
          </div>
        )}

        {step === 1 && (
          <>
            <h2 className="t-h1 text-text-primary mb-1">Create account</h2>
            <p className="t-body text-text-secondary mb-8">Tell us about yourself</p>

            <form onSubmit={handleStep1Submit} className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block t-label text-text-primary mb-2">First Name *</label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => updateField('firstName', e.target.value)}
                    className="input-base"
                    placeholder="John"
                    required
                  />
                </div>
                <div>
                  <label className="block t-label text-text-primary mb-2">Surname *</label>
                  <input
                    type="text"
                    value={formData.surname}
                    onChange={(e) => updateField('surname', e.target.value)}
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
                  value={formData.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  className="input-base"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <label className="block t-label text-text-primary mb-2">Phone number *</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  className="input-base"
                  placeholder="08012345678"
                  required
                />
              </div>

              <div>
                <label className="block t-label text-text-primary mb-2">
                  Additional Phone <span className="text-text-muted font-normal">(optional)</span>
                </label>
                <input
                  type="tel"
                  value={formData.additionalPhone}
                  onChange={(e) => updateField('additionalPhone', e.target.value)}
                  className="input-base"
                  placeholder="08087654321"
                />
              </div>

              <div className="flex items-center gap-3 py-1">
                <button
                  type="button"
                  onClick={() => updateField('isStudent', !formData.isStudent)}
                  className={`w-12 h-6 rounded-full transition-colors min-h-0 min-w-0 relative ${
                    formData.isStudent ? 'bg-primary' : 'bg-border'
                  }`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    formData.isStudent ? 'translate-x-6' : 'translate-x-0.5'
                  }`} />
                </button>
                <label className="t-body text-text-primary">I am a student</label>
              </div>

              <div>
                <label className="block t-label text-text-primary mb-2">Password *</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => updateField('password', e.target.value)}
                    className="input-base pr-12"
                    placeholder="Min. 6 characters"
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
                <label className="block t-label text-text-primary mb-2">Confirm Password *</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={formData.confirmPassword}
                    onChange={(e) => updateField('confirmPassword', e.target.value)}
                    className="input-base pr-12"
                    placeholder="Repeat your password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted min-h-0 min-w-0 w-8 h-8 flex items-center justify-center"
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <button type="submit" className="btn-primary w-full">
                Continue
              </button>
            </form>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="t-h1 text-text-primary mb-1">Your location</h2>
            <p className="t-body text-text-secondary mb-8">
              Optional — helps us know where you're based
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block t-label text-text-primary mb-2">State</label>
                <input
                  type="text"
                  value={formData.state}
                  onChange={(e) => updateField('state', e.target.value)}
                  className="input-base"
                  placeholder="e.g., Lagos, Oyo, Abuja"
                />
              </div>

              <div>
                <label className="block t-label text-text-primary mb-2">City</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => updateField('city', e.target.value)}
                  className="input-base"
                  placeholder="e.g., Ibadan"
                />
              </div>

              <div>
                <label className="block t-label text-text-primary mb-2">Address</label>
                <textarea
                  value={formData.address}
                  onChange={(e) => updateField('address', e.target.value)}
                  className="input-base pt-3"
                  style={{ minHeight: '90px', resize: 'none' }}
                  placeholder="Street address"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full"
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>
          </>
        )}

        <p className="t-body text-text-secondary text-center mt-8">
          Already have an account?{' '}
          <button
            onClick={() => router.push('/auth/login')}
            className="text-primary font-semibold"
          >
            Sign in
          </button>
        </p>
      </div>

    </div>
  )
}