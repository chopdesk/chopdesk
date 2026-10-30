'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getActiveShift, ensureJoined, type ActiveShift } from '@/lib/shift'
import { useToast } from '@/lib/toast'
import Spinner from '@/components/Spinner'
import { sortByAvailability } from '@/lib/menuSort'
import { Plus, Minus, Trash2, ShoppingCart, PackagePlus, Receipt, X, ChevronDown } from 'lucide-react'

type MenuItem = {
  id: string
  name: string
  category: string
  price: number
  unit: string
  available: boolean
}

type CartItem = {
  id: string
  name: string
  price: number
  unit: string
  quantity: number
}

type StockRow = {
  id: string
  item_id: string
  item_name: string
  quantity: number
  unit: string
}

export default function OrdersPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [cart, setCart] = useState<CartItem[]>([])
  const [stockMap, setStockMap] = useState<Record<string, number>>({})
  const [stockRows, setStockRows] = useState<StockRow[]>([])
  const [showCart, setShowCart] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  // Active shift state
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null)
  const [noShift, setNoShift] = useState(false)

  // Add stock modal state
  const [showAddStock, setShowAddStock] = useState(false)
  const [addStockItem, setAddStockItem] = useState<StockRow | null>(null)
  const [addStockQty, setAddStockQty] = useState('')
  const [addingStock, setAddingStock] = useState(false)

  // Tap-confirmation animation — briefly "pops" the tapped item
  const [justAddedId, setJustAddedId] = useState<string | null>(null)

  useEffect(() => {
    const userSession = getSession()
    if (!userSession) {
      router.replace('/auth/login')
      return
    }
    loadData()
  }, [router])

  const loadData = async () => {
    try {
      setLoading(true)
      setError(null)
      setNoShift(false)

      const userSession = getSession()

      // Menu items and the active-shift check don't depend on each other —
      // run them together instead of one after another.
      const [menuResult, shift] = await Promise.all([
        supabase
          .from('menu_items')
          .select('*')
          .eq('available', true)
          .order('category'),
        getActiveShift(),
      ])

      const { data: menu, error: menuError } = menuResult
      if (menuError) throw new Error(menuError.message)
      setMenuItems(menu || [])
      setCategories(['All', ...new Set(menu?.map(i => i.category) || [])])

      if (!shift) {
        setNoShift(true)
        setLoading(false)
        return
      }
      setActiveShift(shift)

      // Only check/record shift membership once per shift per session —
      // this page gets visited constantly while taking orders, and after
      // the first successful join there's nothing new to write.
      const joinFlagKey = `joined_shift_${shift.id}`
      if (userSession && !sessionStorage.getItem(joinFlagKey)) {
        await ensureJoined(shift.id, userSession.id)
        sessionStorage.setItem(joinFlagKey, '1')
      }

      // Get current stock for this shift
      const { data: stock, error: stockError } = await supabase
        .from('shift_stock')
        .select('*')
        .eq('shift_id', shift.id)
        .order('item_name')

      if (stockError) throw new Error(stockError.message)

      setStockRows(stock || [])
      const stockMapData: Record<string, number> = {}
      stock?.forEach(s => { stockMapData[s.item_id] = s.quantity })
      setStockMap(stockMapData)

      // Load saved cart
      const saved = localStorage.getItem('current_order_cart')
      if (saved) setCart(JSON.parse(saved))

    } catch (err: any) {
      console.error(err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const saveCart = (newCart: CartItem[]) => {
    localStorage.setItem('current_order_cart', JSON.stringify(newCart))
    setCart(newCart)
  }

  const getRemainingStock = (itemId: string) => {
    const stock = stockMap[itemId] || 0
    const inCart = cart.find(c => c.id === itemId)?.quantity || 0
    return stock - inCart
  }

  const pulseItem = (itemId: string) => {
    setJustAddedId(itemId)
    setTimeout(() => setJustAddedId(prev => (prev === itemId ? null : prev)), 180)
  }

  const addToCart = (item: MenuItem) => {
    const remaining = getRemainingStock(item.id)
    if (remaining <= 0) {
      toast(`${item.name} is out of stock`, 'warning')
      return
    }

    pulseItem(item.id)

    const existing = cart.find(c => c.id === item.id)
    if (existing) {
      saveCart(cart.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c))
    } else {
      saveCart([...cart, { id: item.id, name: item.name, price: item.price, unit: item.unit, quantity: 1 }])
    }
  }

  const updateQuantity = (itemId: string, delta: number) => {
    const item = cart.find(c => c.id === itemId)
    if (!item) return

    if (delta > 0) {
      const remaining = getRemainingStock(itemId)
      if (remaining <= 0) {
        toast('No more stock available', 'warning')
        return
      }
    }

    const newQuantity = item.quantity + delta
    if (newQuantity <= 0) {
      saveCart(cart.filter(c => c.id !== itemId))
    } else {
      saveCart(cart.map(c => c.id === itemId ? { ...c, quantity: newQuantity } : c))
    }
  }

  const handleAddStock = async () => {
    if (!addStockItem || !addStockQty || !activeShift) return
    const qty = parseInt(addStockQty)
    if (isNaN(qty) || qty <= 0) {
      toast('Enter a valid quantity', 'warning')
      return
    }

    setAddingStock(true)

    try {
      const { data: updatedStock, error: stockError } = await supabase
        .rpc('increment_stock', {
          p_stock_id: addStockItem.id,
          p_quantity: qty
        })

      if (stockError) {
        toast('Error updating stock: ' + stockError.message, 'error')
        setAddingStock(false)
        return
      }

      if (!updatedStock || updatedStock.length === 0) {
        toast('Failed to update stock. Please try again.', 'error')
        setAddingStock(false)
        return
      }

      const { data: stock, error: refreshError } = await supabase
        .from('shift_stock')
        .select('*')
        .eq('shift_id', activeShift.id)
        .order('item_name')

      if (refreshError) {
        toast('Stock updated but failed to refresh display', 'warning')
        setAddingStock(false)
        setShowAddStock(false)
        setAddStockItem(null)
        setAddStockQty('')
        return
      }

      if (stock) {
        setStockRows(stock)
        const stockMapData: Record<string, number> = {}
        stock.forEach(s => { stockMapData[s.item_id] = s.quantity })
        setStockMap(stockMapData)
      }

      toast(`${qty} ${addStockItem.unit}(s) added to ${addStockItem.item_name}`, 'success')
      setShowAddStock(false)
      setAddStockItem(null)
      setAddStockQty('')

    } catch (err) {
      console.error('Stock increment failed:', err)
      toast('Failed to update stock. Please try again.', 'error')
    } finally {
      setAddingStock(false)
    }
  }

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0)
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0)
  const categoryItems = selectedCategory === 'All'
    ? menuItems
    : menuItems.filter(i => i.category === selectedCategory)
  const filteredItems = sortByAvailability(categoryItems, stockMap)

  useEffect(() => {
    const handleClickOutside = () => {
      setIsDropdownOpen(false)
    }
    if (isDropdownOpen) {
      document.addEventListener('click', handleClickOutside)
    }
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [isDropdownOpen])

  if (loading) {
    return <Spinner fullScreen />
  }

  // No shift is currently open
  if (noShift) {
    return (
      <div className="min-h-screen bg-bg-subtle flex items-center justify-center p-4">
        <div className="bg-white rounded-lg p-6 text-center max-w-sm">
          <div className="text-4xl mb-4">🕐</div>
          <h2 className="text-lg font-semibold mb-2">No shift is open</h2>
          <p className="text-gray-500 mb-4">
            Someone needs to start a shift before orders can be taken.
          </p>
          <button
            onClick={() => router.push('/dashboard/shift')}
            className="bg-primary text-white px-6 py-2 rounded-lg w-full"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg-subtle flex items-center justify-center p-4">
        <div className="bg-white rounded-lg p-6 text-center max-w-sm">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h2 className="text-lg font-semibold mb-2">Unable to load orders</h2>
          <p className="text-gray-500 mb-4">{error}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="bg-primary text-white px-6 py-2 rounded-lg w-full"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-subtle pb-32">
      {/* Header with Add Stock Button */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="px-4 py-3 flex justify-between items-center gap-2">
          <span className="text-sm font-medium text-primary flex-shrink-0">Take an Order</span>
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => router.push('/dashboard/expenses')}
              className="flex items-center gap-1.5 bg-primary/10 text-primary px-3 py-1.5 rounded-full text-sm font-medium flex-shrink-0"
            >
              <Receipt size={16} />
              Expense
            </button>
            <button
              onClick={() => setShowAddStock(true)}
              className="flex items-center gap-1.5 bg-primary/10 text-primary px-3 py-1.5 rounded-full text-sm font-medium flex-shrink-0"
            >
              <PackagePlus size={16} />
              Add Stock
            </button>
          </div>
        </div>

        {/* Category Dropdown Filter */}
        <div className="px-4 pb-3">
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsDropdownOpen(!isDropdownOpen)
              }}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <span className="font-medium">
                {selectedCategory === 'All' ? 'All Categories' : selectedCategory}
              </span>
              <ChevronDown size={18} className={`transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isDropdownOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-60 overflow-y-auto animate-[fadeIn_0.15s_ease-out]">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => {
                      setSelectedCategory(cat)
                      setIsDropdownOpen(false)
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors first:rounded-t-xl last:rounded-b-xl ${
                      selectedCategory === cat
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {cat === 'All' ? 'All Categories' : cat}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Menu Grid */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {filteredItems.map(item => {
          const remaining = getRemainingStock(item.id)
          const outOfStock = remaining <= 0
          const inCart = cart.find(c => c.id === item.id)
          const justAdded = justAddedId === item.id

          return (
            <button
              key={item.id}
              onClick={() => addToCart(item)}
              disabled={outOfStock}
              className={`bg-white rounded-xl p-4 text-left shadow-sm border transition-all duration-150 active:scale-95 menu-item ${
                justAdded ? 'scale-105 border-primary shadow-md' : ''
              } ${
                outOfStock ? 'opacity-50 cursor-not-allowed' : inCart ? 'border-primary shadow-md' : 'border-gray-200'
              }`}
            >
              {inCart && (
                <span className="float-right bg-primary text-white w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center">
                  {inCart.quantity}
                </span>
              )}
              <h3 className="font-medium text-sm sm:text-base">{item.name}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{item.unit}</p>
              <p className="text-primary font-semibold mt-2 text-sm sm:text-base">₦{item.price.toLocaleString()}</p>
              {!outOfStock && remaining < 10 && (
                <p className="text-xs text-orange-500 mt-1">{remaining} left</p>
              )}
            </button>
          )
        })}
      </div>

      {/* Cart Bar — always mounted, slides up/down instead of popping in */}
      <div
        className={`fixed bottom-[68px] left-0 right-0 p-4 bg-white border-t shadow-lg z-30 transition-transform duration-200 ease-out ${
          cartCount > 0 ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
      >
        <button
          onClick={() => setShowCart(true)}
          className="w-full bg-primary text-white py-4 rounded-xl flex justify-between items-center px-4 active:scale-98 transition-transform"
        >
          <span className="flex items-center gap-2">
            <ShoppingCart size={20} />
            <span className="font-medium">{cartCount} item(s)</span>
          </span>
          <span className="text-xl font-bold">₦{cartTotal.toLocaleString()}</span>
        </button>
      </div>

      {/* Cart Modal */}
      {showCart && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end">
          <div className="bg-white w-full rounded-t-2xl max-h-[80vh] flex flex-col modal-content">
            <div className="p-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">Your Order</h2>
              <button onClick={() => setShowCart(false)} className="text-gray-500">
                <X size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-3 modal-scroll">
              {cart.map(item => (
                <div key={item.id} className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-gray-500">₦{item.price.toLocaleString()} each</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => updateQuantity(item.id, -1)}
                      className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center active:scale-95"
                    >
                      {item.quantity === 1 ? <Trash2 size={14} /> : <Minus size={14} />}
                    </button>
                    <span className="w-8 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.id, 1)}
                      className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center active:scale-95"
                    >
                      <Plus size={14} />
                    </button>
                    <p className="w-20 text-right font-medium">₦{(item.price * item.quantity).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t">
              <div className="flex justify-between mb-4">
                <span className="font-semibold">Total</span>
                <span className="text-xl font-bold text-primary">₦{cartTotal.toLocaleString()}</span>
              </div>
              <button
                onClick={() => {
                  setShowCart(false)
                  router.push('/dashboard/payment')
                }}
                className="w-full bg-primary text-white py-3 rounded-xl font-medium active:scale-98 transition-transform"
              >
                Proceed to Payment
              </button>
              <button
                onClick={() => { saveCart([]); setShowCart(false) }}
                className="w-full text-gray-500 text-sm py-2 mt-2"
              >
                Clear Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Stock Modal */}
      {showAddStock && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40">
          <div className="bg-white w-full rounded-t-[24px] max-h-[85vh] flex flex-col modal-content">
            <div className="px-5 pt-4 pb-3 border-b border-border flex-shrink-0">
              <div className="w-10 h-1 rounded-full bg-border mx-auto mb-4" />
              <div className="flex justify-between items-center">
                <div>
                  <p className="t-h2 text-text-primary">Top Up Stock</p>
                  <p className="t-small text-text-secondary mt-0.5">
                    Add more units to any item
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowAddStock(false)
                    setAddStockItem(null)
                    setAddStockQty('')
                  }}
                  className="text-text-muted min-h-0 min-w-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-bg-subtle"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {!addStockItem ? (
              <div className="overflow-y-auto flex-1 px-5 py-3 divide-y divide-border modal-scroll">
                {stockRows.length === 0 ? (
                  <p className="t-body text-text-muted text-center py-10">
                    No stock data available
                  </p>
                ) : (
                  stockRows.map(row => (
                    <button
                      key={row.id}
                      onClick={() => setAddStockItem(row)}
                      className="w-full flex justify-between items-center py-3.5 min-h-0 text-left list-item"
                    >
                      <div>
                        <p className="t-body text-text-primary font-medium">{row.item_name}</p>
                        <p className="t-small text-text-muted">{row.unit}</p>
                      </div>
                      <p className={`t-mono font-semibold ${
                        row.quantity <= 0 ? 'text-danger' : 'text-text-primary'
                      }`}>
                        {row.quantity} remaining
                      </p>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <div className="px-5 py-6 space-y-5 flex-1">
                <div className="bg-primary/5 border border-primary/20 rounded-[14px] p-4">
                  <p className="t-h3 text-primary">{addStockItem.item_name}</p>
                  <p className="t-small text-text-muted mt-1">Currently remaining</p>
                  <p className="t-mono font-semibold text-text-primary">
                    {addStockItem.quantity} {addStockItem.unit}(s)
                  </p>
                </div>

                <div>
                  <label className="block t-label text-text-primary mb-2">
                    How many to add?
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={addStockQty}
                    onChange={(e) => setAddStockQty(e.target.value)}
                    className="input-base text-center text-2xl font-semibold"
                    placeholder="0"
                    autoFocus
                  />
                  {addStockQty && parseInt(addStockQty) > 0 && (
                    <p className="t-small text-text-secondary mt-2 text-center">
                      New total will be{' '}
                      <span className="font-semibold text-primary">
                        {addStockItem.quantity + parseInt(addStockQty)} {addStockItem.unit}(s)
                      </span>
                    </p>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setAddStockItem(null)}
                    className="btn-secondary flex-1"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleAddStock}
                    disabled={addingStock || !addStockQty || parseInt(addStockQty) <= 0}
                    className="btn-primary flex-1"
                  >
                    {addingStock ? 'Adding...' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}