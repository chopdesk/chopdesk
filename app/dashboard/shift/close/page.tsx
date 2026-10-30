'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getActiveShift, type ActiveShift } from '@/lib/shift'
import { useToast } from '@/lib/toast'
import Spinner from '@/components/Spinner'
import { ClipboardCheck, Copy, CheckCircle2 } from 'lucide-react'

type ShiftStockRow = {
  id: string
  item_id: string
  item_name: string
  unit: string
  opening_qty: number
  added_qty: number
  quantity: number
}

type ExpenseRow = {
  description: string
  amount: number
}

type Discrepancy = {
  item_name: string
  expected: number
  counted: number
  variance: number
}

export default function ShiftClosePage() {
  const router = useRouter()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null)

  const [stockRows, setStockRows] = useState<ShiftStockRow[]>([])
  const [priceMap, setPriceMap] = useState<Record<string, number>>({})
  const [staffNames, setStaffNames] = useState<string[]>([])
  const [revenueCash, setRevenueCash] = useState(0)
  const [revenueTransfer, setRevenueTransfer] = useState(0)
  const [revenueTotal, setRevenueTotal] = useState(0)
  const [orderCount, setOrderCount] = useState(0)
  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([])
  const [expenseTotal, setExpenseTotal] = useState(0)

  const [counts, setCounts] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)

  useEffect(() => {
    init()
  }, [])

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

      // Stock logged for this shift
      const { data: stock, error: stockError } = await supabase
        .from('shift_stock')
        .select('*')
        .eq('shift_id', shift.id)
        .order('item_name')
      if (stockError) throw new Error(stockError.message)
      setStockRows(stock || [])

      // Prices, for the ₦-per-item breakdown
      const { data: menu, error: menuError } = await supabase
        .from('menu_items')
        .select('id, price')
      if (menuError) throw new Error(menuError.message)
      const prices: Record<string, number> = {}
      menu?.forEach(m => { prices[m.id] = Number(m.price) })
      setPriceMap(prices)

      // Staff list — who joined this shift
      const { data: assignments, error: assignError } = await supabase
        .from('shift_assignments')
        .select('user_id, joined_at')
        .eq('shift_id', shift.id)
        .order('joined_at')
      if (assignError) throw new Error(assignError.message)

      const userIds = Array.from(new Set((assignments || []).map(a => a.user_id)))
      let names: string[] = []
      if (userIds.length > 0) {
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, first_name, surname')
          .in('id', userIds)
        if (usersError) throw new Error(usersError.message)

        names = (assignments || []).map(a => {
          const u = users?.find(u => u.id === a.user_id)
          return u ? `${u.first_name} ${u.surname}`.trim() : 'Unknown'
        })
        names = Array.from(new Set(names))
      }
      setStaffNames(names)

      // Revenue — orders placed during this shift
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('cash_amount, transfer_amount, total')
        .eq('shift_id', shift.id)
      if (ordersError) throw new Error(ordersError.message)

      setRevenueCash((orders || []).reduce((s, o) => s + Number(o.cash_amount || 0), 0))
      setRevenueTransfer((orders || []).reduce((s, o) => s + Number(o.transfer_amount || 0), 0))
      setRevenueTotal((orders || []).reduce((s, o) => s + Number(o.total || 0), 0))
      setOrderCount((orders || []).length)

      // Expenses — paid from cash during this shift
      const { data: expenses, error: expensesError } = await supabase
        .from('expenses')
        .select('description, amount')
        .eq('shift_id', shift.id)
      if (expensesError) throw new Error(expensesError.message)

      const expRows: ExpenseRow[] = (expenses || []).map(e => ({
        description: e.description,
        amount: Number(e.amount),
      }))
      setExpenseRows(expRows)
      setExpenseTotal(expRows.reduce((s, e) => s + e.amount, 0))

      setLoading(false)

    } catch (err: any) {
      console.error(err)
      toast('Could not load shift data: ' + err.message, 'error')
      setLoading(false)
    }
  }

  const buildSummary = (closedAt: string, discrepancies: Discrepancy[]) => {
    if (!activeShift) return ''

    const openedDate = new Date(activeShift.opened_at)
    const closedDate = new Date(closedAt)

    const dateStr = openedDate.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    const openTimeStr = openedDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const closeTimeStr = closedDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

    const durationMs = closedDate.getTime() - openedDate.getTime()
    const durationH = Math.floor(durationMs / 3600000)
    const durationM = Math.floor((durationMs % 3600000) / 60000)

    const soldQtyLines = stockRows
      .map(r => `${r.item_name}: ${r.opening_qty + r.added_qty - r.quantity} ${r.unit}`)
      .join('\n')

    const totalItemsSold = stockRows.reduce(
      (s, r) => s + (r.opening_qty + r.added_qty - r.quantity), 0
    )

    const soldAmountLines = stockRows
      .map(r => {
        const sold = r.opening_qty + r.added_qty - r.quantity
        const price = priceMap[r.item_id] || 0
        return `${r.item_name} - ${(sold * price).toLocaleString()}`
      })
      .join('\n')

    const expenseLines = expenseRows.length > 0
      ? expenseRows.map(e => `${e.description} - ${e.amount.toLocaleString()}`).join('\n')
      : 'None'

    const cashAfterExpenses = revenueCash - expenseTotal
    const net = revenueTotal - expenseTotal

    const discrepancyLines = discrepancies.length > 0
      ? discrepancies
          .map(d => `${d.item_name}: ${d.variance > 0 ? '+' : ''}${d.variance} (expected ${d.expected}, counted ${d.counted})`)
          .join('\n')
      : 'No discrepancies'

    return `*Uptimyzas Kitchen — Shift Report*
${dateStr}
${openTimeStr} – ${closeTimeStr} (${durationH}h ${durationM}m)
Staff: ${staffNames.join(', ')}

*Sold (Qty)*
${soldQtyLines}
${totalItemsSold} items · ${orderCount} orders

*Sold (₦)*
${soldAmountLines}

*Revenue*
Cash: ${revenueCash.toLocaleString()}
Transfer: ${revenueTransfer.toLocaleString()}
Total: ${revenueTotal.toLocaleString()}

*Expenses (from cash)*
${expenseLines}
Total: ${expenseTotal.toLocaleString()}

Cash after expenses: ${cashAfterExpenses.toLocaleString()}

*Stock Discrepancies*
${discrepancyLines}

*Net:* ${net.toLocaleString()}`
  }

  const handleCloseShift = async () => {
    const userSession = getSession()
    if (!userSession || !activeShift) return

    setSubmitting(true)

    try {
      const discrepancies: Discrepancy[] = []

      const closeRows = stockRows.map(r => {
        const soldQty = r.opening_qty + r.added_qty - r.quantity
        const enteredRaw = counts[r.item_id]
        const counted = enteredRaw !== undefined && enteredRaw !== ''
          ? parseInt(enteredRaw)
          : r.quantity
        const variance = counted - r.quantity

        if (variance !== 0) {
          discrepancies.push({ item_name: r.item_name, expected: r.quantity, counted, variance })
        }

        return {
          shift_id: activeShift.id,
          item_id: r.item_id,
          opening_qty: r.opening_qty,
          sold_qty: soldQty,
          actual_remaining: counted,
          variance,
        }
      })

      if (closeRows.length > 0) {
        const { error: closeError } = await supabase
          .from('shift_close')
          .insert(closeRows)
        if (closeError) throw new Error(closeError.message)
      }

      const closedAtIso = new Date().toISOString()

      const { data: closedShift, error: updateError } = await supabase
        .from('shifts')
        .update({ closed_at: closedAtIso, closed_by: userSession.id })
        .eq('id', activeShift.id)
        .is('closed_at', null)
        .select()
        .single()

      if (updateError) throw new Error(updateError.message)
      if (!closedShift) throw new Error('This shift was already closed by someone else')

      setSummary(buildSummary(closedShift.closed_at, discrepancies))

    } catch (err: any) {
      console.error(err)
      toast('Could not close the shift: ' + err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopy = async () => {
    if (!summary) return
    try {
      await navigator.clipboard.writeText(summary)
      toast('Summary copied', 'success')
    } catch {
      toast('Could not copy — select and copy the text manually', 'warning')
    }
  }

  if (loading) {
    return <Spinner fullScreen />
  }

  if (!activeShift) {
    return (
      <div className="min-h-screen bg-bg-subtle flex items-center justify-center p-4">
        <div className="bg-white rounded-lg p-6 text-center max-w-sm">
          <h2 className="text-lg font-semibold mb-2">No shift is open</h2>
          <p className="text-gray-500 mb-4">There's nothing to close right now.</p>
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

  // Shift just closed — show the read-only summary
  if (summary) {
    return (
      <div className="min-h-screen bg-bg-subtle p-4 pb-32">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-lg mx-auto">
          <div className="p-4 border-b flex items-center gap-2">
            <CheckCircle2 size={20} className="text-green-600" />
            <span className="font-semibold">Shift Closed</span>
          </div>
          <pre className="p-4 text-sm whitespace-pre-wrap font-sans">{summary}</pre>
        </div>

        <div className="fixed bottom-[68px] left-0 right-0 p-4 bg-gradient-to-t from-bg-subtle via-bg-subtle to-transparent pt-8 z-20">
          <div className="max-w-lg mx-auto flex gap-3">
            <button
              onClick={handleCopy}
              className="flex-1 bg-white border border-gray-200 text-primary py-3 rounded-xl font-medium flex items-center justify-center gap-2"
            >
              <Copy size={18} /> Copy Summary
            </button>
            <button
              onClick={() => router.push('/dashboard/shift')}
              className="flex-1 bg-primary text-white py-3 rounded-xl font-medium"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Shift open — physical count entry
  return (
    <div className="min-h-screen bg-bg-subtle pb-32">
      <div className="bg-white border-b sticky top-0 z-10 px-4 py-4">
        <div className="flex items-center gap-2 mb-1">
          <ClipboardCheck size={20} className="text-primary" />
          <span className="font-semibold">Close Shift — Stock Count</span>
        </div>
        <p className="text-sm text-gray-500">
          Count what's physically left of each item. Leave blank if it
          matches what the app expects.
        </p>
      </div>

      <div className="p-4 space-y-3">
        {stockRows.map(row => (
          <div
            key={row.id}
            className="bg-white rounded-xl p-4 flex items-center justify-between shadow-sm border border-gray-200"
          >
            <div>
              <p className="font-medium text-sm">{row.item_name}</p>
              <p className="text-xs text-gray-400">
                {row.unit} · expected {row.quantity} remaining
              </p>
            </div>
            <input
              type="number"
              min="0"
              value={counts[row.item_id] || ''}
              onChange={(e) =>
                setCounts(prev => ({ ...prev, [row.item_id]: e.target.value }))
              }
              placeholder={String(row.quantity)}
              className="w-20 text-center border border-gray-200 rounded-lg py-2 text-sm"
            />
          </div>
        ))}
      </div>

      <div className="fixed bottom-[68px] left-0 right-0 p-4 bg-gradient-to-t from-bg-subtle via-bg-subtle to-transparent pt-8 z-20">
        <button
          onClick={handleCloseShift}
          disabled={submitting}
          className="w-full bg-primary text-white py-4 rounded-xl font-medium shadow-lg"
        >
          {submitting ? 'Closing Shift...' : 'Close Shift'}
        </button>
      </div>
    </div>
  )
}