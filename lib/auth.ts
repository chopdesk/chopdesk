// lib/auth.ts
import { supabase } from './supabase'

export type UserSession = {
  id: string
  email: string
  first_name: string
  surname: string
  org_id: string
  org_name: string
  location_id: string
  role: 'owner' | 'staff'
}

export type AuthState =
  | { status: 'signed_out' }
  | { status: 'no_business'; userId: string; email: string }
  | { status: 'suspended'; orgName: string }
  | { status: 'ready'; session: UserSession }

type MembershipRow = {
  role: 'owner' | 'staff'
  org_id: string
  organizations: { name: string; status: string } | null
}

type Result = { success: boolean; error?: string }

const CACHE_KEY = 'chopdesk_session'

function writeCache(session: UserSession | null): void {
  if (typeof window === 'undefined') return
  try {
    if (session) localStorage.setItem(CACHE_KEY, JSON.stringify(session))
    else localStorage.removeItem(CACHE_KEY)
  } catch {
    // storage unavailable (private mode etc.) - the app still works, just without the local copy
  }
}

/** Fast, local copy of who is logged in. Pages use this for names and ids. */
export function getSession(): UserSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as UserSession) : null
  } catch {
    return null
  }
}

export function clearSession(): void {
  writeCache(null)
}

export function isAuthenticated(): boolean {
  return getSession() !== null
}

/**
 * Checks the real Supabase login, then looks up the person's profile,
 * business and default location, and refreshes the local copy.
 * If the network is down, it falls back to the local copy for the same user.
 */
export async function loadAuthState(): Promise<AuthState> {
  const { data: authData } = await supabase.auth.getSession()
  const user = authData.session?.user

  if (!user) {
    writeCache(null)
    return { status: 'signed_out' }
  }

  const [profileRes, memberRes] = await Promise.all([
    supabase.from('profiles').select('first_name, surname').eq('id', user.id).maybeSingle(),
    supabase
      .from('memberships')
      .select('role, org_id, organizations(name, status)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  if (profileRes.error || memberRes.error) {
    const cached = getSession()
    if (cached && cached.id === user.id) return { status: 'ready', session: cached }
    throw new Error((profileRes.error || memberRes.error)?.message || 'Could not load your account')
  }

  const member = memberRes.data as unknown as MembershipRow | null

  if (!member || !member.organizations) {
    writeCache(null)
    return { status: 'no_business', userId: user.id, email: user.email ?? '' }
  }

  if (member.organizations.status !== 'active') {
    writeCache(null)
    return { status: 'suspended', orgName: member.organizations.name }
  }

  const { data: location, error: locationError } = await supabase
    .from('locations')
    .select('id')
    .eq('org_id', member.org_id)
    .eq('is_default', true)
    .maybeSingle()

  if (locationError || !location) {
    throw new Error(locationError?.message || 'This business has no location set up')
  }

  const session: UserSession = {
    id: user.id,
    email: user.email ?? '',
    first_name: profileRes.data?.first_name ?? '',
    surname: profileRes.data?.surname ?? '',
    org_id: member.org_id,
    org_name: member.organizations.name,
    location_id: location.id,
    role: member.role,
  }

  writeCache(session)
  return { status: 'ready', session }
}

export async function signIn(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string; state?: AuthState }> {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })

  if (error) {
    const invalid = error.message.toLowerCase().includes('invalid login')
    return { success: false, error: invalid ? 'Invalid email or password' : error.message }
  }

  try {
    const state = await loadAuthState()
    return { success: true, state }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Something went wrong' }
  }
}

export async function signUp(input: {
  email: string
  password: string
  firstName: string
  surname: string
}): Promise<Result> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    options: { data: { first_name: input.firstName.trim(), surname: input.surname.trim() } },
  })

  if (error) return { success: false, error: error.message }

  if (!data.session) {
    return { success: false, error: 'Account created. Check your email to confirm it, then log in.' }
  }

  return { success: true }
}

/** A new owner names their business. Creates the business, its location and their owner access. */
export async function createBusiness(name: string): Promise<Result> {
  const { error } = await supabase.rpc('create_organization', { p_name: name })
  if (error) return { success: false, error: error.message }
  await loadAuthState()
  return { success: true }
}

/** Shows the business name for a valid invite link, or null if the link is invalid or expired. */
export async function getInviteInfo(token: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_invite_info', { p_token: token })
  if (error || !data) return null
  return data as string
}

/** A signed-in person joins a business using an invite link. */
export async function acceptInvite(token: string): Promise<Result> {
  const { error } = await supabase.rpc('accept_invite', { p_token: token })
  if (error) return { success: false, error: error.message }
  await loadAuthState()
  return { success: true }
}

/** An owner creates a single-use invite token to share with new staff. */
export async function createInvite(orgId: string): Promise<{ token?: string; error?: string }> {
  const { data, error } = await supabase.rpc('create_invite', { p_org: orgId })
  if (error) return { error: error.message }
  return { token: data as string }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
  writeCache(null)
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('current_order_cart')
      localStorage.removeItem('last_order')
    } catch {
      // ignore
    }
  }
}