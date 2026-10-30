'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import Spinner from '@/components/Spinner'
import { Copy, ChevronLeft } from 'lucide-react'

type ShiftStockRow = {
  id: string
  item_id: string
  item_name: string
  unit: string
  opening_qty: number
  added_qty: number
  quantity: number
}

type ShiftCloseRow = {
  item_id: string
  opening_qty: number
  sold_qty: number
  actual_remaining: number
  variance: number
}

type ExpenseRow = {
  description: string
  amount: number
}

function ShiftDetailContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const toast = useToast()
  const shiftId = searchParams.get('id') || ''

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [notClosed, setNotClosed] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)

  useEffect(() => {
    init()
  }, [shiftId])

  const init = async () => {
    const userSession = getSession()
    if (!userSession) {
      router.replace('/auth/login')
      return
    }
    if (!shiftId) {
      setNotFound(true)
      setLoading(false)
      return
    }

    try {
      const { data: shift, error: shiftError } = await supabase
        .from('shifts')
        .select('id, opened_at, closed_at')
        .eq('id', shiftId)
        .maybeSingle()

      if (shiftError) throw new Error(shiftError.message)
      if (!shift) {
        setNotFound(true)
        setLoading(false)
        return
      }
      if (!shift.closed_at) {
        setNotClosed(true)
        setLoading(false)
        return
      }

      // Stock logged for this shift
      const { data: stock, error: stockError } = await supabase
        .from('shift_stock')
        .select('*')
        .eq('shift_id', shift.id)
        .order('item_name')
      if (stockError) throw new Error(stockError.message)
      const stockRows: ShiftStockRow[] = stock || []

      const itemNameById: Record<string, string> = {}
      stockRows.forEach(r => { itemNameById[r.item_id] = r.item_name })

      // Prices, for the ₦-per-item breakdown
      const { data: menu, error: menuError } = await supabase
        .from('menu_items')
        .select('id, price')
      if (menuError) throw new Error(menuError.message)
      const priceMap: Record<string, number> = {}
      menu?.forEach(m => { priceMap[m.id] = Number(m.price) })

      // Recorded discrepancies from close time
      const { data: closeRows, error: closeError } = await supabase
        .from('shift_close')
        .select('item_id, opening_qty, sold_qty, actual_remaining, variance')
        .eq('shift_id', shift.id)
      if (closeError) throw new Error(closeError.message)
      const discrepancies = (closeRows || [])
        .filter((r: ShiftCloseRow) => r.variance !== 0)
        .map((r: ShiftCloseRow) => ({
          item_name: itemNameById[r.item_id] || 'Unknown item',
          expected: r.actual_remaining - r.variance,
          counted: r.actual_remaining,
          variance: r.variance,
        }))

      // Staff — who joined this shift
      const { data: assignments, error: assignError } = await supabase
        .from('shift_assignments')
        .select('user_id, joined_at')
        .eq('shift_id', shift.id)
        .order('joined_at')
      if (assignError) throw new Error(assignError.message)

      const userIds = Array.from(new Set((assignments || []).map(a => a.user_id)))
      let staffNames: string[] = []
      if (userIds.length > 0) {
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, first_name, surname')
          .in('id', userIds)
        if (usersError) throw new Error(usersError.message)

        staffNames = (assignments || []).map(a => {
          const u = users?.find(u => u.id === a.user_id)
          return u ? `${u.first_name} ${u.surname}`.trim() : 'Unknown'
        })
        staffNames = Array.from(new Set(staffNames))
      }

      // Revenue
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('cash_amount, transfer_amount, total')
        .eq('shift_id', shift.id)
      if (ordersError) throw new Error(ordersError.message)

      const revenueCash = (orders || []).reduce((s, o) => s + Number(o.cash_amount || 0), 0)
      const revenueTransfer = (orders || []).reduce((s, o) => s + Number(o.transfer_amount || 0), 0)
      const revenueTotal = (orders || []).reduce((s, o) => s + Number(o.total || 0), 0)
      const orderCount = (orders || []).length

      // Expenses
      const { data: expenses, error: expensesError } = await supabase
        .from('expenses')
        .select('description, amount')
        .eq('shift_id', shift.id)
      if (expensesError) throw new Error(expensesError.message)

      const expenseRows: ExpenseRow[] = (expenses || []).map(e => ({
        description: e.description,
        amount: Number(e.amount),
      }))
      const expenseTotal = expenseRows.reduce((s, e) => s + e.amount, 0)

      // ---- Build the summary text ----
      const openedDate = new Date(shift.opened_at)
      const closedDate = new Date(shift.closed_at)

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

      setSummary(`*Uptimyzas Kitchen — Shift Report*
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

*Net:* ${net.toLocaleString()}`)

      setLoading(false)

    } catch (err: any) {
      console.error(err)
      toast('Could not load shift: ' + err.message, 'error')
      setLoading(false)
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

  if (notFound) {
    return (
      <div className="min-h-screen bg-bg-subtle flex items-center justify-center p-4">
        <div className="bg-white rounded-lg p-6 text-center max-w-sm">
          <h2 className="text-lg font-semibold mb-2">Shift not found</h2>
          <button
            onClick={() => router.push('/dashboard/shifts')}
            className="bg-primary text-white px-6 py-2 rounded-lg w-full"
          >
            Back to Shift History
          </button>
        </div>
      </div>
    )
  }

  if (notClosed) {
    return (
      <div className="min-h-screen bg-bg-subtle flex items-center justify-center p-4">
        <div className="bg-white rounded-lg p-6 text-center max-w-sm">
          <h2 className="text-lg font-semibold mb-2">This shift is still open</h2>
          <p className="text-gray-500 mb-4">Close it to generate its summary.</p>
          <button
            onClick={() => router.push('/dashboard/shift/close')}
            className="bg-primary text-white px-6 py-2 rounded-lg w-full"
          >
            Go to Close Shift
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-subtle p-4 pb-32">
      <button
        onClick={() => router.push('/dashboard/shifts')}
        className="flex items-center gap-1 text-sm text-text-secondary mb-3"
      >
        <ChevronLeft size={16} /> Shift History
      </button>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 max-w-lg mx-auto">
        <div className="p-4 border-b">
          <span className="font-semibold">Shift Summary</span>
        </div>
        <pre className="p-4 text-sm whitespace-pre-wrap font-sans">{summary}</pre>
      </div>

      <div className="fixed bottom-[68px] left-0 right-0 p-4 bg-gradient-to-t from-bg-subtle via-bg-subtle to-transparent pt-8 z-20">
        <div className="max-w-lg mx-auto">
          <button
            onClick={handleCopy}
            className="w-full bg-white border border-gray-200 text-primary py-3 rounded-xl font-medium flex items-center justify-center gap-2"
          >
            <Copy size={18} /> Copy Summary
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ShiftDetailPage() {
  return (
    <Suspense fallback={<Spinner fullScreen />}>
      <ShiftDetailContent />
    </Suspense>
  )
}