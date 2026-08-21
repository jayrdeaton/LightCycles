import { useEffect, useState } from 'react'

// Below this, treat the layout as phone-shaped regardless of what the pointer/touch APIs report —
// a real desktop browser window is essentially never this narrow, but plenty of touch-capable
// testing/preview environments (and some real devices) don't reliably report a coarse pointer.
const NARROW_WIDTH_BREAKPOINT = 700

function computeIsTouchPrimary(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  if (window.innerWidth < NARROW_WIDTH_BREAKPOINT) return true
  if (!window.matchMedia) return navigator.maxTouchPoints > 0
  return navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches
}

// Best-effort proxy for "no physical keyboard, don't bother offering the keyboard-scheme picker" —
// there's no public web API that reports keyboard presence itself, so this leans on touch-primary
// pointer plus a narrow-viewport fallback as the closest available signals. It will false-negative
// (hide the picker) on a wide-screen device with a paired keyboard that still reports a coarse
// pointer; swipe input remains available regardless, so that's a missed picker, not a broken game.
// Live-updated via matchMedia and window resize so a runtime change re-evaluates.
export function useIsTouchPrimaryDevice(): boolean {
  const [isTouchPrimary, setIsTouchPrimary] = useState(computeIsTouchPrimary)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setIsTouchPrimary(computeIsTouchPrimary())
    window.addEventListener('resize', update)
    const mql = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null
    mql?.addEventListener('change', update)
    return () => {
      window.removeEventListener('resize', update)
      mql?.removeEventListener('change', update)
    }
  }, [])

  return isTouchPrimary
}
