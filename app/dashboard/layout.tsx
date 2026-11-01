'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, ShoppingBag, Package, Clock,
  Utensils, Receipt, History, Users,
  LogOut, Menu, X,
} from 'lucide-react'
import { signOut, getSession } from '@/lib/auth'
import AuthGuard from '@/components/AuthGuard'
import { getActiveShift } from '@/lib/shift'
import ConnectionStatus from '@/components/ConnectionStatus'
import UpdateBanner, { UpdateButton } from '@/components/UpdateManager'
import Logo from '@/components/brand/Logo'

const SPRING = 'cubic-bezier(0.3, 1.2, 0.5, 1)'
const SHIFT_START = '/dashboard/shift'
const SHIFT_CLOSE = '/dashboard/shift/close'

const bottomNav = [
  { name: 'Home', icon: LayoutDashboard, path: '/dashboard' },
  { name: 'Orders', icon: ShoppingBag, path: '/dashboard/orders' },
  { name: 'Stock', icon: Package, path: '/dashboard/stock' },
  { name: 'Shift', icon: Clock, path: SHIFT_START },
]

// Standing config and history live in the drawer; shift actions live in the main tabs
const drawerItems = [
  { name: 'Menu Items', icon: Utensils, path: '/dashboard/menu' },
  { name: 'Order History', icon: Receipt, path: '/dashboard/order-history' },
  { name: 'Shift History', icon: History, path: '/dashboard/shifts' },
  { name: 'Team', icon: Users, path: '/dashboard/team' },
]

const allItems = [...bottomNav, ...drawerItems]

// Pages reached from inside a flow still need a real title in the top bar
const extraTitles: Record<string, string> = {
  '/dashboard/expenses': 'Expenses',
  '/dashboard/shift/close': 'Close Shift',
  '/dashboard/shifts/view': 'Shift Details',
  '/dashboard/payment': 'Payment',
  '/dashboard/receipt': 'Receipt',
}

// Flow pages light up the tab they are reached from
const parentOf: Record<string, string> = {
  '/dashboard/shift/close': SHIFT_START,
  '/dashboard/shifts/view': '/dashboard/shifts',
  '/dashboard/payment': '/dashboard/orders',
  '/dashboard/receipt': '/dashboard/orders',
  '/dashboard/expenses': '/dashboard/orders',
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ''
  // trailingSlash is on, so the real path is "/dashboard/"; compare without the slash
  const path = pathname.replace(/\/+$/, '') || '/'
  const router = useRouter()

  const [menuOpen, setMenuOpen] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const shiftActive = useRef<boolean | null>(null)

  useEffect(() => {
    setOrgName(getSession()?.org_name || '')
  }, [])

  // The tap highlights instantly; once the route really changes, trust the route
  useEffect(() => {
    setPending(null)
  }, [path])

  const refreshShift = useCallback(async () => {
    try {
      shiftActive.current = !!(await getActiveShift())
    } catch {
      // keep the last known value
    }
  }, [])

  useEffect(() => {
    refreshShift()
  }, [path, refreshShift])

  const current = pending ?? path
  const activePath = parentOf[current] ?? current

  const sidebarIdx = allItems.findIndex((i) => i.path === activePath)
  const bottomIdx = bottomNav.findIndex((i) => i.path === activePath)
  const inDrawer = drawerItems.some((i) => i.path === activePath)
  const navIdx = bottomIdx >= 0 ? bottomIdx : inDrawer ? bottomNav.length : -1

  const pageTitle =
    path === '/dashboard'
      ? null
      : allItems.find((i) => i.path === path)?.name || extraTitles[path] || orgName || 'Chopdesk'

  const navigate = (target: string) => {
    setMenuOpen(false)
    setPending(target)
    router.push(target)
  }

  // Shift tab: go straight to Close Shift if one is open, otherwise Start Shift.
  // Uses the last known answer so the tap never waits on the network, then double-checks.
  const handleShiftNav = async () => {
    setMenuOpen(false)
    setPending(SHIFT_START)

    const guess = shiftActive.current
    if (guess !== null) {
      router.push(guess ? SHIFT_CLOSE : SHIFT_START)
      refreshShift().then(() => {
        const now = shiftActive.current
        const here = window.location.pathname.replace(/\/+$/, '')
        if (now !== null && now !== guess && (here === SHIFT_START || here === SHIFT_CLOSE)) {
          router.replace(now ? SHIFT_CLOSE : SHIFT_START)
        }
      })
      return
    }

    try {
      const shift = await getActiveShift()
      shiftActive.current = !!shift
      router.push(shift ? SHIFT_CLOSE : SHIFT_START)
    } catch (err) {
      console.error(err)
      router.push(SHIFT_START)
    }
  }

  const handleItem = (target: string) => {
    if (target === SHIFT_START) handleShiftNav()
    else navigate(target)
  }

  const handleLogout = async () => {
    await signOut()
    router.replace('/auth/login')
  }

  return (
    <div className="h-screen flex flex-col bg-bg-subtle overflow-hidden" style={{ height: '100dvh' }}>
      {/* Sidebar: tablet and PC */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-30 w-56 flex-col border-r border-border bg-white">
        <div className="flex h-14 shrink-0 items-center border-b border-border px-5">
          <Logo size={30} nameSize={22} />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="relative flex flex-col gap-0.5">
            <span
              aria-hidden
              className="absolute left-0 right-0 top-0 h-11 rounded-[10px] bg-primary/10"
              style={{
                transform: `translateY(${Math.max(sidebarIdx, 0) * 46}px)`,
                opacity: sidebarIdx >= 0 ? 1 : 0,
                transition: `transform 460ms ${SPRING}, opacity 200ms ease`,
              }}
            />
            {allItems.map(({ name, icon: Icon, path: itemPath }) => {
              const isActive = activePath === itemPath
              return (
                <button
                  key={itemPath}
                  onClick={() => handleItem(itemPath)}
                  className={`relative z-10 flex h-11 w-full min-h-0 items-center gap-3 rounded-[10px] px-3 transition-[color,background-color,transform] duration-150 active:scale-[0.97] ${
                    isActive
                      ? 'text-primary'
                      : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary'
                  }`}
                >
                  <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span className="t-body font-medium">{name}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="shrink-0 border-t border-border px-3 pb-6 pt-3">
          <div className="mb-2">
            <UpdateButton />
          </div>
          <button
            onClick={handleLogout}
            className="flex h-11 w-full min-h-0 items-center gap-3 rounded-[10px] px-3 text-danger transition-[background-color,transform] duration-150 hover:bg-danger/5 active:scale-[0.97]"
          >
            <LogOut size={18} />
            <span className="t-body font-medium">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Top bar */}
      <header className="fixed left-0 right-0 top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-white px-4 md:left-56">
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
          <ConnectionStatus variant="dot" />
        </div>
        {pageTitle ? (
          <>
            <button
              onClick={() => router.back()}
              aria-label="Go back"
              className="flex h-9 w-9 min-h-0 min-w-0 items-center justify-center rounded-full text-text-secondary transition-[background-color,transform] duration-150 hover:bg-bg-subtle active:scale-90"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <p className="t-h3 text-text-primary">{pageTitle}</p>
            <div className="w-9" />
          </>
        ) : (
          <h1 className="t-brand text-primary">{orgName}</h1>
        )}
      </header>

      {/* Connection banner */}
      <div className="pointer-events-none fixed left-0 right-0 top-14 z-30 md:left-56">
        <ConnectionStatus />
      </div>

      {/* Update available card */}
      <UpdateBanner />

      {/* Page content: rendered once for every screen size */}
      <main className="flex-1 overflow-y-auto pb-20 pt-14 md:pb-0 md:pl-56" style={{ overscrollBehaviorY: 'contain' }}>
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden bottom-nav fixed bottom-0 left-0 right-0 z-20 bg-white"
        style={{ padding: '0 0 env(safe-area-inset-bottom)' }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 flex w-1/5 justify-center"
          style={{
            transform: `translateX(${Math.max(navIdx, 0) * 100}%)`,
            opacity: navIdx >= 0 ? 1 : 0,
            transition: `transform 460ms ${SPRING}, opacity 200ms ease`,
          }}
        >
          <span className="h-[3px] w-8 rounded-full bg-primary" />
        </span>

        {bottomNav.map(({ name, icon: Icon, path: itemPath }) => {
          const isActive = activePath === itemPath
          return (
            <button
              key={itemPath}
              onClick={() => handleItem(itemPath)}
              className={`flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 transition-[color,transform] duration-150 active:scale-90 ${
                isActive ? 'text-primary' : 'text-text-muted'
              }`}
            >
              <Icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10px] font-medium">{name}</span>
            </button>
          )
        })}

        <button
          onClick={() => setMenuOpen(true)}
          className={`flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 transition-[color,transform] duration-150 active:scale-90 ${
            inDrawer ? 'text-primary' : 'text-text-muted'
          }`}
        >
          <Menu size={22} strokeWidth={inDrawer ? 2.2 : 1.8} />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>

      {/* Drawer overlay (always mounted so it can fade) */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/35 transition-opacity duration-300 ${
          menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setMenuOpen(false)}
      />

      {/* Drawer */}
      <div
        aria-hidden={!menuOpen}
        className={`md:hidden fixed bottom-0 left-0 right-0 z-50 rounded-t-[24px] bg-white will-change-transform transition-transform duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
          menuOpen ? 'translate-y-0' : 'pointer-events-none translate-y-full'
        }`}
      >
        <div className="mx-auto mb-1 mt-3 h-1 w-10 rounded-full bg-border" />

        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <p className="t-h3 text-text-primary">Menu</p>
          <button
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
            className="flex h-9 w-9 min-h-0 min-w-0 items-center justify-center rounded-full text-text-muted transition-[background-color,transform] duration-150 hover:bg-bg-subtle active:scale-90"
          >
            <X size={18} />
          </button>
        </div>

        <div className="pb-safe grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto px-4 py-4">
          {drawerItems.map(({ name, icon: Icon, path: itemPath }) => {
            const isActive = activePath === itemPath
            return (
              <button
                key={itemPath}
                onClick={() => navigate(itemPath)}
                className={`drawer-item flex min-h-0 flex-col items-center gap-2 rounded-[14px] py-4 transition-colors ${
                  isActive ? 'bg-primary/10 text-primary' : 'bg-bg-subtle text-text-secondary'
                }`}
              >
                <Icon size={22} strokeWidth={isActive ? 2.2 : 1.8} />
                <span className="t-small font-medium">{name}</span>
              </button>
            )
          })}
        </div>

        <div className="px-5 pb-3 pt-1">
          <UpdateButton />
        </div>
        <div className="px-5 pb-8 pt-1">
          <button
            onClick={handleLogout}
            className="t-label flex w-full items-center justify-center gap-2 rounded-[12px] border border-danger/20 py-3 text-danger transition-[background-color,transform] duration-150 hover:bg-danger/5 active:scale-[0.98]"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <DashboardShell>{children}</DashboardShell>
    </AuthGuard>
  )
}
