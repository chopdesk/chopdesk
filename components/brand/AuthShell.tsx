// components/brand/AuthShell.tsx
import type { ReactNode } from 'react'
import Logo from '@/components/brand/Logo'
import ReportCard from '@/components/brand/ReportCard'

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col md:flex-row bg-white">
      {/* Brand panel: tablet and PC */}
      <aside className="hidden md:flex md:w-[46%] lg:w-1/2 relative overflow-hidden bg-primary text-white">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-white/5" />
        <div className="absolute -bottom-40 -left-24 w-[28rem] h-[28rem] rounded-full bg-white/5" />

        <div className="relative z-10 flex flex-col w-full p-10 lg:p-14">
          <Logo size={44} tone="light" />

          <div className="flex-1 flex flex-col justify-center py-10">
            <h2 className="text-4xl lg:text-[3.25rem] font-bold leading-[1.05] tracking-tight">
              Every plate counted.
              <br />
              <span className="text-accent">Every naira tracked.</span>
            </h2>
            <p className="mt-5 text-lg text-white/70 max-w-sm">
              Sales, stock and shift reports for food businesses, in one simple app.
            </p>
            <ReportCard className="mt-10 lg:-rotate-1" />
          </div>
        </div>
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
