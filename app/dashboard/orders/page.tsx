'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getActiveShift, ensureJoined, type ActiveShift } from '@/lib/shift'
import { useToast } from '@/lib/toast'
import NoShiftState from '@/components/NoShiftState'
import Spinner from '@/components/Spinner'
import OrderCart from '@/components/OrderCart'
import { sortByAvailability } from '@/lib/menuSort'
import { ShoppingCart, PackagePlus, Receipt, X, ChevronDown } from 'lucide-react'

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

    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const userSession = getSession()
    if (!userSession) {
      router.replace('/auth/login')
      return
    }
    loadData()
  }, [router])

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
      toast(`${item.name} is out of stock. Add stock to keep selling.`, 'warning')
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
        toast(`${item.name}: no more in stock. All ${item.quantity} are already in the cart.`, 'warning')
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
      toast('Enter how many to add, for example 5.', 'warning')
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
        console.error(stockError)
        toast("Couldn't add stock. Check your connection and try again.", 'error', { label: 'Retry', onClick: handleAddStock })
        setAddingStock(false)
        return
      }

      if (!updatedStock || updatedStock.length === 0) {
        toast("Couldn't add stock. Try again.", 'error')
        setAddingStock(false)
        return
      }

      const { data: stock, error: refreshError } = await supabase
        .from('shift_stock')
        .select('*')
        .eq('shift_id', activeShift.id)
        .order('item_name')

      if (refreshError) {
        toast("Stock was added, but the list didn't refresh. Reload the page to see it.", 'warning')
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

      toast(`Added ${qty} to ${addStockItem.item_name}.`, 'success')
      setShowAddStock(false)
      setAddStockItem(null)
      setAddStockQty('')

    } catch (err) {
      console.error('Stock increment failed:', err)
      toast("Couldn't add stock. Try again.", 'error')
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
    return <NoShiftState message="Someone needs to start a shift before orders can be taken." />
  }

  if (error) {
    return (
      <div className="min-h-full bg-bg-subtle flex items-center justify-center p-4">
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
    <div className="bg-bg-subtle pb-32 lg:flex lg:h-[calc(100dvh-3.5rem)] lg:pb-0">
      <div className="min-w-0 flex-1 lg:overflow-y-auto">
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
      <div className="p-4 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
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
              className={`press bg-white rounded-xl p-4 text-left shadow-sm border ${
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

      </div>

      {/* Cart panel: always visible beside the menu on tablets (landscape) and PCs */}
      <aside className="hidden w-[22rem] shrink-0 flex-col border-l border-border bg-white lg:flex xl:w-[24rem]">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="t-h3 text-text-primary">Current order</h2>
          {cartCount > 0 && (
            <span className="t-small rounded-full bg-primary-light px-2.5 py-1 font-medium text-primary">
              {cartCount} item{cartCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <OrderCart
          cart={cart}
          total={cartTotal}
          onChangeQuantity={updateQuantity}
          onProceed={() => router.push('/dashboard/payment')}
          onClear={() => saveCart([])}
        />
      </aside>

      {/* Cart Bar — always mounted, slides up/down instead of popping in */}
      <div
        className={`fixed bottom-[var(--bottom-nav-h)] left-0 right-0 md:bottom-0 md:left-16 lg:left-56 p-4 bg-white border-t shadow-lg z-[5] lg:hidden transition-transform duration-200 ease-out ${
          cartCount > 0 ? 'translate-y-0' : 'translate-y-full pointer-events-none'
        }`}
      >
        <button
          onClick={() => setShowCart(true)}
          className="press w-full bg-primary text-white py-4 rounded-xl flex justify-between items-center px-4"
        >
          <span className="flex items-center gap-2">
            <ShoppingCart size={20} />
            <span className="font-medium">{cartCount} item(s)</span>
          </span>
          <span className="text-xl font-bold">₦{cartTotal.toLocaleString()}</span>
        </button>
      </div>

      {/* Cart Modal: bottom sheet on phones, centered dialog on larger screens. Hidden at 1024px and up, where the cart panel is always visible. */}
      {showCart && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center md:justify-center lg:hidden">
          <div className="bg-white w-full rounded-t-2xl max-h-[80vh] flex flex-col modal-content md:max-w-md md:rounded-2xl">
            <div className="p-4 border-b flex justify-between items-center">
              <h2 className="text-lg font-semibold">Your Order</h2>
              <button
                onClick={() => setShowCart(false)}
                aria-label="Close"
                className="press flex h-9 w-9 min-h-0 min-w-0 items-center justify-center rounded-full text-text-muted"
              >
                <X size={24} />
              </button>
            </div>
            <OrderCart
              cart={cart}
              total={cartTotal}
              onChangeQuantity={updateQuantity}
              onProceed={() => {
                setShowCart(false)
                router.push('/dashboard/payment')
              }}
              onClear={() => {
                saveCart([])
                setShowCart(false)
              }}
            />
          </div>
        </div>
      )}

      {/* Add Stock Modal */}
      {showAddStock && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 md:items-center md:justify-center">
          <div className="bg-white w-full rounded-t-[24px] max-h-[85vh] flex flex-col modal-content md:max-w-md md:rounded-[24px]">
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
                  className="press text-text-muted min-h-0 min-w-0 w-9 h-9 flex items-center justify-center rounded-full"
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
                      className="w-full flex justify-between items-center py-3.5 min-h-0 text-left press press-flat"
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