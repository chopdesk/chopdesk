'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowRight,
  Boxes,
  FileText,
  ShoppingBag,
  Smartphone,
  Users,
  Wallet,
} from 'lucide-react'
import { loadAuthState } from '@/lib/auth'
import { brand } from '@/lib/brand'
import Logo from '@/components/brand/Logo'
import ReportCard from '@/components/brand/ReportCard'

const steps = [
  {
    title: 'Open a shift',
    text: 'Log what was cooked today. That becomes your opening stock.',
  },
  {
    title: 'Sell',
    text: 'Tap items to build the order and take payment. Every sale comes off your stock automatically.',
  },
  {
    title: 'Close and count',
    text: 'Count what is left. Chopdesk compares it with what it expects and flags anything missing.',
  },
]

const features = [
  {
    icon: ShoppingBag,
    title: 'Fast order taking',
    text: 'Tap the menu, take payment and show the receipt. Built to keep up with a busy counter.',
  },
  {
    icon: Boxes,
    title: 'Live stock board',
    text: 'See what is left, item by item, as you sell. Low items stand out.',
  },
  {
    icon: FileText,
    title: 'Shift reports',
    text: 'Close a shift and copy a clean summary straight into WhatsApp.',
  },
  {
    icon: Wallet,
    title: 'Expenses and cash',
    text: 'Log expenses as they happen and see the cash you really have left after paying them.',
  },
  {
    icon: Users,
    title: 'Your whole team',
    text: 'Invite staff with a link. Everyone who works a shift is recorded on it.',
  },
  {
    icon: Smartphone,
    title: 'Installs like an app',
    text: 'Add it to your phone home screen. No app store needed.',
  },
]

const navButton =
  'inline-flex items-center justify-center rounded-[10px] px-4 text-sm font-semibold transition-colors'

export default function HomePage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let active = true

    async function check() {
      try {
        const state = await loadAuthState()
        if (!active) return
        if (state.status === 'ready') {
          router.replace('/dashboard')
          return
        }
        if (state.status === 'no_business') {
          router.replace('/auth/signup?step=business')
          return
        }
      } catch {
        // treat any error as signed out and show the page
      }
      if (active) setChecking(false)
    }

    check()
    return () => {
      active = false
    }
  }, [router])

  return (
    <div className="min-h-dvh bg-white text-text-primary">
      {/* Splash while the session is checked */}
      {checking && (
        <div className="fixed inset-0 z-50 bg-primary flex flex-col items-center justify-center">
          <Logo size={56} nameSize={42} tone="light" />
          <div className="mt-8 w-7 h-7 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Nav */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-border pt-[env(safe-area-inset-top)]">
        <div className="mx-auto w-full max-w-6xl px-6 h-16 flex items-center justify-between">
          <Link href="/" aria-label={brand.name} className="inline-flex items-center">
            <Logo size={34} nameSize={26} />
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/auth/login" className={`${navButton} text-text-primary hover:bg-bg-subtle`}>
              Sign in
            </Link>
            <Link href="/auth/signup" className={`${navButton} bg-primary text-white hover:bg-primary-hover`}>
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-primary-light to-white">
        <div className="mx-auto w-full max-w-6xl px-6 py-14 lg:py-24 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="text-center lg:text-left">
            <span className="inline-block rounded-full bg-accent-light px-3.5 py-1.5 text-sm font-medium text-text-primary">
              Built for restaurants, canteens and food vendors
            </span>
            <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05]">
              Every plate counted.
              <br />
              <span className="text-primary">Every naira tracked.</span>
            </h1>
            <p className="mt-6 text-lg text-text-secondary max-w-xl mx-auto lg:mx-0">
              {brand.name} gives your food business fast order taking, live stock and a clear report
              at the end of every shift, so nothing goes missing and you always know where you stand.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Link href="/auth/signup" className="btn-primary w-full sm:w-auto">
                Get started
                <ArrowRight size={18} />
              </Link>
              <Link href="/auth/login" className="btn-secondary w-full sm:w-auto">
                Sign in
              </Link>
            </div>
            <p className="mt-5 text-sm text-text-muted">Works on any phone. Install it like an app.</p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <ReportCard className="lg:rotate-1" />
          </div>
        </div>
      </section>

      {/* Statement band */}
      <section className="bg-primary text-white">
        <div className="mx-auto w-full max-w-3xl px-6 py-16 lg:py-20 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Stop guessing where the <span className="text-accent">stock went.</span>
          </h2>
          <p className="mt-5 text-lg text-white/75">
            Paper tallies and WhatsApp messages hide mistakes until it is too late. {brand.name}{' '}
            records every sale as it happens and checks your stock count when the shift closes.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">How it works</h2>
            <p className="mt-4 text-lg text-text-secondary">
              Three simple steps, every day you open.
            </p>
          </div>

          <ol className="mt-12 grid md:grid-cols-3 gap-6">
            {steps.map((step, i) => (
              <li key={step.title} className="rounded-2xl border border-border p-6">
                <span className="w-10 h-10 rounded-full bg-primary text-white font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <h3 className="mt-5 text-xl font-semibold">{step.title}</h3>
                <p className="mt-2 text-text-secondary">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="bg-bg-subtle">
        <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Everything your counter needs
            </h2>
            <p className="mt-4 text-lg text-text-secondary">
              Simple tools that fit the way food businesses really work.
            </p>
          </div>

          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl bg-white border border-border p-6">
                <span className="w-11 h-11 rounded-xl bg-primary-light flex items-center justify-center">
                  <Icon size={22} className="text-primary" />
                </span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-text-secondary">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section>
        <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:py-24">
          <div className="rounded-3xl bg-primary text-white text-center px-6 py-14 lg:py-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl mx-auto">
              Ready to know exactly what happened today?
            </h2>
            <p className="mt-4 text-lg text-white/75 max-w-xl mx-auto">
              Set up your business in a few minutes and run your next shift on {brand.name}.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/auth/signup"
                className="inline-flex items-center justify-center gap-2 h-12 px-6 rounded-[12px] bg-accent text-text-primary font-semibold hover:brightness-95 transition"
              >
                Get started
                <ArrowRight size={18} />
              </Link>
              <Link
                href="/auth/login"
                className="inline-flex items-center justify-center h-12 px-6 rounded-[12px] border border-white/40 text-white font-semibold hover:bg-white/10 transition"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <Logo size={28} nameSize={22} />
          <p className="text-sm text-text-muted">
            © {new Date().getFullYear()} {brand.name}. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
