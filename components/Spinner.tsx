'use client'

import { useEffect, useState } from 'react'

type SpinnerProps = {
  size?: 'sm' | 'md' | 'lg'
  label?: string
  fullScreen?: boolean
}

const SIZES: Record<string, string> = {
  sm: 'w-5 h-5 border-2',
  md: 'w-8 h-8 border-[3px]',
  lg: 'w-11 h-11 border-4',
}

export default function Spinner({ size = 'md', label, fullScreen = false }: SpinnerProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Trigger on the next frame so the opacity transition actually plays
    // instead of the spinner just snapping straight to fully visible.
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const content = (
    <div
      className={`flex flex-col items-center gap-3 transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className={`${SIZES[size]} border-primary border-t-transparent rounded-full animate-spin`} />
      {label && <p className="text-sm text-gray-400">{label}</p>}
    </div>
  )

  if (fullScreen) {
    return (
      <div className="min-h-screen bg-bg-subtle flex items-center justify-center">
        {content}
      </div>
    )
  }

  return content
}