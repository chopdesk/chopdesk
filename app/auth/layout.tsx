import type { ReactNode } from 'react'
import AuthShell from '@/components/brand/AuthShell'
import AuthTabs from '@/components/brand/AuthTabs'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AuthShell>
      <div className="auth-chrome">
        <AuthTabs />
        {children}
      </div>
    </AuthShell>
  )
}
