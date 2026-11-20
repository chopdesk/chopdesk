// lib/shiftReport.ts
// One place that builds the shift report text. The close page and the
// shift history page both call this, so they can never disagree.

export type StockLine = {
  item_id: string
  item_name: string
  unit: string
  opening_qty: number
  added_qty: number
  quantity: number
}

export type ExpenseLine = { description: string; amount: number }

export type Discrepancy = {
  item_name: string
  expected: number
  counted: number
  variance: number
}

export type ShiftReportInput = {
  orgName: string
  openedAt: string
  closedAt: string
  staffNames: string[]
  stock: StockLine[]
  prices: Record<string, number>
  orderCount: number
  revenueCash: number
  revenueTransfer: number
  revenueTotal: number
  expenses: ExpenseLine[]
  discrepancies: Discrepancy[]
}

// An item belongs to a shift only if stock was logged at opening or added later.
// Menu items that were never touched in the shift stay out of the report.
export const wasInvolved = (r: Pick<StockLine, 'opening_qty' | 'added_qty'>) =>
  r.opening_qty > 0 || r.added_qty > 0

export const soldOf = (r: Pick<StockLine, 'opening_qty' | 'added_qty' | 'quantity'>) =>
  r.opening_qty + r.added_qty - r.quantity

const n = (v: number) => v.toLocaleString()

export function buildShiftReport(i: ShiftReportInput): string {
  const opened = new Date(i.openedAt)
  const closed = new Date(i.closedAt)

  const dateStr = opened.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const openStr = opened.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const closeStr = closed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  const ms = closed.getTime() - opened.getTime()
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)

  const items = i.stock.filter(wasInvolved)

  const soldQtyLines = items.map(r => `${r.item_name}: ${soldOf(r)} ${r.unit}`).join('\n') || 'None'
  const totalSold = items.reduce((s, r) => s + soldOf(r), 0)
  const soldAmountLines = items
    .map(r => `${r.item_name} - ${n(soldOf(r) * (i.prices[r.item_id] || 0))}`)
    .join('\n') || 'None'

  const expenseTotal = i.expenses.reduce((s, e) => s + e.amount, 0)
  const expenseLines = i.expenses.length > 0
    ? i.expenses.map(e => `${e.description} - ${n(e.amount)}`).join('\n')
    : 'None'

  const discrepancyLines = i.discrepancies.length > 0
    ? i.discrepancies
        .map(d => `${d.item_name}: ${d.variance > 0 ? '+' : ''}${d.variance} (expected ${d.expected}, counted ${d.counted})`)
        .join('\n')
    : 'No discrepancies'

  return `*${i.orgName} — Shift Report*
${dateStr}
${openStr} – ${closeStr} (${h}h ${m}m)
Staff: ${i.staffNames.join(', ')}

*Sold (Qty)*
${soldQtyLines}
${totalSold} items · ${i.orderCount} orders

*Sold (₦)*
${soldAmountLines}

*Revenue*
Cash: ${n(i.revenueCash)}
Transfer: ${n(i.revenueTransfer)}
Total: ${n(i.revenueTotal)}

*Expenses (from cash)*
${expenseLines}
Total: ${n(expenseTotal)}

Cash after expenses: ${n(i.revenueCash - expenseTotal)}

*Stock Discrepancies*
${discrepancyLines}

*Net:* ${n(i.revenueTotal - expenseTotal)}`
}
