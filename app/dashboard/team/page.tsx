'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession, createInvite, type UserSession } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import Spinner from '@/components/Spinner'
import { Copy, Share2, Trash2, UserPlus } from 'lucide-react'

type Member = { id: string; user_id: string; role: 'owner' | 'staff'; name: string }
type PendingInvite = { id: string; token: string; expires_at: string }

export default function TeamPage() {
  const router = useRouter()
  const toast = useToast()
  const [session, setSession] = useState<UserSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [creating, setCreating] = useState(false)
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null)

  const isOwner = session?.role === 'owner'

  useEffect(() => {
    const s = getSession()
    if (!s) {
      router.replace('/auth/login')
      return
    }
    setSession(s)
    load(s)
      .catch((err) => {
        console.error(err)
        toast('Could not load the team: ' + (err instanceof Error ? err.message : 'unknown error'), 'error')
      })
      .finally(() => setLoading(false))
  }, [router])

  const load = async (s: UserSession) => {
    const { data: rows, error } = await supabase
      .from('memberships')
      .select('id, user_id, role')
      .eq('org_id', s.org_id)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)

    const ids = (rows || []).map((r) => r.user_id)
    const { data: profs, error: profError } = await supabase
      .from('profiles')
      .select('id, first_name, surname')
      .in('id', ids)
    if (profError) throw new Error(profError.message)

    setMembers(
      (rows || []).map((r) => {
        const p = profs?.find((p) => p.id === r.user_id)
        const full = p ? (p.first_name + ' ' + p.surname).trim() : ''
        return { id: r.id, user_id: r.user_id, role: r.role, name: full || 'Unnamed' }
      })
    )

    if (s.role === 'owner') await loadInvites(s.org_id)
  }

  const loadInvites = async (orgId: string) => {
    const { data, error } = await supabase
      .from('invites')
      .select('id, token, expires_at')
      .eq('org_id', orgId)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    setInvites(data || [])
  }

  const linkFor = (token: string) => window.location.origin + '/auth/signup?invite=' + token

  const handleCreateInvite = async () => {
    if (!session) return
    setCreating(true)
    const result = await createInvite(session.org_id)
    if (result.error || !result.token) {
      toast('Could not create the invite: ' + (result.error || 'unknown error'), 'error')
    } else {
      toast('Invite link created', 'success')
      try {
        await loadInvites(session.org_id)
      } catch (err) {
        console.error(err)
      }
    }
    setCreating(false)
  }

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(linkFor(token))
      toast('Link copied', 'success')
    } catch {
      toast('Could not copy. Press and hold the link to copy it.', 'warning')
    }
  }

  const shareOnWhatsApp = (token: string) => {
    const text = 'Join ' + (session?.org_name || 'our team') + ' on Chopdesk: ' + linkFor(token)
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank')
  }

  const revokeInvite = async (id: string) => {
    if (!session) return
    const { error } = await supabase.from('invites').delete().eq('id', id)
    if (error) {
      toast('Could not revoke the invite: ' + error.message, 'error')
      return
    }
    toast('Invite revoked', 'info')
    try {
      await loadInvites(session.org_id)
    } catch (err) {
      console.error(err)
    }
  }

  const removeMember = async (membershipId: string) => {
    if (!session) return
    const { error } = await supabase
      .from('memberships')
      .update({ status: 'removed' })
      .eq('id', membershipId)
    setRemoveConfirm(null)
    if (error) {
      toast('Could not remove this person: ' + error.message, 'error')
      return
    }
    toast('Removed from the team', 'info')
    try {
      await load(session)
    } catch (err) {
      console.error(err)
    }
  }

  if (loading) {
    return <Spinner fullScreen />
  }

  return (
    <div className="p-4 sm:p-6 pb-28 sm:pb-28 space-y-6 max-w-2xl">
      <div>
        <h1 className="t-h1 text-text-primary">Team</h1>
        <p className="t-body text-text-secondary">{session?.org_name}</p>
      </div>

      <section>
        <p className="t-label text-text-secondary mb-3">Members ({members.length})</p>
        <div className="space-y-3">
          {members.map((m) => (
            <div key={m.id} className="card flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="t-body text-text-primary font-medium truncate">
                  {m.name}
                  {m.user_id === session?.id ? ' (you)' : ''}
                </p>
                <span
                  className={
                    'inline-block mt-1 px-2 py-0.5 rounded-full t-small ' +
                    (m.role === 'owner'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-gray-100 text-text-secondary')
                  }
                >
                  {m.role === 'owner' ? 'Owner' : 'Staff'}
                </span>
              </div>

              {isOwner && m.role === 'staff' && (
                removeConfirm === m.id ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => removeMember(m.id)}
                      className="text-danger t-small font-semibold min-h-0 px-3 py-2"
                    >
                      Confirm remove
                    </button>
                    <button
                      onClick={() => setRemoveConfirm(null)}
                      className="text-text-muted t-small min-h-0 px-3 py-2"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRemoveConfirm(m.id)}
                    className="text-text-muted t-small min-h-0 px-3 py-2 flex-shrink-0"
                  >
                    Remove
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      </section>

      {isOwner ? (
        <section>
          <p className="t-label text-text-secondary mb-3">Invite staff</p>
          <button
            onClick={handleCreateInvite}
            disabled={creating}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <UserPlus size={18} />
            {creating ? 'Creating link...' : 'Create invite link'}
          </button>
          <p className="t-small text-text-muted mt-2">
            Each link works once and expires after 7 days. Share it with the person you want to add.
          </p>

          {invites.length > 0 && (
            <div className="space-y-3 mt-4">
              {invites.map((inv) => (
                <div key={inv.id} className="card">
                  <p className="t-small text-text-secondary break-all">{linkFor(inv.token)}</p>
                  <p className="t-small text-text-muted mt-1">
                    Expires{' '}
                    {new Date(inv.expires_at).toLocaleDateString('en-NG', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      onClick={() => copyLink(inv.token)}
                      className="flex items-center gap-2 px-3 py-2 rounded-[10px] border border-border t-small min-h-0"
                    >
                      <Copy size={16} /> Copy
                    </button>
                    <button
                      onClick={() => shareOnWhatsApp(inv.token)}
                      className="flex items-center gap-2 px-3 py-2 rounded-[10px] border border-border t-small min-h-0"
                    >
                      <Share2 size={16} /> WhatsApp
                    </button>
                    <button
                      onClick={() => revokeInvite(inv.id)}
                      className="ml-auto flex items-center gap-2 px-3 py-2 text-danger t-small min-h-0"
                    >
                      <Trash2 size={16} /> Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        <p className="t-small text-text-muted">Only the owner can invite or remove people.</p>
      )}
    </div>
  )
}