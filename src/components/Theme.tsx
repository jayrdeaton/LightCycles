import AsyncStorage from '@react-native-async-storage/async-storage'
import { getRgb, getThirdColor, Provider as AutoPaperProvider, ThemeSettings } from '@rific/auto-paper'
import * as SplashScreen from 'expo-splash-screen'
import { ReactNode, useCallback, useEffect, useState } from 'react'

import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR } from '@/constants/game'
import { useSplashReady } from '@/utils/splashGate'

SplashScreen.preventAutoHideAsync()

const APPEARANCE_STORAGE_KEY = 'lightcycles.appearance'
const PLAYER_COLORS_STORAGE_KEY = 'lightcycles.playerColors'

function triadFor(p1: string, p2: string) {
  return { primary: p1, secondary: p2, tertiary: getThirdColor(p1, p2) }
}

function isValidHex(value: unknown): value is string {
  return typeof value === 'string' && getRgb(value) !== null
}

interface Props {
  children: ReactNode
}

export function Theme({ children }: Props) {
  const [settings, setSettings] = useState<Partial<ThemeSettings> | null>(null)

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(APPEARANCE_STORAGE_KEY), AsyncStorage.getItem(PLAYER_COLORS_STORAGE_KEY)])
      .then(([storedAppearance, storedColors]) => {
        const appearance = storedAppearance === 'light' || storedAppearance === 'dark' || storedAppearance === 'system' ? storedAppearance : 'dark'

        let p1 = DEFAULT_P1_COLOR
        let p2 = DEFAULT_P2_COLOR
        if (storedColors) {
          try {
            const parsed = JSON.parse(storedColors)
            if (isValidHex(parsed.p1)) p1 = parsed.p1
            if (isValidHex(parsed.p2)) p2 = parsed.p2
          } catch {
            // Corrupt/stale blob — fall back to defaults above.
          }
        }
        // Two players sharing a color makes round-end pips/labels genuinely ambiguous (see
        // PLAN.md's color-uniqueness requirement) — only reachable here from a corrupted or
        // hand-edited storage blob, since the title screen's own pickers already prevent it going
        // forward, but still worth a safety fallback rather than silently rendering both players
        // identically.
        if (p1.toLowerCase() === p2.toLowerCase()) p2 = p2.toLowerCase() === DEFAULT_P1_COLOR.toLowerCase() ? DEFAULT_P2_COLOR : DEFAULT_P1_COLOR

        setSettings({ appearance, color: triadFor(p1, p2) })
      })
      .catch(() => {
        // A rejected read (corrupted native storage, quota issue, etc.) must still resolve this
        // state — leaving it null would hold the splash gate (see useSplashReady below) forever,
        // with no recovery short of reinstalling.
        setSettings({ appearance: 'dark', color: triadFor(DEFAULT_P1_COLOR, DEFAULT_P2_COLOR) })
      })
  }, [])

  // Loaded settings gate mounting AutoPaperProvider entirely (rather than mounting it immediately
  // with defaults and patching `initialValue` once the read resolves): AutoPaperProvider's own
  // `settings` state is a lazy useState(() => ...) that only reads `initialValue` on its very first
  // mount, so a changed `initialValue` prop on a later render is silently ignored — persistence
  // would appear to work (this component's own state updates) while the live theme never actually
  // picks it up. Splash stays up for this window regardless (see useSplashReady below), so gating
  // costs nothing visually.
  useSplashReady('theme', settings !== null)

  // Only persists — AutoPaperProvider owns the live settings after mount, and calling setSettings
  // here too would update this parent component while the provider (a child) is rendering.
  const onChange = useCallback((next: ThemeSettings) => {
    AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, next.appearance).catch(() => {})
    if (typeof next.color === 'object') {
      AsyncStorage.setItem(PLAYER_COLORS_STORAGE_KEY, JSON.stringify({ p1: next.color.primary, p2: next.color.secondary })).catch(() => {})
    }
  }, [])

  if (!settings) return null

  return (
    <AutoPaperProvider initialValue={settings} onChange={onChange}>
      {children}
    </AutoPaperProvider>
  )
}
