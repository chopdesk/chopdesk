import { CheckCircle2, Circle } from 'lucide-react'

const naira = '\u20A6'
const shell = 'w-full rounded-2xl bg-white text-text-primary shadow-2xl shadow-black/25 p-5'

export function StockCard({ className = '' }: { className?: string }) {
  const rows = [
    { name: 'Jollof rice', left: 12, pct: 60, low: false },
    { name: 'Fried rice', left: 5, pct: 25, low: true },
    { name: 'Grilled chicken', left: 18, pct: 90, low: false },
  ]
  return (
    <div className={`${shell} ${className}`}>
      <div className="flex items-center justify-between">
        <span className="t-small text-text-muted uppercase tracking-wider">Live stock</span>
        <span className="t-small font-semibold text-primary bg-primary-light rounded-full px-2.5 py-1">
          Updated just now
        </span>
      </div>
      <ul className="mt-4 space-y-4">
        {rows.map((row) => (
          <li key={row.name}>
            <div className="flex items-center justify-between t-body">
              <span>{row.name}</span>
              <span className={row.low ? 'font-semibold text-warning' : 'text-text-secondary'}>
                {row.left} left{row.low ? ' \u00B7 Low' : ''}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
              <div
                className={`h-full rounded-full ${row.low ? 'bg-warning' : 'bg-success'}`}
                style={{ width: `${row.pct}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ChecklistCard({ className = '' }: { className?: string }) {
  const items = [
    { label: 'Create your account', done: true },
    { label: 'Name your business', done: true },
    { label: 'Add your menu', done: false },
    { label: 'Invite your team', done: false },
  ]
  return (
    <div className={`${shell} ${className}`}>
      <div className="flex items-center justify-between">
        <span className="t-small text-text-muted uppercase tracking-wider">Getting started</span>
        <span className="t-small font-semibold text-primary bg-primary-light rounded-full px-2.5 py-1">
          2 of 4
        </span>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-border">
        <div className="h-full w-1/2 rounded-full bg-primary" />
      </div>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-3 t-body">
            {item.done ? (
              <CheckCircle2 size={20} className="shrink-0 text-success" />
            ) : (
              <Circle size={20} className="shrink-0 text-text-muted" />
            )}
            <span className={item.done ? 'text-text-secondary' : 'font-medium'}>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ReceiptCard({ className = '' }: { className?: string }) {
  return (
    <div className={`${shell} ${className}`}>
      <div className="flex items-center justify-between">
        <span className="t-small text-text-muted uppercase tracking-wider">Your first sale</span>
        <span className="t-small font-semibold text-success bg-success/10 rounded-full px-2.5 py-1">
          Paid
        </span>
      </div>
      <p className="mt-3 text-xl font-bold tracking-tight">Order #001</p>
      <ul className="mt-3 space-y-2 t-body">
        <li className="flex items-center justify-between">
          <span>
            Jollof rice <span className="text-text-muted">{'\u00D7'} 2</span>
          </span>
          <span className="font-semibold">{naira}4,000</span>
        </li>
        <li className="flex items-center justify-between">
          <span>
            Fried plantain <span className="text-text-muted">{'\u00D7'} 1</span>
          </span>
          <span className="font-semibold">{naira}500</span>
        </li>
      </ul>
      <div className="mt-3 border-t border-dashed border-border pt-3 space-y-1.5">
        <div className="flex items-center justify-between font-bold">
          <span>Total</span>
          <span>{naira}4,500</span>
        </div>
        <div className="flex items-center justify-between t-small text-text-secondary">
          <span>Cash paid</span>
          <span>{naira}5,000</span>
        </div>
        <div className="flex items-center justify-between t-small text-text-secondary">
          <span>Change</span>
          <span>{naira}500</span>
        </div>
      </div>
    </div>
  )
}
