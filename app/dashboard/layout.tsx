'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
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
import { InstallButton } from '@/components/InstallPrompt'

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

  // Sliding highlight in the rail / sidebar: measured from the active link
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({})
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null)
  const [pillAnim, setPillAnim] = useState(false)

  // More sheet: drag the top part down to close it
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ startY: number; lastY: number; lastT: number; v: number; dy: number; active: boolean } | null>(null)

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

  // Bottom bar highlight: tabs are 0-3, More is 4. It keeps its last spot while no tab is active.
  const activeIdx = tabs.findIndex((t) => t.path === activePath) >= 0
    ? tabs.findIndex((t) => t.path === activePath)
    : inMore ? tabs.length : -1
  const [bottomIdx, setBottomIdx] = useState(0)
  if (activeIdx >= 0 && activeIdx !== bottomIdx) setBottomIdx(activeIdx)

  const measurePill = useCallback(() => {
    const el = itemRefs.current[activePath]
    if (!el || el.offsetHeight === 0) {
      setPill(null)
      return
    }
    setPill((old) =>
      old && old.top === el.offsetTop && old.height === el.offsetHeight
        ? old
        : { top: el.offsetTop, height: el.offsetHeight }
    )
  }, [activePath])

  useLayoutEffect(() => {
    measurePill()
  }, [measurePill])

  useEffect(() => {
    window.addEventListener('resize', measurePill)
    return () => window.removeEventListener('resize', measurePill)
  }, [measurePill])

  // Turn the slide animation on only after the first paint, so the highlight does not fly in on load
  useEffect(() => {
    const id = requestAnimationFrame(() => setPillAnim(true))
    return () => cancelAnimationFrame(id)
  }, [])

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

  // Real links: the browser can prefetch them. Shift keeps its own smart routing.
  const handleLink = (e: React.MouseEvent, target: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    if (target === SHIFT_START) {
      e.preventDefault()
      handleShiftNav()
      return
    }
    setMenuOpen(false)
    setPending(target)
  }

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0, dy: 0, active: false }
  }

  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dy = e.clientY - d.startY
    if (!d.active) {
      // Ignore small wiggles so taps on the close button still work
      if (Math.abs(dy) < 6) return
      d.active = true
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const dt = e.timeStamp - d.lastT
    if (dt > 0) d.v = (e.clientY - d.lastY) / dt
    d.lastY = e.clientY
    d.lastT = e.timeStamp
    d.dy = Math.max(0, dy)
    setDragY(d.dy)
  }

  const onDragEnd = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    setDragging(false)
    setDragY(0)
    if (d.active && (d.dy > 100 || d.v > 0.5)) setMenuOpen(false)
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
      {/* Icon rail on tablets, full sidebar on PCs */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-30 w-16 lg:w-56 flex-col border-r border-border bg-white">
        <div className="flex h-14 shrink-0 items-center justify-center border-b border-border lg:justify-start lg:px-5">
          <span className="lg:hidden">
            <Logo size={30} showName={false} />
          </span>
          <span className="hidden lg:inline-flex">
            <Logo size={30} nameSize={22} />
          </span>
        </div>

        <nav className="relative flex-1 overflow-y-auto px-2 py-3 lg:px-3">
          {pill && (
            <span
              aria-hidden
              className="pointer-events-none absolute left-2 right-2 rounded-lg bg-primary/10 lg:left-3 lg:right-3"
              style={{
                top: pill.top,
                height: pill.height,
                transition: pillAnim
                  ? 'top 380ms var(--ease-spring), height 380ms var(--ease-spring)'
                  : 'none',
              }}
            />
          )}

          {groups.map((group, gi) => (
            <div
              key={group.label ?? 'main'}
              className={gi > 0 ? 'mt-2 border-t border-border pt-2 lg:mt-4 lg:border-0 lg:pt-0' : ''}
            >
              {group.label && (
                <p className="t-small hidden px-3 pb-1 font-medium uppercase tracking-wide text-text-muted lg:block">
                  {group.label}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map(({ name, icon: Icon, path: itemPath }) => {
                  const isActive = activePath === itemPath
                  return (
                    <Link
                      key={itemPath}
                      href={itemPath}
                      ref={(el) => {
                        itemRefs.current[itemPath] = el
                      }}
                      title={name}
                      aria-label={name}
                      onClick={(e) => handleLink(e, itemPath)}
                      className={`press press-flat relative z-10 flex h-10 w-full min-h-0 items-center justify-center gap-3 rounded-lg transition-colors duration-150 lg:justify-start lg:px-3 ${
                        isActive ? 'text-primary' : 'text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                      <span className="t-body hidden font-medium lg:inline">{name}</span>
                      {itemPath === SHIFT_START && shiftOpen && (
                        <>
                          <span className="absolute right-2.5 top-1.5 h-2 w-2 rounded-full bg-success ring-2 ring-white lg:hidden" />
                          <span className="ml-auto hidden items-center gap-1.5 lg:flex">
                            <span className="h-2 w-2 rounded-full bg-success" />
                            <span className="t-small text-success">Open</span>
                          </span>
                        </>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border px-2 pb-6 pt-3 lg:px-3">
          {/* Install and Update need room for text, so they live in the full sidebar only */}
          <div className="mb-2 hidden lg:block">
            <InstallButton onAction={() => setMenuOpen(false)} />
            <UpdateButton />
          </div>
          <button
            onClick={handleLogout}
            title="Sign Out"
            aria-label="Sign Out"
            className="press press-flat flex h-10 w-full min-h-0 items-center justify-center gap-3 rounded-lg text-danger lg:justify-start lg:px-3"
          >
            <LogOut size={18} />
            <span className="t-body hidden font-medium lg:inline">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Top bar */}
      <header className="fixed left-0 right-0 top-0 z-20 flex h-14 items-center border-b border-border bg-white px-2 md:left-16 lg:left-56 md:px-6">
        {showBack && (
          <button
            onClick={handleBack}
            aria-label="Go back"
            className={`mr-1 flex h-10 w-10 min-h-0 min-w-0 shrink-0 items-center justify-center rounded-full press text-text-primary ${
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
      <div className="pointer-events-none fixed left-0 right-0 top-14 z-30 md:left-16 lg:left-56">
        <ConnectionStatus />
      </div>

      {/* Update available card */}
      <UpdateBanner />

      {/* Page content: rendered once for every screen size */}
      <main className="app-main flex-1 overflow-y-auto pt-14 md:pl-16 lg:pl-56" style={{ overscrollBehaviorY: 'contain' }}>
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden bottom-nav fixed bottom-0 left-0 right-0 z-20 bg-white"
        style={{ padding: '0 0 env(safe-area-inset-bottom)' }}
      >
        {/* Sliding highlight: one pill that glides to the active tab (5 equal slots) */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-[10px] h-8 w-1/5"
          style={{
            transform: `translateX(${bottomIdx * 100}%)`,
            opacity: activeIdx >= 0 ? 1 : 0,
            transition: 'transform 380ms var(--ease-spring), opacity 150ms var(--ease-standard)',
          }}
        >
          <span className="mx-auto block h-8 w-14 rounded-full bg-primary/10" />
        </span>

        {tabs.map(({ name, icon: Icon, path: itemPath }) => {
          const isActive = activePath === itemPath
          return (
            <Link
              key={itemPath}
              href={itemPath}
              onClick={(e) => handleLink(e, itemPath)}
              className={`relative flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 ${
                isActive ? 'text-primary' : 'text-text-muted'
              }`}
            >
              <span className="relative flex h-8 w-14 items-center justify-center rounded-full">
                <Icon size={22} strokeWidth={isActive ? 2.3 : 1.8} />
                {itemPath === SHIFT_START && shiftOpen && (
                  <span className="absolute right-3 top-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-white" />
                )}
              </span>
              <span className={`text-[11px] leading-[14px] ${isActive ? 'font-semibold' : 'font-medium'}`}>{name}</span>
            </Link>
          )
        })}

        <button
          onClick={() => setMenuOpen(true)}
          className={`relative flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 ${
            inMore ? 'text-primary' : 'text-text-muted'
          }`}
        >
          <span className="flex h-8 w-14 items-center justify-center rounded-full">
            <Menu size={22} strokeWidth={inMore ? 2.3 : 1.8} />
          </span>
          <span className={`text-[11px] leading-[14px] ${inMore ? 'font-semibold' : 'font-medium'}`}>More</span>
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
        style={dragY > 0 || dragging ? { transform: `translateY(${dragY}px)`, transition: dragging ? 'none' : undefined } : undefined}
      >
        {/* Drag this part down to close the sheet */}
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          className="touch-none"
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
            className="flex h-9 w-9 min-h-0 min-w-0 items-center justify-center press rounded-full text-text-muted"
          >
            <X size={18} />
          </button>
        </div>
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
                    className={`flex h-12 w-full min-h-0 items-center gap-4 press press-flat px-5 text-left ${
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
          <InstallButton onAction={() => setMenuOpen(false)} />
<UpdateButton />
        </div>
        <div className="pb-safe px-5 pb-6">
          <button
            onClick={handleLogout}
            className="flex h-12 w-full min-h-0 press press-flat items-center gap-4 text-danger"
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