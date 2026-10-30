'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import Spinner from '@/components/Spinner'
import { Search, User, Package } from 'lucide-react'

type Order = {
  id: string
  items_json: any[]
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

export default function OrderHistoryPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<Order[]>([])
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

  const fetchStaffList = async () => {
    const { data } = await supabase.from('users').select('id, first_name, surname').eq('status', 'active').order('first_name')
    if (data) setStaffList(data)
  }

  const fetchOrders = async () => {
    setLoading(true)
    let query = supabase
      .from('orders')
      .select('*, users(first_name, surname)')
      .order('created_at', { ascending: false })

    if (startDate) query = query.gte('created_at', `${startDate}T00:00:00`)
    if (endDate)   query = query.lte('created_at', `${endDate}T23:59:59`)
    if (selectedStaff)   query = query.eq('staff_id', selectedStaff)
    if (selectedPayment) query = query.eq('payment_method', selectedPayment)

    const { data } = await query
    if (data) {
      setOrders(data.map(o => ({
        ...o,
        staff_name: o.users ? `${o.users.first_name} ${o.users.surname}` : 'Unknown'
      })))
    }
    setLoading(false)
  }

  const clearFilters = () => {
    setStartDate('')
    setEndDate('')
    setSelectedStaff('')
    setSelectedPayment('')
    fetchOrders()
  }

  const totalRevenue = orders.reduce((s, o) => s + o.total, 0)
  const avgOrder = orders.length > 0 ? totalRevenue / orders.length : 0

  if (loading) {
    return <Spinner fullScreen />
  }

  return (
    <div className="min-h-screen bg-bg-subtle pb-24">
      <div className="p-4 space-y-4">

        <h1 className="t-h1 text-text-primary">Order History</h1>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Orders', value: orders.length, color: 'text-primary' },
            { label: 'Total Revenue', value: `₦${totalRevenue.toLocaleString()}`, color: 'text-[#2E7D32]' },
            { label: 'Avg Order', value: `₦${Math.round(avgOrder).toLocaleString()}`, color: 'text-[#1565C0]' },
          ].map(({ label, value, color }) => (
            <div key={label} className="card text-center">
              <p className="t-small text-text-muted">{label}</p>
              <p className={`t-h2 ${color} mt-1`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="card space-y-3">
          <p className="t-h3 text-text-primary">Filters</p>
          <div className="grid grid-cols-2 gap-3">
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
          <div className="flex gap-3">
            <button onClick={fetchOrders} className="btn-primary flex-1 flex items-center justify-center gap-2">
              <Search size={16} /> Search
            </button>
            <button onClick={clearFilters} className="btn-secondary flex-1">Clear</button>
          </div>
        </div>

        {/* Orders list */}
        <div className="space-y-2">
          {orders.length === 0 ? (
            <div className="card text-center py-10">
              <Package size={32} className="mx-auto text-text-muted mb-2" />
              <p className="t-body text-text-muted">No orders found</p>
            </div>
          ) : (
            orders.map((order) => (
              <div
                key={order.id}
                className="card cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => setSelectedOrder(order)}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="t-mono text-text-muted">#{order.id.slice(-8)}</p>
                    <p className="t-h3 text-text-primary mt-0.5">₦{order.total.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="t-label text-text-primary capitalize">{order.payment_method}</p>
                    <p className="t-small text-text-muted mt-0.5">{new Date(order.created_at).toLocaleString('en-NG')}</p>
                  </div>
                </div>
                <div className="flex justify-between t-small text-text-secondary">
                  <div className="flex items-center gap-1.5">
                    <User size={12} />
                    <span>{order.staff_name}</span>
                  </div>
                  <span>{order.items_json.length} item(s)</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Order detail modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-t-[20px] max-h-[85vh] flex flex-col">
            <div className="px-5 pt-5 pb-4 border-b border-border flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-border mx-auto mb-4" />
              <div className="flex justify-between items-center">
                <p className="t-h2 text-text-primary">Order Details</p>
                <button onClick={() => setSelectedOrder(null)} className="text-text-muted min-h-0 min-w-0 w-8 h-8 flex items-center justify-center">✕</button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              <div className="bg-bg-subtle rounded-[10px] p-3">
                <p className="t-mono text-text-muted">#{selectedOrder.id.slice(-8)}</p>
                <p className="t-small text-text-secondary mt-0.5">{new Date(selectedOrder.created_at).toLocaleString('en-NG')}</p>
                <p className="t-small text-text-secondary">Staff: {selectedOrder.staff_name}</p>
              </div>

              <div>
                <p className="t-h3 text-text-primary mb-2">Items</p>
                <div className="space-y-2">
                  {selectedOrder.items_json.map((item, idx) => (
                    <div key={idx} className="flex justify-between">
                      <p className="t-body text-text-secondary">{item.qty}× {item.name}</p>
                      <p className="t-mono text-text-primary">₦{item.subtotal.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border mt-2 pt-2 flex justify-between">
                  <p className="t-h3 text-text-primary">Total</p>
                  <p className="t-h2 text-primary">₦{selectedOrder.total.toLocaleString()}</p>
                </div>
              </div>

              <div>
                <p className="t-h3 text-text-primary mb-2">Payment</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <p className="t-small text-text-muted">Method</p>
                    <p className="t-label text-text-primary capitalize">{selectedOrder.payment_method}</p>
                  </div>
                  {selectedOrder.cash_amount > 0 && (
                    <div className="flex justify-between">
                      <p className="t-small text-text-muted">Cash</p>
                      <p className="t-mono text-text-primary">₦{selectedOrder.cash_amount.toLocaleString()}</p>
                    </div>
                  )}
                  {selectedOrder.transfer_amount > 0 && (
                    <div className="flex justify-between">
                      <p className="t-small text-text-muted">Transfer</p>
                      <p className="t-mono text-text-primary">₦{selectedOrder.transfer_amount.toLocaleString()}</p>
                    </div>
                  )}
                  {selectedOrder.change_given > 0 && (
                    <div className="flex justify-between">
                      <p className="t-small text-text-muted">Change Given</p>
                      <p className="t-mono text-[#2E7D32]">₦{selectedOrder.change_given.toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </div>
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