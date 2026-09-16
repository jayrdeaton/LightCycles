import { Provider as AutoPaperProvider, themeActions, ThemeSettings } from '@rific/auto-paper'
import * as SplashScreen from 'expo-splash-screen'
import { ReactNode, useCallback } from 'react'
import Reanimated from 'react-native-reanimated'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import { MONO_FONT } from '@/constants/fonts'
import { type AppDispatch, type RootState } from '@/redux/store'
import { useSplashReady } from '@/utils/splashGate'

SplashScreen.preventAutoHideAsync()
// iOS defaults `fade` to false (Android always fades regardless of this flag), so without this the
// splash view is just yanked off screen the instant every gate reports ready.
SplashScreen.setOptions({ fade: true, duration: 400 })

interface Props {
  children: ReactNode
}

export function Theme({ children }: Props) {
  // Redux-backed now (redux/store.ts's `theme` key, @rific/auto-paper's own createThemeReducer,
  // seeded with this app's own DEFAULT_P1_COLOR/DEFAULT_P2_COLOR and 'dark' appearance) rather than
  // a local AsyncStorage read — PersistGate (see components/Providers.tsx) already blocks the whole
  // app from rendering until redux-persist has rehydrated, so `settings` here is already the real
  // persisted value (or the seeded default above) from this component's very first render, with no
  // async load state of its own to track anymore.
  const settings = useSelector((state: RootState) => state.theme, shallowEqual)
  const dispatch = useDispatch<AppDispatch>()

  // PersistGate already resolved this by the time Theme mounts (see `settings` above) — this gate
  // is always instantly ready, same as Providers.tsx's own haptics/sound gates once those moved to
  // Redux.
  useSplashReady('theme', true)

  // Fully persists the live theme (appearance, color triad, plus auto-paper's own blur/harmony)
  // straight to Redux on every change, matching Snake's own Theme.tsx. This used to deliberately
  // persist only `appearance`, never `color`: it fired on every live theme change regardless of
  // *why* the color changed, which meant a profile-seat's clash-swap or manual recolor (a
  // transient, per-match override — see lobby.tsx) silently overwrote the cold-boot color default
  // with a color the profile itself never saved, and a CPU seat's color fought over the same slot
  // as a human guest's. That's no longer a concern now that lobby.tsx owns a *dedicated* "remember
  // this for next time" memory of its own (redux/seatColorsSlice.ts's lastGuestColor/lastCpuColor,
  // written explicitly wherever a guest/CPU color actually changes) — this slice is now just a
  // harmless, redundant boot-seed of whatever the live theme last was, exactly like Snake's own
  // `theme` slice.
  const onChange = useCallback((next: ThemeSettings) => dispatch(themeActions.initialize(next)), [dispatch])

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
