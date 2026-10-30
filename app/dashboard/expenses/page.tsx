'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getActiveShift, type ActiveShift } from '@/lib/shift'
import { useToast } from '@/lib/toast'
import Spinner from '@/components/Spinner'
import { Plus, Trash2, X, Banknote, Smartphone } from 'lucide-react'

type Expense = {
  id: string
  description: string
  amount: number
  payment_method: string
  created_at: string
}

export default function ExpensesPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<any>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    payment_method: 'cash',
  })

  useEffect(() => {
    const userSession = getSession()
    if (!userSession) {
      router.push('/auth/login')
      return
    }
    setSession(userSession)
    checkActiveShift()
  }, [router])

  // Same shift lookup every other page uses (single `shifts` table,
  // open = closed_at is null) — this page previously queried a
  // `shift_sessions` table that nothing else in the app writes to,
  // which is why it always reported no shift open.
  const checkActiveShift = async () => {
    try {
      const shift = await getActiveShift()
      if (!shift) {
        toast('No active shift. Please open a shift first.', 'warning')
        router.replace('/dashboard')
        return
      }
      setActiveShift(shift)
      fetchExpenses(shift.id)
      setLoading(false)
    } catch (err: any) {
      console.error(err)
      toast('Could not verify the active shift', 'error')
      router.replace('/dashboard')
    }
  }

  const fetchExpenses = async (shiftId: string) => {
    const { data } = await supabase
      .from('expenses')
      .select('*')
      .eq('shift_id', shiftId)
      .order('created_at', { ascending: false })

    if (data) setExpenses(data)
  }

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeShift) return
    setSubmitting(true)

    const { error } = await supabase.from('expenses').insert({
      shift_id: activeShift.id,
      staff_id: session.id,
      description: formData.description,
      amount: parseFloat(formData.amount),
      payment_method: formData.payment_method,
    })

    if (error) {
      toast('Error adding expense: ' + error.message, 'error')
    } else {
      toast('Expense added', 'success')
      fetchExpenses(activeShift.id)
      closeModal()
    }
    setSubmitting(false)
  }

  const handleDelete = async (id: string) => {
    if (!activeShift) return
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) {
      toast('Error deleting expense', 'error')
    } else {
      toast('Expense deleted', 'info')
      fetchExpenses(activeShift.id)
    }
    setShowDeleteConfirm(null)
  }

  const closeModal = () => {
    setShowModal(false)
    setFormData({ description: '', amount: '', payment_method: 'cash' })
  }

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const cashTotal     = expenses.filter(e => e.payment_method === 'cash').reduce((s, e) => s + e.amount, 0)
  const transferTotal = expenses.filter(e => e.payment_method === 'transfer').reduce((s, e) => s + e.amount, 0)

  if (loading) {
    return <Spinner fullScreen />
  }

  return (
    <div className="min-h-screen bg-bg-subtle pb-24">
      <div className="p-4 space-y-4">

        {/* Summary card */}
        <div className="bg-primary rounded-[18px] p-5 text-white">
          <p className="t-small text-white/60 uppercase tracking-widest mb-1">
            Active Shift
          </p>
          <p className="t-small text-white/50 mb-3">
            Started {activeShift && new Date(activeShift.opened_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
          <p className="t-small text-white/70 mb-1">Total Expenses</p>
          <p className="text-[32px] font-semibold text-white leading-none">
            ₦{totalExpenses.toLocaleString()}
          </p>

          {/* Cash / Transfer breakdown */}
          <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-white/20">
            <div>
              <p className="t-small text-white/50">Cash</p>
              <p className="t-h3 text-white">₦{cashTotal.toLocaleString()}</p>
            </div>
            <div>
              <p className="t-small text-white/50">Transfer</p>
              <p className="t-h3 text-white">₦{transferTotal.toLocaleString()}</p>
            </div>
          </div>
        </div>

        {/* Add button */}
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          Add Expense
        </button>

        {/* Expenses list */}
        <div>
          <p className="t-h3 text-text-primary mb-3">This Shift</p>
          {expenses.length === 0 ? (
            <div className="card text-center py-12">
              <p className="t-body text-text-muted">No expenses logged yet</p>
              <p className="t-small text-text-muted mt-1">Tap "Add Expense" to record one</p>
            </div>
          ) : (
            <div className="space-y-2">
              {expenses.map((expense) => (
                <div key={expense.id} className="card flex items-center gap-3">
                  {/* Method icon */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    expense.payment_method === 'cash'
                      ? 'bg-[#2E7D32]/10'
                      : 'bg-[#1565C0]/10'
                  }`}>
                    {expense.payment_method === 'cash'
                      ? <Banknote size={18} className="text-[#2E7D32]" />
                      : <Smartphone size={18} className="text-[#1565C0]" />
                    }
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <p className="t-body text-text-primary font-medium truncate">
                      {expense.description}
                    </p>
                    <p className="t-small text-text-muted">
                      {expense.payment_method === 'cash' ? 'Cash' : 'Transfer'} ·{' '}
                      {new Date(expense.created_at).toLocaleTimeString('en-NG', {
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </p>
                  </div>

                  {/* Amount + delete */}
                  <div className="text-right flex-shrink-0">
                    <p className="t-body text-danger font-semibold">
                      ₦{expense.amount.toLocaleString()}
                    </p>
                    <button
                      onClick={() => setShowDeleteConfirm(expense.id)}
                      className="text-text-muted min-h-0 min-w-0 w-6 h-6 flex items-center justify-center mt-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add expense modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white w-full max-w-md rounded-t-[24px] p-5">
            <div className="w-10 h-1 rounded-full bg-border mx-auto mb-5" />
            <div className="flex justify-between items-center mb-5">
              <p className="t-h2 text-text-primary">Add Expense</p>
              <button
                onClick={closeModal}
                className="text-text-muted min-h-0 min-w-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-bg-subtle"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddExpense} className="space-y-4">
              <div>
                <label className="block t-label text-text-primary mb-2">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-base"
                  placeholder="e.g., Gas, Market purchase, Transport"
                  required
                />
              </div>
              <div>
                <label className="block t-label text-text-primary mb-2">Amount (₦)</label>
                <input
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  className="input-base"
                  placeholder="0"
                  inputMode="numeric"
                  required
                />
              </div>
              <div>
                <label className="block t-label text-text-primary mb-2">Payment Method</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['cash', 'transfer'] as const).map(method => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setFormData({ ...formData, payment_method: method })}
                      className={`py-3 rounded-[12px] t-label capitalize transition-colors min-h-0 ${
                        formData.payment_method === method
                          ? 'bg-primary text-white'
                          : 'bg-bg-subtle text-text-secondary border border-border'
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1">
                  {submitting ? 'Saving...' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40">
          <div className="bg-white w-full max-w-md rounded-t-[24px] p-5">
            <div className="w-10 h-1 rounded-full bg-border mx-auto mb-5" />
            <p className="t-h2 text-text-primary">Delete this expense?</p>
            <p className="t-body text-text-secondary mt-2">This cannot be undone.</p>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowDeleteConfirm(null)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button onClick={() => handleDelete(showDeleteConfirm)} className="btn-primary flex-1">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}