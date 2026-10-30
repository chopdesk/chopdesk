'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle } from 'lucide-react'
import Spinner from '@/components/Spinner'

export default function ReceiptPage() {
  const router = useRouter()
  const [order, setOrder] = useState<any>(null)
  const [iconVisible, setIconVisible] = useState(false)

  useEffect(() => {
    const lastOrder = localStorage.getItem('last_order')
    if (lastOrder) {
      setOrder(JSON.parse(lastOrder))
    } else {
      router.replace('/dashboard')
    }
  }, [router])

  useEffect(() => {
    if (!order) return
    // Trigger on the next frame so the scale-in transition actually plays
    // instead of the icon just appearing at full size immediately.
    const id = requestAnimationFrame(() => setIconVisible(true))
    return () => cancelAnimationFrame(id)
  }, [order])

  if (!order) {
    return <Spinner fullScreen />
  }

  return (
    <div className="min-h-screen bg-bg-subtle flex items-center justify-center p-4">
      <div className="card max-w-sm w-full">

        {/* Success icon */}
        <div className="text-center mb-5">
          <div
            className={`w-16 h-16 rounded-full bg-[#2E7D32]/10 flex items-center justify-center mx-auto mb-3 transition-transform duration-300 ease-out ${
              iconVisible ? 'scale-100' : 'scale-0'
            }`}
          >
            <CheckCircle size={36} className="text-[#2E7D32]" />
          </div>
          <h1 className="t-h1 text-text-primary">Order Confirmed</h1>
          <p className="t-small text-text-muted mt-1">#{order.orderId.slice(-8)}</p>
        </div>

        {/* Items */}
        <div className="border-t border-border pt-4 mb-4 space-y-2">
          {order.items.map((item: any, idx: number) => (
            <div key={idx} className="flex justify-between">
              <p className="t-body text-text-secondary">{item.quantity}× {item.name}</p>
              <p className="t-mono text-text-primary">₦{(item.price * item.quantity).toLocaleString()}</p>
            </div>
          ))}
          <div className="border-t border-border pt-3 flex justify-between">
            <p className="t-h3 text-text-primary">Total</p>
            <p className="t-h2 text-primary">₦{order.total.toLocaleString()}</p>
          </div>
        </div>

        {/* Payment summary */}
        <div className="bg-bg-subtle rounded-[10px] p-3 mb-5 space-y-1.5">
          <div className="flex justify-between">
            <p className="t-small text-text-muted">Payment method</p>
            <p className="t-label text-text-primary capitalize">{order.paymentMethod}</p>
          </div>
          {order.cashAmount > 0 && (
            <div className="flex justify-between">
              <p className="t-small text-text-muted">Cash</p>
              <p className="t-mono text-text-primary">₦{order.cashAmount.toLocaleString()}</p>
            </div>
          )}
          {order.transferAmount > 0 && (
            <div className="flex justify-between">
              <p className="t-small text-text-muted">Transfer</p>
              <p className="t-mono text-text-primary">₦{order.transferAmount.toLocaleString()}</p>
            </div>
          )}
          {order.changeGiven > 0 && (
            <div className="flex justify-between">
              <p className="t-small text-text-muted">Change</p>
              <p className="t-mono text-[#2E7D32] font-medium">₦{order.changeGiven.toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* replace, not push — once you leave this receipt for a new
            order, you should never be able to "back" into it */}
        <button onClick={() => router.replace('/dashboard/orders')} className="btn-primary w-full">
          New Order
        </button>

      </div>
    </div>
  )
}