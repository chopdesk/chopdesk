import type { ReactNode } from 'react'

export default function AuthTemplate({ children }: { children: ReactNode }) {
  return <div className="auth-enter">{children}</div>
}
