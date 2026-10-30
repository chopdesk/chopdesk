// lib/useScrollContainer.ts
'use client'

import { useEffect, useRef, useCallback } from 'react'

interface UseScrollContainerOptions {
  /** Enable pull-to-refresh prevention (default: true) */
  preventPullToRefresh?: boolean
  /** Callback when user pulls down from top */
  onPullToRefresh?: () => void
  /** Threshold in pixels to trigger pull-to-refresh (default: 100) */
  pullThreshold?: number
}

export function useScrollContainer(options: UseScrollContainerOptions = {}) {
  const {
    preventPullToRefresh = true,
    onPullToRefresh,
    pullThreshold = 100
  } = options

  const containerRef = useRef<HTMLDivElement>(null)
  const startYRef = useRef<number>(0)
  const startScrollTopRef = useRef<number>(0)
  const isPullingRef = useRef<boolean>(false)
  const pullDistanceRef = useRef<number>(0)
  const refreshingRef = useRef<boolean>(false)

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const container = containerRef.current
    if (!container) return

    startYRef.current = e.touches[0].clientY
    startScrollTopRef.current = container.scrollTop
    isPullingRef.current = false
    pullDistanceRef.current = 0
  }, [])

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!preventPullToRefresh || refreshingRef.current) return

      const container = containerRef.current
      if (!container) return

      const currentY = e.touches[0].clientY
      const deltaY = currentY - startYRef.current
      const currentScrollTop = container.scrollTop

      // Only consider it a pull gesture if:
      // 1. We're at the very top (scrollTop === 0)
      // 2. The user is pulling DOWN (deltaY > 0)
      // 3. We're not already scrolling up from somewhere else
      if (currentScrollTop === 0 && deltaY > 0 && startScrollTopRef.current === 0) {
        isPullingRef.current = true
        pullDistanceRef.current = Math.min(deltaY, pullThreshold * 1.5)
        
        // Only prevent default if we've pulled beyond a small threshold
        // This allows normal scrolling gestures to work
        if (deltaY > 15) {
          e.preventDefault()
        }
      } else {
        isPullingRef.current = false
      }
    },
    [preventPullToRefresh, pullThreshold]
  )

  const handleTouchEnd = useCallback(async () => {
    const container = containerRef.current
    if (!container) return

    // Only trigger refresh if we actually pulled down and met the threshold
    if (isPullingRef.current && pullDistanceRef.current >= pullThreshold && onPullToRefresh && !refreshingRef.current) {
      refreshingRef.current = true
      
      // Add a visual indicator class
      container.classList.add('refreshing')
      
      try {
        await onPullToRefresh()
      } finally {
        refreshingRef.current = false
        container.classList.remove('refreshing')
      }
    }

    isPullingRef.current = false
    pullDistanceRef.current = 0
  }, [onPullToRefresh, pullThreshold])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    if (preventPullToRefresh) {
      container.addEventListener('touchstart', handleTouchStart, { passive: false })
      container.addEventListener('touchmove', handleTouchMove, { passive: false })
      container.addEventListener('touchend', handleTouchEnd)
    }

    return () => {
      if (preventPullToRefresh) {
        container.removeEventListener('touchstart', handleTouchStart)
        container.removeEventListener('touchmove', handleTouchMove)
        container.removeEventListener('touchend', handleTouchEnd)
      }
    }
  }, [preventPullToRefresh, handleTouchStart, handleTouchMove, handleTouchEnd])

  return containerRef
}
