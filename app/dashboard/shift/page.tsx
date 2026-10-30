'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getActiveShift, ensureJoined, type ActiveShift } from '@/lib/shift'
import { useToast } from '@/lib/toast'
import Spinner from '@/components/Spinner'
import { ChefHat, Users, ArrowRight } from 'lucide-react'

type MenuItem = {
  id: string
  name: string
  category: string
  unit: string
  available: boolean
}

export default function ShiftGatePage() {
  const router = useRouter()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'start' | 'join' | null>(null)
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null)

  // "Start shift" form state
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [openingQty, setOpeningQty] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

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

      if (shift) {
        setActiveShift(shift)
        setMode('join')
        setLoading(false)
        return
      }

      // No open shift — load the menu so opening stock can be logged
      const { data: menu, error: menuError } = await supabase
        .from('menu_items')
        .select('id, name, category, unit, available')
        .eq('available', true)
        .order('category')

      if (menuError) throw new Error(menuError.message)

      setMenuItems(menu || [])
      setMode('start')
      setLoading(false)

    } catch (err: any) {
      console.error(err)
      toast('Could not load shift status: ' + err.message, 'error')
      setLoading(false)
    }
  }

  const handleJoin = async () => {
    const userSession = getSession()
    if (!userSession || !activeShift) return

    try {
      await ensureJoined(activeShift.id, userSession.id)
      router.push('/dashboard/orders')
    } catch (err: any) {
      console.error(err)
      toast('Could not join the shift: ' + err.message, 'error')
    }
  }

  const handleStartShift = async () => {
    const userSession = getSession()
    if (!userSession) return

    setSubmitting(true)

    try {
      // 1. Create the shift
      const { data: newShift, error: shiftError } = await supabase
        .from('shifts')
        .insert({
          opened_by: userSession.id,
          opened_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (shiftError) throw new Error(shiftError.message)

      // 2. Log opening stock for every menu item (0 if left blank —
      // meaning it wasn't cooked today)
      const stockRows = menuItems.map(item => {
        const qty = parseInt(openingQty[item.id] || '0') || 0
        return {
          shift_id: newShift.id,
          item_id: item.id,
          item_name: item.name,
          unit: item.unit,
          opening_qty: qty,
          added_qty: 0,
          quantity: qty,
        }
      })

      if (stockRows.length > 0) {
        const { error: stockError } = await supabase
          .from('shift_stock')
          .insert(stockRows)

        if (stockError) throw new Error(stockError.message)
      }

      // 3. Record the opener as the first participant
      await ensureJoined(newShift.id, userSession.id)

      router.push('/dashboard/orders')

    } catch (err: any) {
      console.error(err)
      toast('Could not start the shift: ' + err.message, 'error')
      setSubmitting(false)
    }
  }

  if (loading) {
    return <Spinner fullScreen />
  }

  if (mode === 'join' && activeShift) {
    return (
      <div className="min-h-screen bg-bg-subtle flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-6 text-center max-w-sm w-full shadow-sm">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Users size={26} className="text-primary" />
          </div>
          <h2 className="text-lg font-semibold mb-1">A shift is already open</h2>
          <p className="text-gray-500 text-sm mb-6">
            Started at {new Date(activeShift.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
            Join it to start selling alongside whoever's already on it.
          </p>
          <button
            onClick={handleJoin}
            className="bg-primary text-white px-6 py-3 rounded-xl w-full font-medium flex items-center justify-center gap-2"
          >
            Join Shift <ArrowRight size={18} />
          </button>
        </div>
      </div>
    )
  }

  // mode === 'start'
  return (
    <div className="min-h-screen bg-bg-subtle pb-32">
      <div className="bg-white border-b sticky top-0 z-10 px-4 py-4">
        <div className="flex items-center gap-2 mb-1">
          <ChefHat size={20} className="text-primary" />
          <span className="font-semibold">Start a New Shift</span>
        </div>
        <p className="text-sm text-gray-500">
          Log what's been cooked today. Leave anything not made at 0 —
          you can always add more stock live once the shift is running.
        </p>
      </div>

      <div className="p-4 space-y-3">
        {menuItems.map(item => (
          <div
            key={item.id}
            className="bg-white rounded-xl p-4 flex items-center justify-between shadow-sm border border-gray-200"
          >
            <div>
              <p className="font-medium text-sm">{item.name}</p>
              <p className="text-xs text-gray-400">{item.unit}</p>
            </div>
            <input
              type="number"
              min="0"
              value={openingQty[item.id] || ''}
              onChange={(e) =>
                setOpeningQty(prev => ({ ...prev, [item.id]: e.target.value }))
              }
              placeholder="0"
              className="w-20 text-center border border-gray-200 rounded-lg py-2 text-sm"
            />
          </div>
        ))}
      </div>

      <div className="fixed bottom-[68px] left-0 right-0 p-4 bg-gradient-to-t from-bg-subtle via-bg-subtle to-transparent pt-8 z-20">
        <button
          onClick={handleStartShift}
          disabled={submitting}
          className="w-full bg-primary text-white py-4 rounded-xl font-medium shadow-lg"
        >
          {submitting ? 'Starting Shift...' : 'Start Shift'}
        </button>
      </div>
    </div>
  )
}