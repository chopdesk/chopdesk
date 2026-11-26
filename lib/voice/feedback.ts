// lib/voice/feedback.ts
// Remembers, on this phone, which items in the cart came from voice and which words were heard for them.
// When the order is PAID, those marks become learning evidence. If the order is cleared, they are thrown away.
// Text only, never audio.

import { supabase } from '@/lib/supabase'

export type VoiceMark = {
  itemId: string
  phrase: string
  /** confirmed = the app picked the item and staff left it; corrected = staff chose the item themselves */
  kind: 'confirmed' | 'corrected'
  /** groups marks that came from the same spoken sentence */
  batch: number
  /** id of the saved sentence (arrives a moment after it is spoken) */
  uid: string | null
}

const KEY = 'voice_marks'

export function readVoiceMarks(): VoiceMark[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as VoiceMark[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list: VoiceMark[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-60)))
  } catch {
    // storage full or blocked: learning is optional, ordering still works
  }
}

export function addVoiceMarks(marks: VoiceMark[]) {
  if (marks.length > 0) write([...readVoiceMarks(), ...marks])
}

export function tagVoiceMarks(batch: number, uid: string) {
  write(readVoiceMarks().map(m => (m.batch === batch ? { ...m, uid } : m)))
}

export function clearVoiceMarks() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

/** Call after an order is saved. Never throws and never slows the sale. */
export async function flushVoiceFeedback(paid: { itemId: string; qty: number }[]) {
  try {
    const marks = readVoiceMarks()
    clearVoiceMarks()
    if (marks.length === 0) return
    const paidIds = new Set(paid.map(p => p.itemId))

    const seen = new Set<string>()
    const jobs: PromiseLike<unknown>[] = []
    for (const m of marks) {
      if (!paidIds.has(m.itemId)) continue // staff removed it: no evidence either way
      const id = `${m.itemId}|${m.phrase}|${m.kind}`
      if (seen.has(id)) continue
      seen.add(id)
      jobs.push(supabase.rpc('record_voice_feedback', { p_item_id: m.itemId, p_phrase: m.phrase, p_kind: m.kind }))
    }

    const final = paid.map(p => ({ item_id: p.itemId, qty: p.qty }))
    const uids = new Set(marks.map(m => m.uid).filter((u): u is string => typeof u === 'string'))
    uids.forEach(uid => jobs.push(supabase.rpc('finish_voice_utterance', { p_id: uid, p_final: final })))

    await Promise.allSettled(jobs)
  } catch {
    // learning is a bonus: never let it get in the way of a sale
  }
}
