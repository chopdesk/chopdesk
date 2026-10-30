'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, ShoppingBag, Package, Clock,
  Utensils, Receipt, History,
  LogOut, Menu, X
} from 'lucide-react'
import { clearSession } from '@/lib/auth'
import { getActiveShift } from '@/lib/shift'
import ConnectionStatus from '@/components/ConnectionStatus'
import UpdateBanner, { UpdateButton } from '@/components/UpdateManager'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  const bottomNav = [
    { name: 'Home',   icon: LayoutDashboard, path: '/dashboard' },
    { name: 'Orders', icon: ShoppingBag,     path: '/dashboard/orders' },
    { name: 'Stock',  icon: Package,         path: '/dashboard/stock' },
    { name: 'Shift',  icon: Clock,           path: '/dashboard/shift' },
  ]

  // Expenses lives inside the order-taking page (next to Add Stock) since
  // it's something you log during an active shift, not a settings-style
  // page — the drawer is for standing config/history, not shift actions.
  const drawerItems = [
    { name: 'Menu Items',    icon: Utensils, path: '/dashboard/menu' },
    { name: 'Order History', icon: Receipt,  path: '/dashboard/order-history' },
    { name: 'Shift History', icon: History,  path: '/dashboard/shifts' },
  ]

  const allItems = [...bottomNav, ...drawerItems]

  // Pages reachable from inside a flow rather than from nav — still need
  // a real title in the top bar instead of falling back to the brand name.
  const extraTitles: Record<string, string> = {
    '/dashboard/expenses':    'Expenses',
    '/dashboard/shift/close': 'Close Shift',
    '/dashboard/payment':     'Payment',
    '/dashboard/receipt':     'Receipt',
  }

  const getPageTitle = () => {
    if (pathname === '/dashboard') return null
    const item = allItems.find(i => i.path === pathname)
    return item?.name || extraTitles[pathname || ''] || 'Uptimyzas Kitchen'
  }

  const pageTitle = getPageTitle()

  const isShiftPath = (path: string) =>
    path === '/dashboard/shift' || path === '/dashboard/shift/close'

  const navigate = (path: string) => {
    setMenuOpen(false)
    router.push(path)
  }

  // The Shift tab routes smartly: straight to Close Shift if one's already
  // open, otherwise to Start Shift — same check the dashboard button uses,
  // just run on tap instead of on every page load.
  const handleShiftNav = async () => {
    setMenuOpen(false)
    try {
      const shift = await getActiveShift()
      router.push(shift ? '/dashboard/shift/close' : '/dashboard/shift')
    } catch (err) {
      console.error(err)
      router.push('/dashboard/shift')
    }
  }

  const handleLogout = () => {
    clearSession()
    router.replace('/auth/login')
  }

  return (
    <div className="h-screen flex flex-col bg-bg-subtle overflow-hidden">
      {/* Top bar */}
      <div className="top-bar fixed top-0 left-0 right-0 z-20 bg-white flex-shrink-0">
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"><ConnectionStatus variant="dot" /></div>
        {pageTitle ? (
          <>
            <button
              onClick={() => router.back()}
              className="flex items-center justify-center w-9 h-9 min-h-0 min-w-0 rounded-full hover:bg-bg-subtle transition-colors text-text-secondary"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <p className="t-h3 text-text-primary">{pageTitle}</p>
            <div className="w-9" />
          </>
        ) : (
          <h1 className="t-brand text-primary">Uptimyzas Kitchen</h1>
        )}
      </div>

      {/* Connection banner */}
      <div className="fixed top-14 left-0 right-0 z-30 pointer-events-none">
        <ConnectionStatus />
      </div>

      {/* Update available card */}
      <UpdateBanner />

      {/* Desktop layout */}
      <div className="hidden md:flex flex-1 pt-14 overflow-hidden">
        <aside className="w-56 bg-white border-r border-border flex-shrink-0 overflow-y-auto">
          <div className="flex flex-col h-full">
            <div className="flex-1 px-3 py-4 space-y-0.5">
              {allItems.map(({ name, icon: Icon, path }) => {
                const isActive = isShiftPath(path) ? isShiftPath(pathname || '') : pathname === path
                return (
                  <button
                    key={path}
                    onClick={() => path === '/dashboard/shift' ? handleShiftNav() : navigate(path)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[10px] transition-colors min-h-0 ${
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary'
                    }`}
                  >
                    <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                    <span className="t-body font-medium">{name}</span>
                  </button>
                )
              })}
            </div>
            <div className="px-3 pb-6 border-t border-border pt-3">
              <div className="mb-2"><UpdateButton /></div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-danger hover:bg-danger/5 transition-colors min-h-0"
              >
                <LogOut size={18} />
                <span className="t-body font-medium">Sign Out</span>
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Mobile content */}
      <div className="md:hidden flex-1 pt-14 pb-20 overflow-y-auto">
        {children}
      </div>

      {/* Mobile bottom nav */}
      <div className="md:hidden bottom-nav fixed bottom-0 left-0 right-0 z-20 bg-white">
        {bottomNav.map(({ name, icon: Icon, path }) => {
          const isActive = isShiftPath(path) ? isShiftPath(pathname || '') : pathname === path
          return (
            <button
              key={path}
              onClick={() => path === '/dashboard/shift' ? handleShiftNav() : navigate(path)}
              className={`flex flex-col items-center gap-1 min-h-0 min-w-0 flex-1 pb-1 pt-2 relative transition-colors ${
                isActive ? 'text-primary' : 'text-text-muted'
              }`}
            >
              {isActive && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-full bg-primary" />
              )}
              <Icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium">{name}</span>
            </button>
          )
        })}

        <button
          onClick={() => setMenuOpen(true)}
          className={`flex flex-col items-center gap-1 min-h-0 min-w-0 flex-1 pb-1 pt-2 relative transition-colors ${
            drawerItems.some(i => i.path === pathname) ? 'text-primary' : 'text-text-muted'
          }`}
        >
          {drawerItems.some(i => i.path === pathname) && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-[3px] rounded-full bg-primary" />
          )}
          <Menu size={22} strokeWidth={1.8} />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </div>

      {/* Drawer overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Drawer */}
      <div className={`md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-[24px] transition-transform duration-300 ease-out ${
        menuOpen ? 'translate-y-0' : 'translate-y-full'
      }`}>
        <div className="w-10 h-1 rounded-full bg-border mx-auto mt-3 mb-1" />

        <div className="flex justify-between items-center px-5 py-3 border-b border-border">
          <p className="t-h3 text-text-primary">Menu</p>
          <button
            onClick={() => setMenuOpen(false)}
            className="text-text-muted min-h-0 min-w-0 w-9 h-9 flex items-center justify-center rounded-full hover:bg-bg-subtle"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto pb-safe">
          {drawerItems.map(({ name, icon: Icon, path }) => {
            const isActive = pathname === path
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`flex flex-col items-center gap-2 py-4 rounded-[14px] transition-colors min-h-0 drawer-item ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'bg-bg-subtle text-text-secondary'
                }`}
              >
                <Icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
                <span className="t-small font-medium">{name}</span>
              </button>
            )
          })}
        </div>

        <div className="px-5 pt-1 pb-3"><UpdateButton /></div>
        <div className="px-5 pb-8 pt-1">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-[12px] text-danger border border-danger/20 t-label hover:bg-danger/5 transition-colors"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}