import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEdgeGestureGuard } from '@tastic/edge-guard'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'

import { GameSettings } from '@/types'
import { DEFAULT_SETTINGS, isValidSettings } from '@/utils/gameSettingsValidation'

const STORAGE_KEY = 'lightcycles.settings'

interface GameSettingsContextValue {
  settings: GameSettings
  setSettings: (update: Partial<GameSettings>) => void
  // The snapshot /lobby locks in for the round about to start, as opposed to `settings` above
  // (the editable, persisted "next round" defaults) — see commitRoundSettings below.
  activeRoundSettings: GameSettings | null
  commitRoundSettings: (settings: GameSettings) => void
  // Held only in memory, never persisted, same as activeRoundSettings above — game.tsx's own report
  // of whether a round is actually in progress right now (state.phase === 'playing'), read by this
  // provider's own useEdgeGestureGuard call below. See that call's own doc for why it lives here
  // rather than in game.tsx directly.
  isActivelyPlaying: boolean
  setIsActivelyPlaying: (value: boolean) => void
}

const GameSettingsContext = createContext<GameSettingsContextValue | null>(null)

interface Props {
  children: ReactNode
}

// Single source of truth for game settings, mounted once in _layout.tsx. Every screen reads this
// same live instance via useGameSettings() below rather than each keeping its own AsyncStorage-
// backed copy — expo-router keeps prior screens mounted underneath when navigating forward, so a
// per-screen copy would go stale the moment another still-mounted screen changed a setting, and
// could even clobber that change by later writing its own stale snapshot back to storage. Mirrors
// Theme.tsx's own Provider pattern for the same reason.
export function GameSettingsProvider({ children }: Props) {
  const [settings, setSettingsState] = useState<GameSettings>(DEFAULT_SETTINGS)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!stored) return
        try {
          const parsed = JSON.parse(stored)
          if (isValidSettings(parsed)) setSettingsState(parsed)
        } catch {
          // Corrupt/stale blob — keep defaults.
        }
      })
      .catch(() => {
        // Unavailable storage — nothing gates on this (unlike Theme.tsx/Haptic.tsx), so keeping
        // DEFAULT_SETTINGS already in state is a complete, silent fallback.
      })
  }, [])

  const setSettings = useCallback((update: Partial<GameSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...update }
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  // Held only in memory, never persisted — /game reads this once at mount (see game.tsx) to lock
  // in the round it's about to play, so a settings-dialog edit made mid-round (which only ever
  // touches `settings` above) can't retroactively change a round already underway.
  const [activeRoundSettings, setActiveRoundSettings] = useState<GameSettings | null>(null)
  const commitRoundSettings = useCallback((next: GameSettings) => setActiveRoundSettings(next), [])

  // Also held only in memory, never persisted — see its own doc on GameSettingsContextValue above.
  const [isActivelyPlaying, setIsActivelyPlaying] = useState(false)

  // Mounted once, permanently, here at the provider — not scoped to game.tsx. Combining the
  // persisted setting with game.tsx's own live isActivelyPlaying report, in the one place this
  // hook is ever called, is what keeps Edge Guard both a real opt-in AND scoped to actual gameplay,
  // without needing the hook itself mounted/unmounted per screen.
  useEdgeGestureGuard(settings.deferBottomEdgeGestures && isActivelyPlaying)

  return <GameSettingsContext.Provider value={{ settings, setSettings, activeRoundSettings, commitRoundSettings, isActivelyPlaying, setIsActivelyPlaying }}>{children}</GameSettingsContext.Provider>
}

export function useGameSettings() {
  const ctx = useContext(GameSettingsContext)
  if (!ctx) throw new Error('useGameSettings must be used within a GameSettingsProvider')
  return ctx
}
