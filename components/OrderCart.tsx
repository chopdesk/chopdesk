'use client'

import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react'

export type OrderCartItem = {
  id: string
  name: string
  price: number
  unit: string
  quantity: number
}

type OrderCartProps = {
  cart: OrderCartItem[]
  total: number
  onChangeQuantity: (id: string, delta: number) => void
  onProceed: () => void
  onClear: () => void
}

const naira = (n: number) => '\u20A6' + n.toLocaleString()

// The items, the total and the actions for the current order. Used in the phone
// bottom sheet and in the always-visible side panel on tablets and PCs.
// The parent supplies the flex column that holds it.
export default function OrderCart({ cart, total, onChangeQuantity, onProceed, onClear }: OrderCartProps) {
  const empty = cart.length === 0

  return (
    <>
      <div className="modal-scroll min-h-0 flex-1 overflow-auto p-4">
        {empty ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-light text-primary">
              <ShoppingCart size={22} />
            </span>
            <p className="t-body font-medium text-text-primary">No items yet</p>
            <p className="t-small text-text-secondary">Tap an item on the menu to add it to this order.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {cart.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="t-body font-medium text-text-primary">{item.name}</p>
                  <p className="t-small text-text-secondary">{naira(item.price)} each</p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <p className="t-body font-semibold text-text-primary">{naira(item.price * item.quantity)}</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onChangeQuantity(item.id, -1)}
                      aria-label={item.quantity === 1 ? 'Remove ' + item.name : 'One less ' + item.name}
                      className="press flex h-8 w-8 items-center justify-center rounded-full bg-bg-subtle text-text-primary"
                    >
                      {item.quantity === 1 ? <Trash2 size={14} /> : <Minus size={14} />}
                    </button>
                    <span className="t-body w-6 text-center">{item.quantity}</span>
                    <button
                      onClick={() => onChangeQuantity(item.id, 1)}
                      aria-label={'One more ' + item.name}
                      className="press flex h-8 w-8 items-center justify-center rounded-full bg-primary text-white"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-4">
        <div className="mb-4 flex items-baseline justify-between">
          <span className="t-body font-semibold text-text-primary">Total</span>
          <span className="text-xl font-bold text-primary">{naira(total)}</span>
        </div>
        <button onClick={onProceed} disabled={empty} className="btn-primary w-full">
          Proceed to Payment
        </button>
        <button
          onClick={onClear}
          disabled={empty}
          className="press press-flat mt-2 flex h-10 min-h-0 w-full items-center justify-center rounded-lg text-sm text-text-secondary disabled:opacity-40"
        >
          Clear Order
        </button>
      </div>
    </>
  )
}