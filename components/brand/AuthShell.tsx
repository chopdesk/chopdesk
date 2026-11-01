// components/brand/AuthShell.tsx
import type { ReactNode } from 'react'
import Logo from '@/components/brand/Logo'
import AuthPanel from '@/components/brand/AuthPanel'

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col md:flex-row bg-white">
      {/* Brand panel: tablet and PC */}
      <aside className="hidden md:flex md:sticky md:top-0 md:h-dvh md:self-start md:w-[46%] lg:w-1/2 overflow-hidden bg-primary text-white">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -bottom-40 -left-24 w-[28rem] h-[28rem] rounded-full bg-white/5" />
        <AuthPanel />
      </aside>

      {/* Compact brand header: phone */}
      <header className="md:hidden bg-primary px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-14 flex flex-col items-center text-center">
        <Logo size={42} nameSize={34} tone="light" />
        <p className="mt-4 text-[15px] leading-snug text-white/80">Every plate counted.<br /><span className="font-semibold text-accent">Every naira tracked.</span></p>
      </header>

      {/* Form area */}
      <main className="flex-1 -mt-6 md:mt-0 rounded-t-[24px] md:rounded-none bg-white flex md:items-start justify-center">
        <div className="w-full max-w-md px-6 pt-8 pb-10 md:pt-[clamp(3rem,14vh,8rem)] md:pb-12">{children}</div>
      </main>
    </div>
  )
}
