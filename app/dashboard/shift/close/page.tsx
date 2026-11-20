'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getActiveShift, type ActiveShift } from '@/lib/shift'
import { useToast } from '@/lib/toast'
import { wasInvolved } from '@/lib/shiftReport'
import Spinner from '@/components/Spinner'
import { ClipboardCheck, CheckCircle2 } from 'lucide-react'

// Note: this page deliberately never loads the expected remaining quantity.
// Staff count blind, and the database works out the variance itself.
type CountRow = {
  id: string
  item_id: string
  item_name: string
  unit: string
  opening_qty: number
  added_qty: number
}

const isValidCount = (v: string | undefined) => v !== undefined && /^\d+$/.test(v.trim())
const inputId = (itemId: string) => `count-${itemId}`

export default function ShiftClosePage() {
  const router = useRouter()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null)
  const [rows, setRows] = useState<CountRow[]>([])
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [showErrors, setShowErrors] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const init = async () => {
    const userSession = getSession()
    if (!userSession) {
      router.replace('/auth/login')
      return
    }

    try {
      const shift = await getActiveShift()
      if (!shift) {
        setLoading(false)
        return
      }
      setActiveShift(shift)

      // quantity (the expected remaining) is intentionally not selected
      const { data: stock, error: stockError } = await supabase
        .from('shift_stock')
        .select('id, item_id, item_name, unit, opening_qty, added_qty')
        .eq('shift_id', shift.id)
        .order('item_name')
      if (stockError) throw new Error(stockError.message)

      // Only items logged at opening or added later are part of this shift
      setRows((stock || []).filter(wasInvolved))
      setLoading(false)
    } catch (err) {
      console.error(err)
      toast("Couldn't load this shift. Check your connection and try again.", 'error', { label: 'Retry', onClick: init })
      setLoading(false)
    }
  }

  useEffect(() => {
    init()
  }, [])

  const missing = rows.filter(r => !isValidCount(counts[r.item_id]))
  const counted = rows.length - missing.length
  const progress = rows.length === 0 ? 100 : Math.round((counted / rows.length) * 100)

  const focusItem = (itemId: string) => {
    const el = document.getElementById(inputId(itemId)) as HTMLInputElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus({ preventScroll: true })
  }

  const handleEnter = (index: number) => {
    // jump to the next item that still has no number, otherwise the next row
    const after = rows.slice(index + 1)
    const next = after.find(r => !isValidCount(counts[r.item_id])) || after[0]
    if (next) focusItem(next.item_id)
    else (document.activeElement as HTMLElement | null)?.blur()
  }

  const handleCloseShift = async () => {
    if (!activeShift || submitting) return

    if (missing.length > 0) {
      setShowErrors(true)
      toast(
        missing.length === 1
          ? '1 item still needs a count. Type 0 if none is left.'
          : `${missing.length} items still need a count. Type 0 if none is left.`,
        'warning'
      )
      focusItem(missing[0].item_id)
      return
    }

    if (!window.confirm('Close the shift? This cannot be undone.')) return

    setSubmitting(true)
    try {
      const p_counts = rows.map(r => ({
        item_id: r.item_id,
        counted: parseInt(counts[r.item_id].trim(), 10),
      }))

      const { error } = await supabase.rpc('close_shift', {
        p_shift_id: activeShift.id,
        p_counts,
      })

      if (error) {
        // P0001 = a message our own database function wrote for the user
        if (error.code === 'P0001') {
          if (error.message.includes('already closed')) {
            toast('This shift was already closed.', 'warning')
            router.replace(`/dashboard/shifts/view?id=${activeShift.id}`)
            return
          }
          toast(error.message, 'error')
          setSubmitting(false)
          return
        }
        throw new Error(error.message)
      }

      router.replace(`/dashboard/shifts/view?id=${activeShift.id}`)
    } catch (err) {
      console.error(err)
      toast("Couldn't close the shift. Check your connection and tap Close Shift again.", 'error')
      setSubmitting(false)
    }
  }

  if (loading) {
    return <Spinner fullScreen />
  }

  if (!activeShift) {
    return (
      <div className="min-h-full bg-bg-subtle flex items-center justify-center p-4">
        <div className="bg-white rounded-lg p-6 text-center max-w-sm">
          <h2 className="text-lg font-semibold mb-2">No shift is open</h2>
          <p className="text-gray-500 mb-4">There&apos;s nothing to close right now.</p>
          <button
            onClick={() => router.push('/dashboard/shift')}
            className="bg-primary text-white px-6 py-2 rounded-lg w-full"
          >
            Go to Shift
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-bg-subtle pb-32">
      <div className="bg-white border-b sticky top-0 z-10 px-4 py-4">
        <div className="flex items-center gap-2 mb-1">
          <ClipboardCheck size={20} className="text-primary" />
          <span className="font-semibold">Close Shift — Stock Count</span>
        </div>
        <p className="text-sm text-gray-500 mb-3">
          Count what&apos;s physically left of each item. Type 0 if none is left.
        </p>
        {rows.length > 0 && (
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{counted} of {rows.length} counted</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        {rows.length === 0 && (
          <div className="bg-white rounded-xl p-4 text-sm text-gray-500 border border-gray-200">
            No stock was logged on this shift, so there is nothing to count.
          </div>
        )}

        {rows.map((row, index) => {
          const done = isValidCount(counts[row.item_id])
          const bad = showErrors && !done
          return (
            <div
              key={row.id}
              className={`bg-white rounded-xl p-4 flex items-center justify-between shadow-sm border ${
                bad ? 'border-red-400 bg-red-50' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-3">
                <CheckCircle2
                  size={20}
                  className={done ? 'text-green-600' : 'text-gray-200'}
                />
                <div>
                  <p className="font-medium text-sm">{row.item_name}</p>
                  <p className={`text-xs ${bad ? 'text-red-600' : 'text-gray-400'}`}>
                    {bad ? 'Enter a number (0 if none left)' : `${row.unit} · left`}
                  </p>
                </div>
              </div>
              <input
                id={inputId(row.item_id)}
                type="number"
                inputMode="numeric"
                enterKeyHint="next"
                min="0"
                step="1"
                value={counts[row.item_id] ?? ''}
                onChange={(e) =>
                  setCounts(prev => ({ ...prev, [row.item_id]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleEnter(index)
                  }
                }}
                placeholder="—"
                className={`w-20 text-center border rounded-lg py-2 text-sm ${
                  bad ? 'border-red-400' : 'border-gray-200'
                }`}
              />
            </div>
          )
        })}
      </div>

      <div className="fixed bottom-[var(--bottom-nav-h)] left-0 right-0 md:bottom-0 md:left-16 lg:left-56 p-4 bg-gradient-to-t from-bg-subtle via-bg-subtle to-transparent pt-8 z-20">
        <button
          onClick={handleCloseShift}
          disabled={submitting}
          className="w-full bg-primary text-white py-4 rounded-xl font-medium shadow-lg disabled:opacity-60"
        >
          {submitting ? 'Closing Shift...' : 'Close Shift'}
        </button>
      </div>
    </div>
  )
}
