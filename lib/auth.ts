// lib/auth.ts
import { supabase } from './supabase'
import bcrypt from 'bcryptjs'

export type UserSession = {
  id: string
  email: string
  first_name: string
  surname: string
  status: string
}

export async function signIn(email: string, password: string): Promise<{ success: boolean; error?: string; session?: UserSession }> {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, password_hash, first_name, surname, status')
      .eq('email', email.toLowerCase())
      .limit(1)

    if (error) throw error

    if (!users || users.length === 0) {
      return { success: false, error: 'Invalid email or password' }
    }

    const user = users[0]

    if (user.status === 'pending') {
      return { success: false, error: 'Your account is pending approval' }
    }
    if (user.status === 'declined') {
      return { success: false, error: 'Your account was declined' }
    }
    if (user.status !== 'active') {
      return { success: false, error: 'Account not active' }
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash)

    if (!isValidPassword) {
      return { success: false, error: 'Invalid email or password' }
    }

    const session: UserSession = {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      surname: user.surname,
      status: user.status,
    }

    if (typeof window !== 'undefined') {
      localStorage.setItem('uk_session', JSON.stringify(session))
    }

    return { success: true, session }
  } catch {
    return { success: false, error: 'Something went wrong' }
  }
}

export function getSession(): UserSession | null {
  if (typeof window === 'undefined') return null
  const sessionStr = localStorage.getItem('uk_session')
  if (!sessionStr) return null
  try {
    return JSON.parse(sessionStr)
  } catch {
    return null
  }
}

export function clearSession(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('uk_session')
  }
}

export function isAuthenticated(): boolean {
  return getSession() !== null
}