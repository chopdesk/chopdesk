'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/lib/toast'
import { Copy, KeyRound, RefreshCw, X } from 'lucide-react'

type Props = {
  orgId: string
  userId: string
  name: string
  onClose: () => void
}

// No look-alike characters (0/O, 1/l/I), so a password read out loud or typed from WhatsApp is not misread
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generatePassword(length = 8): string {
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export default function ResetPasswordSheet({ orgId, userId, name, onClose }: Props) {
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [doneWith, setDoneWith] = useState<string | null>(null)

  const tooShort = password.length < 8

  async function handleReset() {
    if (tooShort || saving) return
    setSaving(true)
    const { error } = await supabase.rpc('owner_reset_staff_password', {
      p_org: orgId,
      p_user: userId,
      p_new_password: password,
    })
    setSaving(false)

    if (error) {
      console.error(error)
      toast(error.message || "Couldn't reset the password. Try again.", 'error')
      return
    }
    setDoneWith(password)
    toast('Password changed. Give the new password to ' + name + '.', 'success')
  }

  async function copyPassword() {
    if (!doneWith) return
    try {
      await navigator.clipboard.writeText(doneWith)
      toast('Password copied', 'success')
    } catch {
      toast("Couldn't copy. Write it down before you close this.", 'warning')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
      <div className="w-full max-w-md rounded-t-[20px] bg-white p-5 md:rounded-[20px]">
        <div className="mb-4 flex items-center justify-between">
          <p className="t-h2 text-text-primary">Reset password</p>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 min-h-0 min-w-0 items-center justify-center text-text-muted">
            <X size={18} />
          </button>
        </div>

        {doneWith ? (
          <div className="space-y-4">
            <p className="t-body text-text-secondary">
              {name} can now log in with this password. Share it privately, for example on WhatsApp. They are signed out
              everywhere until they log in again.
            </p>
            <div className="rounded-[10px] bg-bg-subtle p-3 text-center">
              <p className="t-mono text-text-primary text-lg select-all">{doneWith}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={copyPassword} className="btn-secondary flex flex-1 items-center justify-center gap-2">
                <Copy size={16} /> Copy
              </button>
              <button onClick={onClose} className="btn-primary flex-1">Done</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="t-body text-text-secondary">Set a new password for {name}.</p>
            <div>
              <label className="mb-1 block t-label text-text-primary" htmlFor="new-password">New password</label>
              <div className="flex gap-2">
                <input
                  id="new-password"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  className="input-base"
                  placeholder="At least 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setPassword(generatePassword())}
                  className="btn-secondary flex items-center gap-2 whitespace-nowrap"
                >
                  <RefreshCw size={16} /> Generate
                </button>
              </div>
              {password.length > 0 && tooShort && (
                <p className="mt-1 t-small text-danger">Use at least 8 characters.</p>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
              <button
                onClick={handleReset}
                disabled={tooShort || saving}
                className="btn-primary flex flex-1 items-center justify-center gap-2"
              >
                <KeyRound size={16} /> {saving ? 'Saving...' : 'Reset password'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
