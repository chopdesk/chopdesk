'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Clock, Play } from 'lucide-react'

type NoShiftStateProps = {
  title?: string
  message: string
}

// Shown in place of a page that needs an open shift. No redirect: the person
// reads what happened and chooses what to do next.
export default function NoShiftState({ title = 'No shift is open', message }: NoShiftStateProps) {
  const router = useRouter()
  const [shown, setShown] = useState(false)

  // Two frames so the spring entrance also plays on iPhone
  useEffect(() => {
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setShown(true))
    })
    return () => {
      cancelAnimationFrame(r1)
      cancelAnimationFrame(r2)
    }
  }, [])

  return (
    <div className="flex min-h-[70dvh] items-center justify-center p-4">
      <div
        className={`w-full max-w-sm rounded-lg border border-border bg-white p-6 text-center shadow-lg transition-[transform,opacity] motion-reduce:transition-none ${
          shown
            ? 'translate-y-0 opacity-100 duration-500 ease-spring'
            : 'translate-y-6 opacity-0'
        }`}
      >
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-light text-primary">
          <Clock size={30} />
        </span>

        <h2 className="t-h2 mt-5 text-text-primary">{title}</h2>
        <p className="t-body mt-2 text-text-secondary">{message}</p>

        <button onClick={() => router.push('/dashboard/shift')} className="btn-primary mt-6 w-full">
          <Play size={18} /> Start a shift
        </button>

        <button
          onClick={() => router.push('/dashboard')}
          className="t-label mt-1 flex h-11 min-h-0 w-full items-center justify-center gap-1.5 text-text-muted"
        >
          <ArrowLeft size={16} /> Back to home
        </button>
      </div>
    </div>
  )
}