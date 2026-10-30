'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { useToast } from '@/lib/toast'
import Spinner from '@/components/Spinner'
import { ChevronRight, Calendar } from 'lucide-react'

type ShiftListItem = {
  id: string
  opened_at: string
  closed_at: string
  staffNames: string[]
  totalRevenue: number
}

export default function ShiftsHistoryPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [shifts, setShifts] = useState<ShiftListItem[]>([])

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
      const { data: shiftRows, error: shiftsError } = await supabase
        .from('shifts')
        .select('id, opened_at, closed_at')
        .not('closed_at', 'is', null)
        .order('closed_at', { ascending: false })

      if (shiftsError) throw new Error(shiftsError.message)

      const enriched = await Promise.all(
        (shiftRows || []).map(async (shift) => {
          const [{ data: assignments }, { data: orders }] = await Promise.all([
            supabase
              .from('shift_assignments')
              .select('user_id, joined_at')
              .eq('shift_id', shift.id)
              .order('joined_at'),
            supabase
              .from('orders')
              .select('total')
              .eq('shift_id', shift.id),
          ])

          const userIds = Array.from(new Set((assignments || []).map(a => a.user_id)))
          let staffNames: string[] = []
          if (userIds.length > 0) {
            const { data: users } = await supabase
              .from('users')
              .select('id, first_name, surname')
              .in('id', userIds)

            staffNames = (assignments || []).map(a => {
              const u = users?.find(u => u.id === a.user_id)
              return u ? `${u.first_name} ${u.surname}`.trim() : 'Unknown'
            })
            staffNames = Array.from(new Set(staffNames))
          }

          const totalRevenue = (orders || []).reduce((s, o) => s + Number(o.total || 0), 0)

          return {
            id: shift.id,
            opened_at: shift.opened_at,
            closed_at: shift.closed_at,
            staffNames,
            totalRevenue,
          }
        })
      )

      setShifts(enriched)
    } catch (err: any) {
      console.error(err)
      toast('Could not load shift history: ' + err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <Spinner fullScreen />
  }

  return (
    <div className="min-h-screen bg-bg-subtle pb-8">
      <div className="bg-white border-b sticky top-0 z-10 px-4 py-4">
        <span className="font-semibold">Shift History</span>
      </div>

      <div className="p-4 space-y-3">
        {shifts.length === 0 ? (
          <div className="bg-white rounded-xl p-6 text-center text-gray-400 text-sm">
            No closed shifts yet.
          </div>
        ) : (
          shifts.map(shift => (
            <button
              key={shift.id}
              onClick={() => router.push(`/dashboard/shifts/view?id=${shift.id}`)}
              className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-200 flex items-center justify-between text-left"
            >
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Calendar size={16} className="text-primary" />
                  {new Date(shift.opened_at).toLocaleDateString([], {
                    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {shift.staffNames.join(', ') || 'No staff recorded'}
                </p>
              </div>
              <div className="text-right flex items-center gap-2">
                <p className="font-semibold text-primary">
                  ₦{shift.totalRevenue.toLocaleString()}
                </p>
                <ChevronRight size={18} className="text-gray-300" />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}