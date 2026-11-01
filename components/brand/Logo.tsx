// components/brand/Logo.tsx
import { brand } from '@/lib/brand'

type LogoProps = {
  size?: number
  nameSize?: number
  showName?: boolean
  tone?: 'dark' | 'light'
  layout?: 'inline' | 'stacked'
  className?: string
}

export default function Logo({
  size = 40,
  nameSize,
  showName = true,
  tone = 'dark',
  layout = 'inline',
  className = '',
}: LogoProps) {
  const stacked = layout === 'stacked'
  const fontSize = nameSize ?? Math.round(size * (stacked ? 0.34 : 0.6))
  const gap = stacked ? 8 : Math.round(size * 0.26)

  return (
    <span
      className={`inline-flex items-center ${stacked ? 'flex-col' : ''} ${className}`}
      style={{ gap }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={brand.icon}
        alt={showName ? '' : brand.name}
        width={size}
        height={size}
        className={`shrink-0 ${tone === 'light' ? 'rounded-[22%] ring-1 ring-white/30' : ''}`}
        style={{ width: size, height: size }}
      />
      {showName && (
        <span
          className={`t-brand ${tone === 'light' ? 'text-white' : 'text-text-primary'}`}
          style={{ fontSize, lineHeight: 1, position: 'relative', top: '0.05em' }}
        >
          {brand.name}
        </span>
      )}
    </span>
  )
}
