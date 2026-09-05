import AsyncStorage from '@react-native-async-storage/async-storage'
import { getRgb, getThirdColor, Provider as AutoPaperProvider, ThemeSettings } from '@rific/auto-paper'
import * as SplashScreen from 'expo-splash-screen'
import { ReactNode, useCallback, useEffect, useState } from 'react'
import Reanimated from 'react-native-reanimated'

import { MONO_FONT } from '@/constants/fonts'
import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR } from '@/constants/game'
import { useSplashReady } from '@/utils/splashGate'

SplashScreen.preventAutoHideAsync()
// iOS defaults `fade` to false (Android always fades regardless of this flag), so without this the
// splash view is just yanked off screen the instant every gate reports ready.
SplashScreen.setOptions({ fade: true, duration: 400 })

const APPEARANCE_STORAGE_KEY = 'lightcycles.appearance'
// Exported: this is also the guest-color slot lobby.tsx's useSeatColors.tsx persists to (see its
// own doc) — the two are deliberately the same key/shape rather than a redundant third one, since a
// guest's own color IS what this cold-boot read is seeding before any seat-aware screen exists.
export const PLAYER_COLORS_STORAGE_KEY = 'lightcycles.playerColors'

function triadFor(p1: string, p2: string) {
  return { primary: p1, secondary: p2, tertiary: getThirdColor(p1, p2) }
}

export function isValidHex(value: unknown): value is string {
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
  //
  // Deliberately does NOT persist next.color here anymore: this fired on every live theme change
  // regardless of *why* the color changed, which meant a profile-seat's clash-swap or manual
  // recolor (a transient, per-match override — see lobby.tsx) silently overwrote this blob with a
  // color the profile itself never saved, and a CPU seat's color fought over the exact same slot as
  // a human guest's. Only lobby.tsx knows which seat is a profile/guest/CPU right now, so it's the
  // one place set up to persist a seat's color correctly (see its own useSeatColors.tsx) — this
  // still only ever seeds the cold-boot default from whatever that logic last wrote here.
  const onChange = useCallback((next: ThemeSettings) => {
    AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, next.appearance).catch(() => {})
  }, [])

  if (!settings) return null

  return (
    // reanimated={Reanimated} is what makes Dialog's own animatedStyle prop do anything at all (see
    // its source: `reanimated && animatedStyle ? <reanimated.View style={animatedStyle}>...` —
    // without this injection, animatedStyle is silently a no-op on every Dialog in the app, not
    // just one of them). Metro doesn't rewrite a require()-in-try/catch into its module graph for
    // this package's ESM build, so the already-imported peer module has to be handed in explicitly
    // like this instead of @rific/auto-paper importing it directly.
    // Applies MONO_FONT to every Paper typography variant app-wide — previously threaded through
    // fontFamily: MONO_FONT on nearly every individual Text/TextInput this app renders (achievements,
    // ProfileChip, ProfilePicker, ProfilesManager, LabeledDropdown, OnboardingOverlay); those explicit
    // overrides are now redundant (though harmless if any remain) since the theme itself supplies it.
    <AutoPaperProvider initialValue={settings} onChange={onChange} reanimated={Reanimated} fontFamily={MONO_FONT}>
      {children}
    </AutoPaperProvider>
  )
}
