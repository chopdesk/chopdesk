'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  Home, ShoppingBag, Package, Clock,
  Utensils, Receipt, History, Users,
  LogOut, Menu, X, ChevronRight, ChevronLeft,
} from 'lucide-react'
import { signOut, getSession } from '@/lib/auth'
import AuthGuard from '@/components/AuthGuard'
import { getActiveShift } from '@/lib/shift'
import ConnectionStatus from '@/components/ConnectionStatus'
import UpdateBanner, { UpdateButton } from '@/components/UpdateManager'
import Logo from '@/components/brand/Logo'

const SHIFT_START = '/dashboard/shift'
const SHIFT_CLOSE = '/dashboard/shift/close'

const HOME = { name: 'Home', icon: Home, path: '/dashboard' }
const ORDERS = { name: 'Orders', icon: ShoppingBag, path: '/dashboard/orders' }
const STOCK = { name: 'Stock', icon: Package, path: '/dashboard/stock' }
const SHIFT = { name: 'Shift', icon: Clock, path: SHIFT_START }
const MENU = { name: 'Menu Items', icon: Utensils, path: '/dashboard/menu' }
const TEAM = { name: 'Team', icon: Users, path: '/dashboard/team' }
const ORDER_HISTORY = { name: 'Order History', icon: Receipt, path: '/dashboard/order-history' }
const SHIFT_HISTORY = { name: 'Shift History', icon: History, path: '/dashboard/shifts' }

// Phone bottom bar: Orders sits in the middle because it is the most used screen
const tabs = [HOME, STOCK, ORDERS, SHIFT]

// Sidebar and the "More" sheet share the same groups
const groups: { label: string | null; items: typeof tabs }[] = [
  { label: null, items: [HOME, ORDERS, STOCK, SHIFT] },
  { label: 'Manage', items: [MENU, TEAM] },
  { label: 'Records', items: [ORDER_HISTORY, SHIFT_HISTORY] },
]
const moreGroups = groups.slice(1)
const moreItems = moreGroups.flatMap((g) => g.items)
const allItems = groups.flatMap((g) => g.items)

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

// Where the back arrow goes (anything not listed goes Home)
const backTo: Record<string, string> = {
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
  const [firstName, setFirstName] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [shiftOpen, setShiftOpen] = useState(false)
  const shiftActive = useRef<boolean | null>(null)

  useEffect(() => {
    const session = getSession()
    setOrgName(session?.org_name || '')
    setFirstName(session?.first_name || '')
  }, [])

  // The tap highlights instantly; once the route really changes, trust the route
  useEffect(() => {
    setPending(null)
  }, [path])

  const refreshShift = useCallback(async () => {
    try {
      const open = !!(await getActiveShift())
      shiftActive.current = open
      setShiftOpen(open)
    } catch {
      // keep the last known value
    }
  }, [])

  useEffect(() => {
    refreshShift()
  }, [path, refreshShift])

  const current = pending ?? path
  const activePath = parentOf[current] ?? current
  const inMore = moreItems.some((i) => i.path === activePath)

  const isHome = path === '/dashboard'
  const isTabRoot = tabs.some((t) => t.path === path)
  const showBack = !isHome && !isTabRoot
  const backHiddenOnPC = allItems.some((i) => i.path === path) // these have a sidebar link on PC

  const pageTitle = isHome
    ? orgName || 'Chopdesk'
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
      setShiftOpen(!!shift)
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

  const handleBack = () => {
    router.push(backTo[path] || '/dashboard')
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

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {groups.map((group, gi) => (
            <div key={group.label ?? 'main'} className={gi > 0 ? 'mt-4' : ''}>
              {group.label && (
                <p className="t-small px-3 pb-1 font-medium uppercase tracking-wide text-text-muted">
                  {group.label}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map(({ name, icon: Icon, path: itemPath }) => {
                  const isActive = activePath === itemPath
                  return (
                    <button
                      key={itemPath}
                      onClick={() => handleItem(itemPath)}
                      className={`relative flex h-10 w-full min-h-0 items-center gap-3 rounded-lg px-3 transition-colors duration-150 ${
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary'
                      }`}
                    >
                      <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                      <span className="t-body font-medium">{name}</span>
                      {itemPath === SHIFT_START && shiftOpen && (
                        <span className="ml-auto flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-success" />
                          <span className="t-small text-success">Open</span>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border px-3 pb-6 pt-3">
          <div className="mb-2">
            <UpdateButton />
          </div>
          <button
            onClick={handleLogout}
            className="flex h-10 w-full min-h-0 items-center gap-3 rounded-lg px-3 text-danger transition-colors duration-150 hover:bg-danger/5"
          >
            <LogOut size={18} />
            <span className="t-body font-medium">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Top bar */}
      <header className="fixed left-0 right-0 top-0 z-20 flex h-14 items-center border-b border-border bg-white px-2 md:left-56 md:px-6">
        {showBack && (
          <button
            onClick={handleBack}
            aria-label="Go back"
            className={`mr-1 flex h-10 w-10 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-full text-text-primary transition-colors duration-150 hover:bg-bg-subtle active:bg-bg-subtle ${
              backHiddenOnPC ? 'md:hidden' : ''
            }`}
          >
            <ChevronLeft size={24} strokeWidth={2} />
          </button>
        )}
        <h1 className={`t-h3 truncate pr-10 text-text-primary ${showBack ? '' : 'pl-2 md:pl-0'}`}>
          {pageTitle}
        </h1>
        <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
          <ConnectionStatus variant="dot" />
        </div>
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
        {tabs.map(({ name, icon: Icon, path: itemPath }) => {
          const isActive = activePath === itemPath
          return (
            <button
              key={itemPath}
              onClick={() => handleItem(itemPath)}
              className={`flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 ${
                isActive ? 'text-primary' : 'text-text-muted'
              }`}
            >
              <span
                className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150 ${
                  isActive ? 'bg-primary/10' : 'bg-transparent'
                }`}
              >
                <Icon size={22} strokeWidth={isActive ? 2.3 : 1.8} />
                {itemPath === SHIFT_START && shiftOpen && (
                  <span className="absolute right-3 top-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-white" />
                )}
              </span>
              <span className={`text-[11px] ${isActive ? 'font-semibold' : 'font-medium'}`}>{name}</span>
            </button>
          )
        })}

        <button
          onClick={() => setMenuOpen(true)}
          className={`flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 ${
            inMore ? 'text-primary' : 'text-text-muted'
          }`}
        >
          <span
            className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150 ${
              inMore ? 'bg-primary/10' : 'bg-transparent'
            }`}
          >
            <Menu size={22} strokeWidth={inMore ? 2.3 : 1.8} />
          </span>
          <span className={`text-[11px] ${inMore ? 'font-semibold' : 'font-medium'}`}>More</span>
        </button>
      </nav>

      {/* Sheet overlay (always mounted so it can fade) */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/35 transition-opacity duration-300 ${
          menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setMenuOpen(false)}
      />

      {/* More sheet */}
      <div
        aria-hidden={!menuOpen}
        className={`md:hidden fixed bottom-0 left-0 right-0 z-50 rounded-t-[20px] bg-white will-change-transform transition-transform duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${
          menuOpen ? 'translate-y-0' : 'pointer-events-none translate-y-full'
        }`}
      >
        <div className="mx-auto mb-1 mt-3 h-1 w-10 rounded-full bg-border" />

        {/* Business header */}
        <div className="flex items-center gap-3 px-5 py-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <span className="t-h3">{(orgName || 'C').charAt(0).toUpperCase()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="t-h3 truncate text-text-primary">{orgName || 'Chopdesk'}</p>
            {firstName && <p className="t-small truncate text-text-secondary">{firstName}</p>}
          </div>
          <button
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
            className="flex h-9 w-9 min-h-0 min-w-0 items-center justify-center rounded-full text-text-muted transition-colors duration-150 hover:bg-bg-subtle active:bg-bg-subtle"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto border-t border-border pb-2">
          {moreGroups.map((group) => (
            <div key={group.label}>
              <p className="t-small px-5 pb-1 pt-4 font-medium uppercase tracking-wide text-text-muted">
                {group.label}
              </p>
              {group.items.map(({ name, icon: Icon, path: itemPath }) => {
                const isActive = activePath === itemPath
                return (
                  <button
                    key={itemPath}
                    onClick={() => navigate(itemPath)}
                    className={`flex h-12 w-full min-h-0 items-center gap-4 px-5 text-left transition-colors duration-150 active:bg-bg-subtle ${
                      isActive ? 'bg-primary/10 text-primary' : 'text-text-primary'
                    }`}
                  >
                    <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} className={isActive ? '' : 'text-text-secondary'} />
                    <span className="t-body flex-1 font-medium">{name}</span>
                    <ChevronRight size={18} className="text-text-muted" />
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="border-t border-border px-5 pb-3 pt-3">
          <UpdateButton />
        </div>
        <div className="pb-safe px-5 pb-6">
          <button
            onClick={handleLogout}
            className="flex h-12 w-full min-h-0 items-center gap-4 text-danger transition-colors duration-150 active:bg-danger/5"
          >
            <LogOut size={20} />
            <span className="t-body font-medium">Sign Out</span>
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
