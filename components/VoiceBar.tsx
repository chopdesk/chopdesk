'use client'

// components/VoiceBar.tsx
// The assistant bar, in the style of the old Google Assistant.
// A pill shows what is happening ("I'm listening…", the words as they are heard). A colour line runs from one
// edge of the screen to the other, along the very bottom, and rises and falls with the voice.
// The line never blocks a tap, so staff can always use the normal buttons.
// Voice loudness: a real level (0 to 1) is used when the phone gives one. If not, a pulse is driven by the
// words appearing on screen. With "reduce motion" turned on in the phone, nothing moves.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

export type BarState = 'idle' | 'armed' | 'listening' | 'thinking' | 'ok' | 'maybe'

type Props = {
  state: BarState
  /** real loudness 0 to 1, or null when it is not available */
  level: number | null
  /** changes every time new words appear; drives the fake pulse when there is no real level */
  pulse: number
  onClick: () => void
  label: string
  /** the line of text inside the pill */
  text: string
  /** the mic icon */
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
.vb-pill{display:flex;align-items:center;gap:12px;width:100%;min-height:48px;padding:0 6px 0 18px;
  border:1px solid #E5E7EB;border-radius:9999px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);
  text-align:left;cursor:pointer;transition:box-shadow .2s ease,border-color .2s ease}
.vb-pill[data-state=listening],.vb-pill[data-state=thinking]{border-color:#4285F4;box-shadow:0 2px 10px rgba(66,133,244,.25)}
.vb-pill[data-state=ok]{border-color:#34A853}
.vb-pill[data-state=maybe]{border-color:#E65100}
.vb-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px;color:#4B5563}
.vb-pill[data-state=listening] .vb-text,.vb-pill[data-state=thinking] .vb-text{color:#12566B;font-weight:500}
.vb-mic{position:relative;display:flex;align-items:center;justify-content:center;width:40px;height:40px;
  flex-shrink:0;border-radius:9999px;color:#12566B}
.vb-mic svg{position:relative;z-index:2}
.vb-ring{position:absolute;inset:0;border-radius:inherit;border:2px solid #4285F4;opacity:0}
.vb-pill[data-state=listening] .vb-ring,.vb-pill[data-state=thinking] .vb-ring{opacity:1;animation:vb-ping 1.4s ease-out infinite}
.vb-pill[data-state=armed] .vb-ring{opacity:.5;border-color:#34A853;animation:vb-breathe 2.6s ease-in-out infinite}

.vb-line{position:fixed;left:0;right:0;bottom:env(safe-area-inset-bottom,0px);z-index:60;display:flex;
  align-items:flex-end;height:18px;pointer-events:none;opacity:0;transition:opacity .25s ease}
.vb-line::before{content:"";position:absolute;left:0;right:0;bottom:0;height:70px;opacity:.9;
  background:linear-gradient(to top,rgba(66,133,244,.16),transparent)}
.vb-line i{position:relative;display:block;flex:1;transform-origin:bottom;
  border-radius:9999px 9999px 0 0;height:calc(3px + var(--lvl,0) * 12px);
  transition:height .09s linear,background .3s ease}
.vb-line i:nth-child(1){background:#4285F4}
.vb-line i:nth-child(2){background:#EA4335;animation-delay:.15s}
.vb-line i:nth-child(3){background:#FBBC05;animation-delay:.3s}
.vb-line i:nth-child(4){background:#34A853;animation-delay:.45s}
.vb-line[data-state=listening],.vb-line[data-state=thinking]{opacity:1}
.vb-line[data-state=listening] i,.vb-line[data-state=thinking] i{animation:vb-bounce 1s ease-in-out infinite}
.vb-line[data-state=listening] i:nth-child(2){animation-delay:.15s}
.vb-line[data-state=listening] i:nth-child(3){animation-delay:.3s}
.vb-line[data-state=listening] i:nth-child(4){animation-delay:.45s}
.vb-line[data-state=thinking] i{animation-duration:.55s}
.vb-line[data-state=armed]{opacity:.55}
.vb-line[data-state=armed] i{height:2px;animation:vb-breathe 2.6s ease-in-out infinite}
.vb-line[data-state=ok]{opacity:1}
.vb-line[data-state=ok] i{height:5px;background:#34A853}
.vb-line[data-state=maybe]{opacity:1}
.vb-line[data-state=maybe] i{height:5px;background:#E65100}
@keyframes vb-bounce{0%,100%{transform:scaleY(.55)}50%{transform:scaleY(1.35)}}
@keyframes vb-ping{0%{transform:scale(.9);opacity:.9}100%{transform:scale(1.35);opacity:0}}
@keyframes vb-breathe{0%,100%{opacity:.35}50%{opacity:.9}}
@media (prefers-reduced-motion:reduce){
  .vb-line i,.vb-ring{animation:none!important}
  .vb-line i{transition:none;transform:none!important}
}
`

export default function VoiceBar({ state, level, pulse, onClick, label, text, children }: Props) {
  const active = state === 'listening' || state === 'thinking'
  const lvl = useDisplayLevel(active, level, pulse)
  const lineStyle = { '--lvl': lvl } as CSSProperties

  return (
    <>
      <style>{CSS}</style>
      <button type="button" className="vb-pill" data-state={state} onClick={onClick} aria-label={label}>
        <span className="vb-text" aria-live="polite">
          {text}
        </span>
        <span className="vb-mic">
          <span className="vb-ring" />
          {children}
        </span>
      </button>
      <div className="vb-line" data-state={state} style={lineStyle} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
    </>
  )
}
