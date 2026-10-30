'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getActiveShift, type ActiveShift } from '@/lib/shift'
import { useToast } from '@/lib/toast'
import Spinner from '@/components/Spinner'
import { Package, Receipt, Users, TrendingUp } from 'lucide-react'

export default function DashboardPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<any>(null)
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null)
  const [stats, setStats] = useState({
    todayOrders: 0,
    todayRevenue: 0,
    activeStaff: 0,
    lowStockItems: 0,
  })

  useEffect(() => {
    const userSession = getSession()
    if (!userSession) {
      router.replace('/auth/login')
      return
    }
    setSession(userSession)
    loadDashboard()
  }, [router])

  const loadDashboard = async () => {
    try {
      setLoading(true)
      const today = new Date().toISOString().split('T')[0]

      const { count: orderCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`)

      const { data: orders } = await supabase
        .from('orders')
        .select('total')
        .gte('created_at', `${today}T00:00:00`)
        .lte('created_at', `${today}T23:59:59`)

      const totalRevenue = orders?.reduce((sum, o) => sum + o.total, 0) || 0

      const { count: staffCount } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')

      // Find the current shift, and — if one's open — its low-stock items.
      // (Stock is now scoped per shift, so this only means something while
      // a shift is actually running.)
      const shift = await getActiveShift()
      setActiveShift(shift)

      let lowStockCount = 0
      if (shift) {
        const { data: lowStock } = await supabase
          .from('shift_stock')
          .select('item_name, quantity')
          .eq('shift_id', shift.id)
          .lt('quantity', 5)
        lowStockCount = lowStock?.length || 0
      }

      setStats({
        todayOrders: orderCount || 0,
        todayRevenue: totalRevenue,
        activeStaff: staffCount || 0,
        lowStockItems: lowStockCount,
      })
    } catch (error) {
      console.error('Error loading dashboard:', error)
      toast('Failed to load dashboard data', 'error')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <Spinner fullScreen />
  }

  return (
    <div className="min-h-screen bg-bg-subtle">
      <div className="p-4 space-y-4">
        {/* Welcome Section */}
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h1 className="text-xl font-bold text-text-primary">
            Welcome back, {session?.first_name || 'there'}!
          </h1>
          <p className="text-sm text-text-secondary">
            {new Date().toLocaleDateString('en-NG', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <Receipt size={20} className="text-primary" />
              <span className="text-xs text-text-secondary">Today</span>
            </div>
            <p className="text-2xl font-bold text-text-primary mt-1">{stats.todayOrders}</p>
            <p className="text-xs text-text-secondary">Orders</p>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <TrendingUp size={20} className="text-[#2E7D32]" />
              <span className="text-xs text-text-secondary">Today</span>
            </div>
            <p className="text-2xl font-bold text-text-primary mt-1">₦{stats.todayRevenue.toLocaleString()}</p>
            <p className="text-xs text-text-secondary">Revenue</p>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <Users size={20} className="text-blue-500" />
              <span className="text-xs text-text-secondary">Active</span>
            </div>
            <p className="text-2xl font-bold text-text-primary mt-1">{stats.activeStaff}</p>
            <p className="text-xs text-text-secondary">Staff</p>
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <Package size={20} className="text-warning" />
              <span className="text-xs text-text-secondary">Low Stock</span>
            </div>
            <p className="text-2xl font-bold text-text-primary mt-1">{stats.lowStockItems}</p>
            <p className="text-xs text-text-secondary">Items</p>
          </div>
        </div>

        {/* Shift Control — adapts to whether a shift is currently open */}
        <button
          onClick={() => router.push(activeShift ? '/dashboard/shift/close' : '/dashboard/shift')}
          className={`w-full p-4 rounded-xl text-left transition-all active:scale-95 hover:shadow-lg ${
            activeShift
              ? 'bg-white border border-danger text-danger'
              : 'bg-white border border-primary text-primary'
          }`}
        >
          <p className="font-semibold">{activeShift ? 'Close Shift' : 'Start Shift'}</p>
          <p className="text-sm opacity-80">
            {activeShift
              ? 'End the current shift and get the summary'
              : 'Log opening stock and begin selling'}
          </p>
        </button>

        <button
  onClick={() => router.push('/dashboard/shifts')}
  className="w-full p-3 rounded-xl text-center text-sm text-text-secondary border border-gray-200"
>
  View Shift History
</button>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => router.push('/dashboard/orders')}
            className="p-4 rounded-xl text-left bg-primary text-white hover:shadow-lg active:scale-95 transition-all"
          >
            <p className="font-semibold">Take Order</p>
            <p className="text-sm opacity-80">Start a new order</p>
          </button>

          <button
            onClick={() => router.push('/dashboard/stock')}
            className="p-4 rounded-xl text-left bg-white border border-primary text-primary hover:shadow-lg active:scale-95 transition-all"
          >
            <p className="font-semibold">Manage Stock</p>
            <p className="text-sm opacity-80">View and update stock</p>
          </button>
        </div>
      </div>
    </div>
  )
}