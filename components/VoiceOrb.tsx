'use client'

// components/VoiceOrb.tsx
// The glowing mic. A round orb that breathes and spins while listening, turns amber while it works
// the sentence out, and flashes green (understood) or orange (not sure). A soft glow along the bottom
// of the screen grows with the voice. The glow never blocks a tap, so staff can always use the normal buttons.
// Voice loudness: when the phone gives a real level (0 to 1) it is used. If not, a pulse is driven
// by the words appearing on screen. With "reduce motion" turned on in the phone, everything stays still.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

export type OrbState = 'idle' | 'listening' | 'thinking' | 'ok' | 'maybe'

type Props = {
  state: OrbState
  /** real loudness 0 to 1, or null when it is not available */
  level: number | null
  /** changes every time new words appear; drives the fake pulse when there is no real level */
  pulse: number
  onClick: () => void
  label: string
  children: ReactNode
}

function useDisplayLevel(active: boolean, level: number | null, pulse: number): number {
  const [fake, setFake] = useState(0)

  useEffect(() => {
    if (active && level === null) setFake(0.85)
  }, [pulse, active, level])

  useEffect(() => {
    if (!active || level !== null) return
    const t = setInterval(() => setFake(f => (f < 0.04 ? 0 : f * 0.86)), 60)
    return () => clearInterval(t)
  }, [active, level])

  if (!active) return 0
  return level ?? fake
}

const CSS = `
.vo-wrap{position:relative;width:48px;height:48px;flex-shrink:0;
  --glow-a:rgba(63,182,201,.55);--glow-b:rgba(18,86,107,.35)}
.vo-wrap[data-state=thinking]{--glow-a:rgba(245,166,35,.6);--glow-b:rgba(230,81,0,.3)}
.vo-wrap[data-state=ok]{--glow-a:rgba(46,125,50,.6);--glow-b:rgba(120,200,120,.35)}
.vo-wrap[data-state=maybe]{--glow-a:rgba(230,81,0,.55);--glow-b:rgba(245,166,35,.35)}
.vo-aura{position:absolute;inset:-12px;border-radius:9999px;pointer-events:none;opacity:0;
  background:radial-gradient(circle,var(--glow-a) 0%,var(--glow-b) 50%,transparent 72%);
  filter:blur(7px);transition:opacity .25s ease,transform .09s linear}
.vo-wrap:not([data-state=idle]) .vo-aura{opacity:1;animation:vo-breathe 1.8s ease-in-out infinite}
.vo-orb{position:relative;display:flex;align-items:center;justify-content:center;width:48px;height:48px;
  min-height:0;min-width:0;padding:0;border:0;border-radius:9999px;color:#fff;background:#12566B;cursor:pointer;
  box-shadow:0 2px 8px rgba(18,86,107,.35);transition:background .25s ease,box-shadow .25s ease,transform .09s linear}
.vo-orb::before{content:"";position:absolute;inset:0;border-radius:inherit;opacity:0;transition:opacity .25s ease;
  background:conic-gradient(from 0deg,#12566B,#3FB6C9,#F5A623,#3FB6C9,#12566B)}
.vo-orb::after{content:"";position:absolute;inset:3px;border-radius:inherit;background:#12566B;transition:background .25s ease}
.vo-icon{position:relative;z-index:2;display:flex}
.vo-wrap[data-state=listening] .vo-orb::before,.vo-wrap[data-state=thinking] .vo-orb::before{opacity:1;animation:vo-spin 3s linear infinite}
.vo-wrap[data-state=thinking] .vo-orb::before{animation-duration:1.1s;
  background:conic-gradient(from 0deg,#E65100,#F5A623,#FFD27A,#F5A623,#E65100)}
.vo-wrap[data-state=thinking] .vo-orb::after{background:#7a4a0a}
.vo-wrap[data-state=ok] .vo-orb,.vo-wrap[data-state=ok] .vo-orb::after{background:#2E7D32}
.vo-wrap[data-state=maybe] .vo-orb,.vo-wrap[data-state=maybe] .vo-orb::after{background:#E65100}
.vo-wrap[data-state=ok] .vo-orb,.vo-wrap[data-state=maybe] .vo-orb{animation:vo-pop .45s ease-out}
.vo-edge{position:fixed;left:0;right:0;bottom:0;height:150px;pointer-events:none;z-index:4;opacity:0;transition:opacity .3s ease}
.vo-edge[data-on=true]{opacity:calc(.3 + var(--lvl,0) * .7)}
.vo-edge::before,.vo-edge::after{content:"";position:absolute;bottom:-70px;height:160px;width:70%;border-radius:9999px;filter:blur(30px)}
.vo-edge::before{left:-10%;background:var(--glow-a);animation:vo-drift 5s ease-in-out infinite alternate}
.vo-edge::after{right:-10%;background:var(--glow-b);animation:vo-drift 7s ease-in-out infinite alternate-reverse}
@keyframes vo-spin{to{transform:rotate(360deg)}}
@keyframes vo-breathe{0%,100%{opacity:.75}50%{opacity:1}}
@keyframes vo-pop{0%{transform:scale(1)}40%{transform:scale(1.18)}100%{transform:scale(1)}}
@keyframes vo-drift{from{transform:translateX(-8%)}to{transform:translateX(18%)}}
@media (prefers-reduced-motion:reduce){
  .vo-orb,.vo-orb::before,.vo-aura,.vo-edge::before,.vo-edge::after{animation:none!important}
  .vo-orb,.vo-aura{transform:none!important;transition:none}
}
`

export default function VoiceOrb({ state, level, pulse, onClick, label, children }: Props) {
  const active = state === 'listening' || state === 'thinking'
  const lvl = useDisplayLevel(active, level, pulse)

  // the vars are read by the style sheet above
  const wrapStyle = { '--lvl': lvl } as CSSProperties
  const auraStyle = { transform: `scale(${1 + lvl * 0.6})` } as CSSProperties
  const orbStyle = { transform: `scale(${1 + lvl * 0.1})` } as CSSProperties

  return (
    <>
      <style>{CSS}</style>
      <div className="vo-wrap" data-state={state} style={wrapStyle}>
        <span className="vo-aura" style={auraStyle} />
        <button type="button" className="vo-orb" onClick={onClick} aria-label={label} style={orbStyle}>
          <span className="vo-icon">{children}</span>
        </button>
        <span className="vo-edge" data-on={active} style={wrapStyle} />
      </div>
    </>
  )
}
