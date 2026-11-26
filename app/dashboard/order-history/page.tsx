'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import Spinner from '@/components/Spinner'
import { Search, User, Package } from 'lucide-react'

type Order = {
  id: string
  items_json: { item_id: string; name: string; qty: number; unit_price: number; subtotal: number }[]
  total: number
  payment_method: string
  cash_amount: number
  transfer_amount: number
  change_given: number
  created_at: string
  staff_id: string
  staff_name?: string
}

type Staff = {
  id: string
  first_name: string
  surname: string
}

function OrderDetailBody({ order }: { order: Order }) {
  return (
    <div className="space-y-4">
      <div className="bg-bg-subtle rounded-[10px] p-3">
        <p className="t-mono text-text-muted">#{order.id.slice(-8)}</p>
        <p className="t-small text-text-secondary mt-0.5">{new Date(order.created_at).toLocaleString('en-NG')}</p>
        <p className="t-small text-text-secondary">Staff: {order.staff_name}</p>
      </div>

      <div>
        <p className="t-h3 text-text-primary mb-2">Items</p>
        <div className="space-y-2">
          {order.items_json.map((item, idx) => (
            <div key={idx} className="flex justify-between">
              <p className="t-body text-text-secondary">{item.qty}&times; {item.name}</p>
              <p className="t-mono text-text-primary">{'\u20A6'}{item.subtotal.toLocaleString()}</p>
            </div>
          ))}
        </div>
        <div className="border-t border-border mt-2 pt-2 flex justify-between">
          <p className="t-h3 text-text-primary">Total</p>
          <p className="t-h2 text-primary">{'\u20A6'}{order.total.toLocaleString()}</p>
        </div>
      </div>

      <div>
        <p className="t-h3 text-text-primary mb-2">Payment</p>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <p className="t-small text-text-muted">Method</p>
            <p className="t-label text-text-primary capitalize">{order.payment_method}</p>
          </div>
          {order.cash_amount > 0 && (
            <div className="flex justify-between">
              <p className="t-small text-text-muted">Cash</p>
              <p className="t-mono text-text-primary">{'\u20A6'}{order.cash_amount.toLocaleString()}</p>
            </div>
          )}
          {order.transfer_amount > 0 && (
            <div className="flex justify-between">
              <p className="t-small text-text-muted">Transfer</p>
              <p className="t-mono text-text-primary">{'\u20A6'}{order.transfer_amount.toLocaleString()}</p>
            </div>
          )}
          {order.change_given > 0 && (
            <div className="flex justify-between">
              <p className="t-small text-text-muted">Change Given</p>
              <p className="t-mono text-success">{'\u20A6'}{order.change_given.toLocaleString()}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const PAGE_SIZE = 50
// Supabase returns at most 1000 rows per request, so totals are read in 1000-row pages
const SUM_PAGE = 1000

type Filters = { startDate: string; endDate: string; staff: string; payment: string }

// "2025-03-01" typed by a user in Lagos means local midnight, not UTC midnight
const dayStart = (d: string) => new Date(`${d}T00:00:00`).toISOString()
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999`).toISOString()

// ₦1,250,000 -> ₦1.25M so three stat cards fit side by side on a phone
function compactNaira(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `₦${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '')}M`
  if (abs >= 100_000) return `₦${Math.round(n / 1000)}k`
  return `₦${Math.round(n).toLocaleString()}`
}

export default function OrderHistoryPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [staffList, setStaffList] = useState<Staff[]>([])
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedStaff, setSelectedStaff] = useState('')
  const [selectedPayment, setSelectedPayment] = useState('')

  useEffect(() => {
    const userSession = getSession()
    if (!userSession) {
      router.replace('/auth/login')
    } else {
      fetchStaffList()
      fetchOrders()
    }
  }, [router])

  async function fetchStaffList() {
    const { data } = await supabase.from('profiles').select('id, first_name, surname').order('first_name')
    if (data) setStaffList(data)
  }

  const current = (): Filters => ({
    startDate,
    endDate,
    staff: selectedStaff,
    payment: selectedPayment,
  })

  // every list and total uses the same filters, so they can never disagree
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyFilters(query: any, f: Filters): any {
    let q = query
    if (f.startDate) q = q.gte('created_at', dayStart(f.startDate))
    if (f.endDate) q = q.lte('created_at', dayEnd(f.endDate))
    if (f.staff) q = q.eq('staff_id', f.staff)
    if (f.payment) q = q.eq('payment_method', f.payment)
    return q
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function toOrders(rows: any[]): Order[] {
    return rows.map(o => ({
      ...o,
      staff_name: o.profiles ? `${o.profiles.first_name} ${o.profiles.surname}` : 'Unknown',
    }))
  }

  // real totals for everything that matches, not just the rows on screen
  async function fetchTotals(f: Filters) {
    const { count } = await applyFilters(
      supabase.from('orders').select('id', { count: 'exact', head: true }),
      f
    )
    setTotalCount(count ?? 0)

    let sum = 0
    for (let from = 0; ; from += SUM_PAGE) {
      const { data } = await applyFilters(supabase.from('orders').select('total'), f)
        .order('created_at', { ascending: false })
        .range(from, from + SUM_PAGE - 1)
      if (!data || data.length === 0) break
      sum += data.reduce((acc: number, o: { total: number }) => acc + Number(o.total || 0), 0)
      if (data.length < SUM_PAGE) break
    }
    setTotalRevenue(sum)
  }

  async function fetchOrders(f: Filters = current()) {
    setLoading(true)
    const [{ data }] = await Promise.all([
      applyFilters(supabase.from('orders').select('*, profiles(first_name, surname)'), f)
        .order('created_at', { ascending: false })
        .range(0, PAGE_SIZE - 1),
      fetchTotals(f),
    ])
    setOrders(data ? toOrders(data) : [])
    setSelectedOrder(null)
    setLoading(false)
  }

  async function loadMore() {
    setLoadingMore(true)
    const { data } = await applyFilters(
      supabase.from('orders').select('*, profiles(first_name, surname)'),
      current()
    )
      .order('created_at', { ascending: false })
      .range(orders.length, orders.length + PAGE_SIZE - 1)
    if (data) setOrders(prev => [...prev, ...toOrders(data)])
    setLoadingMore(false)
  }

  const clearFilters = () => {
    setStartDate('')
    setEndDate('')
    setSelectedStaff('')
    setSelectedPayment('')
    fetchOrders({ startDate: '', endDate: '', staff: '', payment: '' })
  }

  const avgOrder = totalCount > 0 ? totalRevenue / totalCount : 0

  if (loading && orders.length === 0 && totalCount === 0) {
    return <Spinner fullScreen />
  }

  return (
    <div className="min-h-full bg-bg-subtle pb-24">
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:space-y-6 md:p-6">

        <h1 className="t-h1 text-text-primary">Order History</h1>

        {/* Stats: real totals for every matching order */}
        <div className="grid grid-cols-3 gap-2 md:gap-3">
          {[
            { label: 'Total Orders', full: totalCount.toLocaleString(), short: totalCount.toLocaleString(), color: 'text-primary' },
            { label: 'Total Revenue', full: `₦${totalRevenue.toLocaleString()}`, short: compactNaira(totalRevenue), color: 'text-success' },
            { label: 'Avg Order', full: `₦${Math.round(avgOrder).toLocaleString()}`, short: compactNaira(avgOrder), color: 'text-info' },
          ].map(({ label, full, short, color }) => (
            <div key={label} className="card min-w-0 px-2 text-center md:px-4">
              <p className="t-small truncate text-text-muted">{label}</p>
              <p className={`text-base font-medium md:text-xl ${color} mt-1 truncate`}>
                <span className="md:hidden">{short}</span>
                <span className="hidden md:inline">{full}</span>
              </p>
            </div>
          ))}
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-6">
        <div className="min-w-0 space-y-4 md:space-y-6">
        {/* Filters */}
        <div className="card space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
          <p className="t-h3 text-text-primary md:col-span-2">Filters</p>
          <div className="grid grid-cols-2 gap-3 md:col-span-2">
            <div>
              <label className="block t-label text-text-primary mb-1">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-base" />
            </div>
            <div>
              <label className="block t-label text-text-primary mb-1">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-base" />
            </div>
          </div>
          <div>
            <label className="block t-label text-text-primary mb-1">Staff Member</label>
            <select value={selectedStaff} onChange={(e) => setSelectedStaff(e.target.value)} className="input-base">
              <option value="">All Staff</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.first_name} {s.surname}</option>)}
            </select>
          </div>
          <div>
            <label className="block t-label text-text-primary mb-1">Payment Method</label>
            <select value={selectedPayment} onChange={(e) => setSelectedPayment(e.target.value)} className="input-base">
              <option value="">All Methods</option>
              <option value="cash">Cash</option>
              <option value="transfer">Transfer</option>
              <option value="split">Split</option>
            </select>
          </div>
          <div className="flex gap-3 md:col-span-2">
            <button onClick={() => fetchOrders()} className="btn-primary flex-1 flex items-center justify-center gap-2">
              <Search size={16} /> Search
            </button>
            <button onClick={clearFilters} className="btn-secondary flex-1">Clear</button>
          </div>
        </div>

        {/* Orders list */}
        <div className="space-y-2">
          {totalCount > 0 && (
            <p className="t-small text-text-muted px-1">
              Showing {orders.length.toLocaleString()} of {totalCount.toLocaleString()} orders
            </p>
          )}
          {orders.length === 0 ? (
            <div className="card text-center py-10">
              <Package size={32} className="mx-auto text-text-muted mb-2" />
              <p className="t-body text-text-muted">No orders found</p>
            </div>
          ) : (
            orders.map((order) => (
              <div
                key={order.id}
                className={`card press press-flat cursor-pointer ${selectedOrder?.id === order.id ? 'lg:border-primary! lg:bg-primary-light!' : ''}`}
                onClick={() => setSelectedOrder(order)}
              >
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="t-mono text-text-muted">#{order.id.slice(-8)}</p>
                    <p className="t-h3 text-text-primary mt-0.5">₦{order.total.toLocaleString()}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="t-label text-text-primary capitalize">{order.payment_method}</p>
                    <p className="t-small text-text-muted mt-0.5">
                      {new Date(order.created_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                </div>
                <div className="flex justify-between gap-3 t-small text-text-secondary">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <User size={12} className="shrink-0" />
                    <span className="truncate">{order.staff_name}</span>
                  </div>
                  <span className="shrink-0">{order.items_json.length} item{order.items_json.length === 1 ? '' : 's'}</span>
                </div>
              </div>
            ))
          )}
          {orders.length < totalCount && (
            <button onClick={loadMore} disabled={loadingMore} className="btn-secondary w-full">
              {loadingMore ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, totalCount - orders.length)} more`}
            </button>
          )}
        </div>
        </div>

        {/* Detail pane: always visible beside the list on wide screens */}
        <aside className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto">
          <div className="card space-y-4">
            <p className="t-h2 text-text-primary">Order Details</p>
            {selectedOrder ? (
              <OrderDetailBody order={selectedOrder} />
            ) : (
              <div className="py-10 text-center">
                <Package size={32} className="mx-auto mb-2 text-text-muted" />
                <p className="t-body text-text-muted">Select an order</p>
                <p className="t-small mt-1 text-text-muted">Tap any order on the left to see its items and payment.</p>
              </div>
            )}
          </div>
        </aside>
        </div>
      </div>

      {/* Order detail modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50 md:items-center lg:hidden">
          <div className="bg-white w-full max-w-md rounded-t-[20px] max-h-[85vh] flex flex-col md:rounded-[20px]">
            <div className="px-5 pt-5 pb-4 border-b border-border flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-border mx-auto mb-4" />
              <div className="flex justify-between items-center">
                <p className="t-h2 text-text-primary">Order Details</p>
                <button onClick={() => setSelectedOrder(null)} className="text-text-muted min-h-0 min-w-0 w-8 h-8 flex items-center justify-center">✕</button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4">
              <OrderDetailBody order={selectedOrder} />
            </div>

            <div className="px-5 py-4 border-t border-border flex-shrink-0">
              <button onClick={() => setSelectedOrder(null)} className="btn-primary w-full">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
