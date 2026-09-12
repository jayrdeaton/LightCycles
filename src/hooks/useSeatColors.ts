import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useRef, useState } from 'react'

import { isValidHex, PLAYER_COLORS_STORAGE_KEY } from '@/components/Theme'
import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR } from '@/constants/game'
import { Player } from '@/types'

// Separate from PLAYER_COLORS_STORAGE_KEY on purpose — a CPU seat's color has never had anywhere
// of its own to persist to before now (see lobby.tsx's own doc for the conflation that caused).
// Only ever relevant to seat 2 (CPU always plays player 2 — see cpuAi.ts's CPU_PLAYER), but keyed
// as a plain hex string rather than a per-seat record for that reason, unlike the guest slot below.
const CPU_COLOR_STORAGE_KEY = 'lightcycles.cpuColor'

interface SeatColorsState {
  guestColors: Record<Player, string>
  cpuColor: string
  // False until the AsyncStorage reads below resolve — lobby.tsx holds off reapplying its own
  // mount/reapply effect until this flips true, so a not-yet-loaded default never gets written back
  // over a real persisted value it just hasn't read yet.
  loaded: boolean
}

const INITIAL_STATE: SeatColorsState = {
  guestColors: { 1: DEFAULT_P1_COLOR, 2: DEFAULT_P2_COLOR },
  cpuColor: DEFAULT_P2_COLOR,
  loaded: false
}

// Per-seat color persistence for lobby.tsx, split by what's actually occupying the seat right now
// — a profile seat is handled entirely in lobby.tsx itself (transient, never persisted here at
// all); this only covers the other two, each getting its own remembered value: a human "guest"
// seat (reusing Theme.tsx's own PLAYER_COLORS_STORAGE_KEY — see that file's own doc for why that's
// the right slot to reuse) and a CPU seat (CPU_COLOR_STORAGE_KEY above, entirely independent so the
// two stop fighting over one shared value).
export function useSeatColors() {
  const [state, setState] = useState<SeatColorsState>(INITIAL_STATE)
  // Set by setGuestColor/setCpuColor the moment a player actually picks a color, so the load effect
  // below knows not to clobber it if its own AsyncStorage read is still in flight — a real (if
  // narrow) race on a slow/cold-start read: a tap can land, and be applied via a functional update,
  // before this effect's Promise.all resolves and would otherwise overwrite it with the stale
  // pre-tap on-disk value.
  const guestTouchedRef = useRef(false)
  const cpuTouchedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([AsyncStorage.getItem(PLAYER_COLORS_STORAGE_KEY), AsyncStorage.getItem(CPU_COLOR_STORAGE_KEY)])
      .then(([storedGuest, storedCpu]) => {
        if (cancelled) return
        let p1 = DEFAULT_P1_COLOR
        let p2 = DEFAULT_P2_COLOR
        if (storedGuest) {
          try {
            const parsed = JSON.parse(storedGuest)
            if (isValidHex(parsed.p1)) p1 = parsed.p1
            if (isValidHex(parsed.p2)) p2 = parsed.p2
          } catch {
            // Corrupt/stale blob — fall back to defaults above, same as Theme.tsx's own read.
          }
        }
        // Per-field guarded, not a blanket skip-the-whole-load-if-anything-was-touched: a tap on the
        // guest swatch shouldn't also throw away a real persisted CPU color this same load was about
        // to seed, and vice versa.
        //
        // A CPU color that's never been explicitly set seeds from the guest p2 slot above (the same
        // secondary color already driving the cold-boot theme in Theme.tsx), not the hardcoded
        // DEFAULT_P2_COLOR — otherwise the very first trip into vsCpu mode after this seat gained its
        // own storage slot would visibly clobber an already-customized secondary with stock red,
        // instead of it just carrying over until the player picks a CPU color of its own.
        setState((prev) => ({
          guestColors: guestTouchedRef.current ? prev.guestColors : { 1: p1, 2: p2 },
          cpuColor: cpuTouchedRef.current ? prev.cpuColor : isValidHex(storedCpu) ? storedCpu : p2,
          loaded: true
        }))
      })
      .catch(() => {
        // Unavailable storage — INITIAL_STATE's defaults are a complete, silent fallback; still
        // flip loaded so lobby.tsx's own effect stops waiting on a read that's never coming.
        if (!cancelled) setState((prev) => ({ ...prev, loaded: true }))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setGuestColor = useCallback((seat: Player, hex: string) => {
    guestTouchedRef.current = true
    setState((prev) => {
      const guestColors = { ...prev.guestColors, [seat]: hex }
      AsyncStorage.setItem(PLAYER_COLORS_STORAGE_KEY, JSON.stringify({ p1: guestColors[1], p2: guestColors[2] })).catch(() => {})
      return { ...prev, guestColors }
    })
  }, [])

  const setCpuColor = useCallback((hex: string) => {
    cpuTouchedRef.current = true
    AsyncStorage.setItem(CPU_COLOR_STORAGE_KEY, hex).catch(() => {})
    setState((prev) => ({ ...prev, cpuColor: hex }))
  }, [])

  return { guestColors: state.guestColors, cpuColor: state.cpuColor, loaded: state.loaded, setGuestColor, setCpuColor }
}
