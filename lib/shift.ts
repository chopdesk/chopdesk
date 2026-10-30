import { supabase } from '@/lib/supabase'

export type ActiveShift = {
  id: string
  opened_at: string
  opened_by: string
}

/**
 * Returns the currently open shift (closed_at is null), or null if
 * no shift is open right now.
 */
export async function getActiveShift(): Promise<ActiveShift | null> {
  const { data, error } = await supabase
    .from('shifts')
    .select('id, opened_at, opened_by')
    .is('closed_at', null)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data
}

/**
 * Makes sure the given user is recorded as part of the given shift.
 * Safe to call every time someone lands on the orders page — it only
 * inserts a row the first time a user joins a particular shift.
 */
export async function ensureJoined(shiftId: string, userId: string): Promise<void> {
  // upsert + ignoreDuplicates lets Postgres handle "insert, but do nothing
  // if it's already there" in one atomic step — safe even if this runs
  // twice at once (e.g. React Strict Mode's double-invoked effects in
  // dev), unlike a separate check-then-insert which can race.
  const { error } = await supabase
    .from('shift_assignments')
    .upsert(
      { shift_id: shiftId, user_id: userId },
      { onConflict: 'shift_id,user_id', ignoreDuplicates: true }
    )

  if (error) throw new Error(error.message)
}