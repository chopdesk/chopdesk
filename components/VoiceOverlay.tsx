'use client'

// components/VoiceOverlay.tsx
// The full-screen assistant, in the style of Google Assistant / Gemini.
// It is drawn on top of the whole app (a portal), so nothing can hide it.
// Big words in the middle, a big mic at the bottom, and a four-colour line along the very bottom edge
// that rises and falls with the voice. "Done" is always at the top, so staff can leave any time.
// Voice loudness: a real level (0 to 1) when the phone gives one; otherwise a pulse driven by the words
// appearing on screen. With "reduce motion" turned on in the phone, nothing moves.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Volume2, VolumeX, X } from 'lucide-react'

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'ok' | 'maybe'

type Props = {
  open: boolean
  state: VoiceState
  /** real loudness 0 to 1, or null when it is not available */
  level: number | null
  /** changes every time new words appear; drives the fake pulse when there is no real level */
  pulse: number
  /** the big line of text */
  text: string
  /** small help line under the mic */
  hint: string
  /** error message (microphone blocked, and so on) */
  error: string
  /** is the spoken reply on */
  sound: boolean
  onToggleSound: () => void
  onMic: () => void
  onClose: () => void
  /** the mic icon */
  micIcon: ReactNode
  /** the "did you mean" cards and the current order go here */
  children?: ReactNode
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
.vo-root{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;height:100dvh;
  background:rgba(255,255,255,.95);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
  animation:vo-in .22s ease-out}
.vo-top{display:flex;align-items:center;justify-content:space-between;gap:8px;
  padding:calc(12px + env(safe-area-inset-top,0px)) 16px 8px 20px}
.vo-brand{flex:1;font-size:14px;font-weight:600;color:#12566B;letter-spacing:.02em}
.vo-icon{display:flex;align-items:center;justify-content:center;width:44px;height:44px;min-width:0;min-height:0;padding:0;
  border:1px solid #E5E7EB;border-radius:9999px;background:#fff;color:#12566B;cursor:pointer}
.vo-icon[data-off=true]{color:#9CA3AF}
.vo-done{display:flex;align-items:center;gap:6px;min-height:44px;padding:0 16px;border:1px solid #E5E7EB;
  border-radius:9999px;background:#fff;color:#111;font-size:15px;font-weight:500;cursor:pointer}
.vo-body{flex:1;min-height:0;overflow-y:auto;padding:12px 24px 16px}
.vo-big{font-size:26px;line-height:1.3;font-weight:500;color:#4B5563;word-break:break-word}
.vo-root[data-state=listening] .vo-big,.vo-root[data-state=thinking] .vo-big{color:#12566B}
.vo-root[data-state=ok] .vo-big{color:#2E7D32}
.vo-root[data-state=maybe] .vo-big{color:#E65100}
.vo-err{margin-top:10px;font-size:14px;color:#C62828}
.vo-cards{margin-top:20px}
.vo-bottom{display:flex;flex-direction:column;align-items:center;gap:8px;
  padding:12px 16px calc(44px + env(safe-area-inset-bottom,0px))}
.vo-mic{position:relative;display:flex;align-items:center;justify-content:center;width:72px;height:72px;
  min-width:0;min-height:0;padding:0;border:0;border-radius:9999px;background:#12566B;color:#fff;cursor:pointer;
  box-shadow:0 4px 14px rgba(18,86,107,.4)}
.vo-ring{position:absolute;inset:0;border-radius:inherit;border:3px solid #4285F4;opacity:0;pointer-events:none}
.vo-root[data-state=listening] .vo-ring,.vo-root[data-state=thinking] .vo-ring{opacity:1;animation:vo-ping 1.4s ease-out infinite}
.vo-root[data-state=listening] .vo-mic,.vo-root[data-state=thinking] .vo-mic{background:#C62828}
.vo-hint{font-size:13px;color:#6B7280;text-align:center}

.vo-line{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:flex-end;height:18px;pointer-events:none}
.vo-line::before{content:"";position:absolute;left:0;right:0;bottom:0;height:90px;
  background:linear-gradient(to top,rgba(66,133,244,.20),transparent)}
.vo-line i{position:relative;display:block;flex:1;transform-origin:bottom;border-radius:9999px 9999px 0 0;
  height:calc(4px + var(--lvl,0) * 14px);transition:height .09s linear,background .3s ease}
.vo-line i:nth-child(1){background:#4285F4}
.vo-line i:nth-child(2){background:#EA4335}
.vo-line i:nth-child(3){background:#FBBC05}
.vo-line i:nth-child(4){background:#34A853}
.vo-root[data-state=listening] .vo-line i,.vo-root[data-state=thinking] .vo-line i{animation:vo-bounce 1s ease-in-out infinite}
.vo-root[data-state=listening] .vo-line i:nth-child(2){animation-delay:.15s}
.vo-root[data-state=listening] .vo-line i:nth-child(3){animation-delay:.3s}
.vo-root[data-state=listening] .vo-line i:nth-child(4){animation-delay:.45s}
.vo-root[data-state=thinking] .vo-line i{animation-duration:.55s}
.vo-root[data-state=ok] .vo-line i{height:6px;background:#34A853}
.vo-root[data-state=maybe] .vo-line i{height:6px;background:#E65100}
@keyframes vo-in{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes vo-bounce{0%,100%{transform:scaleY(.55)}50%{transform:scaleY(1.5)}}
@keyframes vo-ping{0%{transform:scale(.95);opacity:.9}100%{transform:scale(1.45);opacity:0}}
@media (prefers-reduced-motion:reduce){
  .vo-root{animation:none}
  .vo-line i,.vo-ring{animation:none!important}
  .vo-line i{transition:none;transform:none!important}
}
`

export default function VoiceOverlay({
  open,
  state,
  level,
  pulse,
  text,
  hint,
  error,
  sound,
  onToggleSound,
  onMic,
  onClose,
  micIcon,
  children,
}: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const active = open && (state === 'listening' || state === 'thinking')
  const lvl = useDisplayLevel(active, level, pulse)
  const lineStyle = { '--lvl': lvl } as CSSProperties

  if (!mounted || !open) return null

  return createPortal(
    <div className="vo-root" role="dialog" aria-modal="true" aria-label="Voice order" data-state={state}>
      <style>{CSS}</style>

      <div className="vo-top">
        <span className="vo-brand">Chopdesk assistant</span>
        <button
          type="button"
          className="vo-icon"
          data-off={!sound}
          onClick={onToggleSound}
          aria-pressed={sound}
          aria-label={sound ? 'Spoken reply is on. Tap to turn off' : 'Spoken reply is off. Tap to turn on'}
        >
          {sound ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
        <button type="button" className="vo-done" onClick={onClose} aria-label="Close the assistant">
          <X size={18} />
          Done
        </button>
      </div>

      <div className="vo-body">
        <p className="vo-big" aria-live="polite">
          {text}
        </p>
        {error && <p className="vo-err">{error}</p>}
        {children && <div className="vo-cards">{children}</div>}
      </div>

      <div className="vo-bottom">
        <button type="button" className="vo-mic" onClick={onMic} aria-label="Start or stop listening">
          <span className="vo-ring" />
          {micIcon}
        </button>
        <p className="vo-hint">{hint}</p>
      </div>

      <div className="vo-line" style={lineStyle} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>,
    document.body
  )
}
