'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession, type UserSession } from '@/lib/auth'
import { getActiveShift, type ActiveShift } from '@/lib/shift'
import { useAlert, useToast } from '@/lib/toast'
import Spinner from '@/components/Spinner'
import { flushVoiceFeedback } from '@/lib/voice/feedback'
import { Banknote, Smartphone, ArrowLeftRight, CheckCircle2 } from 'lucide-react'

type CartItem = {
  id: string
  name: string
  price: number
  quantity: number
  unit: string
}

const PAYMENT_METHODS = [
  { key: 'cash',     label: 'Cash',     icon: Banknote       },
  { key: 'transfer', label: 'Transfer', icon: Smartphone     },
  { key: 'split',    label: 'Split',    icon: ArrowLeftRight },
] as const

export default function PaymentPage() {
  const router = useRouter()
  const toast  = useToast()
  const showAlert = useAlert()
  const [isRouterReady, setIsRouterReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [success, setSuccess] = useState(false)
  const [session, setSession] = useState<UserSession | null>(null)
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'split'>('cash')
  const [cashAmount, setCashAmount] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [amountReceived, setAmountReceived] = useState('')

  // One id per checkout. It is sent with every attempt, so if the connection
  // drops after the server saved the order and the cashier taps again, the
  // server returns the saved order instead of creating a second one.
  const [orderId] = useState(() => crypto.randomUUID())

  // `replace: true` is used for every guard bounce and for the final
  // handoff to the receipt - none of those should leave this page sitting
  // in browser history. Payment is a mid-flow step: you should never be
  // able to hit "back" into it once you've moved past it, whether that's
  // because the order succeeded or because a guard kicked you out.
  const navigate = useCallback((path: string, opts?: { replace?: boolean }) => {
    if (isRouterReady) {
      if (opts?.replace) { router.replace(path) } else { router.push(path) }
    } else {
      window.location.href = path
    }
  }, [isRouterReady, router])

  useEffect(() => {
    setIsRouterReady(true)
  }, [])

  useEffect(() => {
    if (!isRouterReady) return

    const init = async () => {
      const userSession = getSession()
      if (!userSession) {
        navigate('/auth/login', { replace: true })
        return
      }
      setSession(userSession)

      const saved = localStorage.getItem('current_order_cart')
      if (!saved) {
        navigate('/dashboard/orders', { replace: true })
        return
      }
      setCart(JSON.parse(saved))

      // Payment can only happen against the currently open shift. If none
      // is open (shouldn't normally happen if you came from the orders
      // page, but covers edge cases like the shift closing mid-checkout),
      // bounce back rather than letting checkout proceed with no shift.
      try {
        const shift = await getActiveShift()
        if (!shift) {
          toast('No shift is open right now. Start a shift to take payment.', 'warning')
          navigate('/dashboard/orders', { replace: true })
          return
        }
        setActiveShift(shift)
      } catch (err) {
        console.error(err)
        toast("Couldn't check your shift. Check your connection and try again.", 'error')
        navigate('/dashboard/orders', { replace: true })
        return
      }

      setLoading(false)
    }

    init()
  }, [isRouterReady, navigate])

  const total    = cart.reduce((s, i) => s + i.price * i.quantity, 0)
  const change   = parseFloat(amountReceived) - total
  const splitSum = (parseFloat(cashAmount) || 0) + (parseFloat(transferAmount) || 0)
  const splitOk  = splitSum === total
  const splitDiff = total - splitSum

  const handleConfirmOrder = async () => {
    if (!session) return
    if (!activeShift) {
      toast('No open shift. Start a shift before taking payment.', 'warning')
      return
    }

    if (paymentMethod === 'cash') {
      const received = parseFloat(amountReceived)
      if (isNaN(received) || received < total) {
        toast(isNaN(received) ? 'Enter the amount the customer gave you.' : `Amount received is ₦${(total - received).toLocaleString()} short. Enter at least ₦${total.toLocaleString()}.`, 'warning')
        return
      }
    }
    if (paymentMethod === 'split' && !splitOk) {
      toast(`Cash and transfer must add up to ₦${total.toLocaleString()}. ${splitDiff > 0 ? '₦' + splitDiff.toLocaleString() + ' to go.' : '₦' + Math.abs(splitDiff).toLocaleString() + ' too much.'}`, 'warning')
      return
    }

    setProcessing(true)

    // One call does everything in a single transaction on the server: it
    // checks stock, takes it, and saves the order. If anything fails, nothing
    // is saved and no stock moves.
    const { data: order, error } = await supabase.rpc('place_order', {
      p_order_id:        orderId,
      p_shift_id:        activeShift.id,
      p_items:           cart.map(i => ({ item_id: i.id, qty: i.quantity })),
      p_payment_method:  paymentMethod,
      p_amount_received: paymentMethod === 'cash' ? parseFloat(amountReceived) : null,
      p_cash_amount:     paymentMethod === 'split' ? (parseFloat(cashAmount) || 0) : 0,
      p_transfer_amount: paymentMethod === 'split' ? (parseFloat(transferAmount) || 0) : 0,
      p_expected_total:  total,
    })

    if (error || !order) {
      console.error(error)
      setProcessing(false)

      // P0001 = a rule on the server said no (stock, prices, closed shift).
      // The message is already written for the cashier.
      if (error?.code === 'P0001') {
        showAlert({ title: "Order wasn't saved", message: `${error.message}. Nothing was recorded and stock was not changed.`, tone: 'warning', actionLabel: 'OK' })
      } else {
        // Connection problem. Safe to retry: the same order id means the order
        // can only ever be saved once.
        toast("Couldn't reach the server. Check your connection and tap Confirm again.", 'error', { label: 'Retry', onClick: handleConfirmOrder })
      }
      return
    }

    // The order is saved and stock is already taken. Build the receipt from
    // what the server stored, so it shows the prices that were actually charged.
    type SavedLine = { name: string; qty: number; unit_price: number }
    const savedLines = order.items_json as SavedLine[]

    localStorage.removeItem('current_order_cart')
    void flushVoiceFeedback(cart.map(i => ({ itemId: i.id, qty: i.quantity })))
    localStorage.setItem('last_order', JSON.stringify({
      orderId:        order.id,
      items:          savedLines.map(l => ({ name: l.name, quantity: l.qty, price: l.unit_price })),
      total:          Number(order.total),
      paymentMethod:  order.payment_method,
      changeGiven:    Number(order.change_given),
      cashAmount:     Number(order.cash_amount),
      transferAmount: Number(order.transfer_amount),
    }))

    setProcessing(false)
    setSuccess(true)
    navigate('/dashboard/receipt', { replace: true })
  }

  if (loading) {
    return <Spinner fullScreen />
  }

  return (
    <div className="min-h-full bg-bg-subtle pb-36">
      <div className="p-4 space-y-4">

        {/* Total hero */}
        <div className="bg-primary rounded-[18px] p-5 text-white">
          <p className="t-small text-white/60 uppercase tracking-widest mb-1">Order Total</p>
          <p className="text-[40px] font-semibold text-white leading-none">
            ₦{total.toLocaleString()}
          </p>
          <p className="t-small text-white/50 mt-2">
            {cart.length} item{cart.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Items */}
        <div className="card">
          <p className="t-h3 text-text-primary mb-3">Items</p>
          <div className="space-y-2">
            {cart.map(item => (
              <div key={item.id} className="flex justify-between items-center">
                <div>
                  <p className="t-body text-text-primary">{item.name}</p>
                  <p className="t-small text-text-muted">
                    {item.quantity} × ₦{item.price.toLocaleString()}
                  </p>
                </div>
                <p className="t-mono text-text-primary font-medium">
                  ₦{(item.price * item.quantity).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Payment method */}
        <div className="card">
          <p className="t-h3 text-text-primary mb-3">Payment Method</p>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {PAYMENT_METHODS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setPaymentMethod(key)}
                className={`flex flex-col items-center gap-1.5 py-4 rounded-[12px] t-small font-medium press min-h-0 ${
                  paymentMethod === key
                    ? 'bg-primary text-white'
                    : 'bg-bg-subtle text-text-secondary border border-border'
                }`}
              >
                <Icon size={20} />
                {label}
              </button>
            ))}
          </div>

          {paymentMethod === 'cash' && (
            <div>
              <label className="block t-label text-text-primary mb-2">
                Amount Received (₦)
              </label>
              <input
                type="number"
                value={amountReceived}
                onChange={(e) => setAmountReceived(e.target.value)}
                className="input-base"
                placeholder="0"
                inputMode="numeric"
                autoFocus
              />
              {amountReceived && (
                <div className={`mt-3 p-3 rounded-[10px] flex justify-between items-center ${
                  change >= 0 ? 'bg-success/10' : 'bg-danger/10'
                }`}>
                  <p className={`t-label ${change >= 0 ? 'text-success' : 'text-danger'}`}>
                    {change >= 0 ? 'Change' : 'Short by'}
                  </p>
                  <p className={`t-mono font-semibold ${change >= 0 ? 'text-success' : 'text-danger'}`}>
                    ₦{Math.abs(change).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          )}

          {paymentMethod === 'split' && (
            <div className="space-y-3">
              <div>
                <label className="block t-label text-text-primary mb-2">Cash Amount (₦)</label>
                <input
                  type="number"
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  className="input-base"
                  placeholder="0"
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="block t-label text-text-primary mb-2">Transfer Amount (₦)</label>
                <input
                  type="number"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="input-base"
                  placeholder="0"
                  inputMode="numeric"
                />
              </div>
              <div className={`p-3 rounded-[10px] flex justify-between items-center ${
                splitOk ? 'bg-success/10' : 'bg-bg-subtle border border-border'
              }`}>
                <p className={`t-label ${splitOk ? 'text-success' : 'text-text-muted'}`}>
                  {splitOk ? '✓ Amounts match' : 'Remaining'}
                </p>
                {!splitOk && (
                  <p className="t-mono text-text-secondary font-medium">
                    ₦{Math.abs(splitDiff).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Sticky confirm button */}
      <div className="fixed bottom-0 left-0 right-0 md:left-16 lg:left-56 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-bg-subtle via-bg-subtle to-transparent pt-8 z-20">
        <button
          onClick={handleConfirmOrder}
          disabled={processing || success}
          className="btn-primary w-full shadow-lg"
        >
          {success ? (
            <>
              <CheckCircle2 size={18} /> Order Placed!
            </>
          ) : processing ? (
            <Spinner size="sm" />
          ) : (
            'Confirm & Complete Order'
          )}
        </button>
      </div>
    </div>
  )
}
