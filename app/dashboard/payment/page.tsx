'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getActiveShift, type ActiveShift } from '@/lib/shift'
import { useAlert, useToast } from '@/lib/toast'
import Spinner from '@/components/Spinner'
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
  const [session, setSession] = useState<any>(null)
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer' | 'split'>('cash')
  const [cashAmount, setCashAmount] = useState('')
  const [transferAmount, setTransferAmount] = useState('')
  const [amountReceived, setAmountReceived] = useState('')

  // `replace: true` is used for every guard bounce and for the final
  // handoff to the receipt — none of those should leave this page sitting
  // in browser history. Payment is a mid-flow step: you should never be
  // able to hit "back" into it once you've moved past it, whether that's
  // because the order succeeded or because a guard kicked you out.
  const navigate = useCallback((path: string, opts?: { replace?: boolean }) => {
    if (isRouterReady) {
      opts?.replace ? router.replace(path) : router.push(path)
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
      } catch (err: any) {
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

    // Single fetch of current stock for every cart item — used both to
    // validate sufficiency up front and, further down, to know which
    // rows to decrement. No second query for the same data.
    const { data: stockRows, error: stockFetchError } = await supabase
      .from('shift_stock')
      .select('id, item_id, quantity')
      .eq('shift_id', activeShift.id)
      .in('item_id', cart.map(i => i.id))

    if (stockFetchError || !stockRows) {
      toast("Couldn't check stock. Check your connection and try again.", 'error', { label: 'Retry', onClick: handleConfirmOrder })
      setProcessing(false)
      return
    }

    const insufficient = cart.filter(item => {
      const stockRow = stockRows.find(s => s.item_id === item.id)
      return !stockRow || stockRow.quantity < item.quantity
    })

    if (insufficient.length > 0) {
      const lines = insufficient.map(item => {
        const available = stockRows.find(s => s.item_id === item.id)?.quantity ?? 0
        return available === 0 ? `${item.name} is out of stock` : `${item.name}: only ${available} left`
      })
      showAlert({ title: 'Not enough stock', message: `${lines.join('. ')}. Adjust the order and try again.`, tone: 'warning', actionLabel: 'OK' })
      setProcessing(false)
      return
    }

    let cashAmt     = 0
    let transferAmt = 0
    let changeGiven = 0

    if (paymentMethod === 'cash') {
      cashAmt     = total
      changeGiven = parseFloat(amountReceived) - total
    } else if (paymentMethod === 'transfer') {
      transferAmt = total
    } else {
      cashAmt     = parseFloat(cashAmount)     || 0
      transferAmt = parseFloat(transferAmount) || 0
    }

    const itemsJson = cart.map(i => ({
      item_id:    i.id,
      name:       i.name,
      qty:        i.quantity,
      unit_price: i.price,
      subtotal:   i.price * i.quantity,
    }))

    // Insert the order, tagged to the active shift
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert({
        org_id:          session.org_id,
        shift_id:        activeShift.id,
        staff_id:        session.id,
        items_json:      itemsJson,
        subtotal:        total,
        total,
        payment_method:  paymentMethod,
        cash_amount:     cashAmt,
        transfer_amount: transferAmt,
        change_given:    changeGiven,
      })
      .select()
      .single()

    if (orderError) {
      console.error(orderError)
      showAlert({ title: "Order wasn't saved", message: 'This order was not recorded and stock was not changed. Check your connection and try again.', actionLabel: 'OK' })
      setProcessing(false)
      return
    }

    // Decrement every item concurrently — each one updates a different
    // row, so there's no reason to wait for one before starting the next.
    // Uses the stockRows already fetched above.
    const results = await Promise.all(
      cart.map(async (item) => {
        const stockRow = stockRows.find(s => s.item_id === item.id)
        if (!stockRow) {
          return { item, ok: false, reason: 'Stock record not found' }
        }

        const { data: updatedStock, error: stockError } = await supabase
          .rpc('decrement_stock', {
            p_stock_id: stockRow.id,
            p_quantity: item.quantity
          })

        if (stockError) {
          console.error('Stock decrement error:', stockError)
          return { item, ok: false, reason: stockError.message }
        }
        if (!updatedStock || updatedStock.length === 0) {
          return { item, ok: false, reason: `Insufficient stock (only ${stockRow.quantity} left)` }
        }
        return { item, ok: true, reason: '' }
      })
    )

    const failures = results.filter(r => !r.ok)
    // The order row exists now, so the receipt always opens. Staying on this
    // page would let a second tap save the same order twice.
    localStorage.removeItem('current_order_cart')
    localStorage.setItem('last_order', JSON.stringify({
      orderId:        orderData.id,
      items:          cart,
      total,
      paymentMethod,
      changeGiven,
      cashAmount:     cashAmt,
      transferAmount: transferAmt,
    }))

    setProcessing(false)
    setSuccess(true)
    navigate('/dashboard/receipt', { replace: true })

    if (failures.length > 0) {
      showAlert({ title: "Order saved, but stock wasn't updated", message: `The receipt is ready. Ask the owner to check stock for: ${failures.map(f => f.item.name).join(', ')}.`, tone: 'warning', actionLabel: 'OK' })
    }
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
      <div className="fixed bottom-0 left-0 right-0 md:left-56 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-bg-subtle via-bg-subtle to-transparent pt-8 z-20">
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