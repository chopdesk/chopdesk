// components/brand/ReportCard.tsx
import { CheckCircle2 } from 'lucide-react'

// Illustrative sample shown in the mock report card
const sample = {
  total: '₦148,500',
  items: [
    { name: 'Jollof rice', qty: 32, amount: '₦64,000' },
    { name: 'Fried rice', qty: 21, amount: '₦46,500' },
    { name: 'Grilled chicken', qty: 14, amount: '₦38,000' },
  ],
}

export default function ReportCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`w-full max-w-sm rounded-2xl bg-white text-text-primary shadow-2xl shadow-black/25 p-5 ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="t-small text-text-muted uppercase tracking-wider">Shift summary</span>
        <span className="t-small font-semibold text-success bg-success/10 rounded-full px-2.5 py-1">
          Closed
        </span>
      </div>

      <p className="mt-3 text-3xl font-bold tracking-tight">{sample.total}</p>
      <p className="t-small text-text-secondary">Total sold this shift</p>

      <ul className="mt-4 space-y-2.5 border-t border-border pt-4">
        {sample.items.map((item) => (
          <li key={item.name} className="flex items-center justify-between t-body">
            <span>
              {item.name} <span className="text-text-muted">× {item.qty}</span>
            </span>
            <span className="font-semibold">{item.amount}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-2 rounded-xl bg-success/10 px-3 py-2.5">
        <CheckCircle2 size={18} className="text-success shrink-0" />
        <span className="t-small font-medium text-success">Stock check: every item matches</span>
      </div>
    </div>
  )
}
