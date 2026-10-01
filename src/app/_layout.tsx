import { useAutoPaperTheme } from '@rific/auto-paper'
import { Toaster, ToastProvider } from '@rific/toaster'
import { OrientationProvider, RotationAwareStatusBar, SettingsAndProfilesGate, useThemedRootBackground } from '@tastic/core'
import * as Haptics from 'expo-haptics'
import { Stack } from 'expo-router'
import { DeviceMotion } from 'expo-sensors'
import { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as RNPaper from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Fonts } from '@/components/Fonts'
import { GuideHost } from '@/components/GuideHost'
import { Providers } from '@/components/Providers'
import { Theme } from '@/components/Theme'
import { UpdateDialog } from '@/components/UpdateDialog'
import { GameSettingsProvider, useGameSettings } from '@/hooks/useGameSettings'
import { GameStatsProvider } from '@/hooks/useGameStats'
import { ProfilesProvider, useProfiles } from '@/hooks/useProfiles'
import { SplashGate } from '@/utils/splashGate'

function AppStack() {
  const { dark } = useAutoPaperTheme()

  // gestureEnabled: false — iOS's native swipe-back gesture otherwise competes with
  // TouchInputLayer's own swipe-to-turn Pan gestures on /game (confirmed on-device: it
  // wins, silently kicking the player back to the title screen mid-round instead of
  // turning their cycle). Never surfaced on web, which has no such OS-level gesture. The
  // title screen has nothing to swipe back to either way, and /game has its own explicit
  // back button during onboarding.
  return <Stack screenOptions={useThemedRootBackground(dark, false)} />
}

// A sibling of AppStack, not a wrapper around it — calling useGameSettings() here rather than in
// RootLayout itself is what keeps every live tilt update from re-rendering the whole app tree
// (AppStack included) on every commit, the same isolation MatchOverlays uses in game.tsx for the
// identical reason.
//
// Renders @tastic/core's RotationAwareStatusBar with this app's own settings.lockOrientation
// threaded through (see that component's own doc for why locked must match whatever a screen's own
// useOrientationState(lockOrientation) call uses) — matches AirHockey's/BoxHockey's/Pong's/Snake's
// identical usage. /game's own conditional `extendIntoSafeArea` StatusBar (see that screen's own
// comment) still layers on top of this one while mounted — expo-status-bar's own stack reverts to
// whichever config is here once that more specific one unmounts.
function AppRotationAwareStatusBar() {
  const { settings } = useGameSettings()
  return <RotationAwareStatusBar locked={settings.lockOrientation} />
}

interface GatedAppProps {
  children: ReactNode
}

// GameSettingsProvider's own `settings` state is a plain useState with DEFAULT_SETTINGS baked in,
// only patched once an AsyncStorage read resolves — every screen below it reads `settings` straight
// off context, so a screen mounting before that patch lands would read (and could even briefly
// persist) the wrong values. ProfilesProvider's own `loaded` is the analogous flag for the one-time
// reconciliation against the shared App Group store (see useProfiles.tsx). Declared as a descendant
// of both providers themselves (rather than gating either provider's own mount from RootLayout) so
// both still mount immediately and start their own load right away — wrapping them from the outside
// instead would deadlock, since neither `loaded` could ever become true. GameStatsProvider sits
// between GameSettingsProvider and this gate, unchanged from before this gate existed — it depends
// on neither settings nor profiles, so nothing about its own mount timing needs to wait here either.
// @tastic/core's SettingsAndProfilesGate owns only the nesting/gate-name/fallback-default shape
// (settings outer, profiles inner, matching splashGate.ts's own gate list) — it can't call
// useGameSettings()/useProfiles() itself, since both are app-local hooks, hence this small wrapper.
function GatedApp({ children }: GatedAppProps) {
  const { loaded: settingsLoaded } = useGameSettings()
  const { loaded: profilesLoaded } = useProfiles()
  return (
    <SettingsAndProfilesGate Gate={SplashGate} settingsLoaded={settingsLoaded} profilesLoaded={profilesLoaded}>
      {children}
    </SettingsAndProfilesGate>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.flext}>
      <SafeAreaProvider>
        <Fonts>
          <Providers>
            <Theme>
              <GameSettingsProvider>
                <GameStatsProvider>
                  <ProfilesProvider>
                    {/* GameSettingsProvider/GameStatsProvider/ProfilesProvider above all mount
                    immediately and unconditionally, so all three start loading in parallel;
                    everything below this gate waits for both settings'/profiles' own `loaded`
                    flags — see GatedApp's own doc. */}
                    <GatedApp>
                      {/* Mounted once, here, rather than per-screen — see its own doc for why: a
                      single app-lifetime sensor subscription is what makes the committed orientation
                      survive screen navigation, instead of each screen's own hook instance
                      restarting from a default guess on every mount. */}
                      {/* @tastic/core's own OrientationProvider never imports expo-sensors itself (so
                      packages with no interest in tilt tracking aren't forced to have it installed) —
                      this app genuinely wants live tilt tracking, so it does its own real import and
                      hands the resolved module in via this prop. */}
                      <OrientationProvider deviceMotion={DeviceMotion}>
                        {/* Nested inside Theme so paper.useTheme() (called internally by Toaster/
                        ToastProvider once `paper` is injected) resolves the app's real live theme
                        rather than react-native-paper's own default — that's what makes a toast's
                        surface/text colors track light/dark and the player-color triad automatically,
                        with no manual color threading at each call site. */}
                        <ToastProvider haptics={Haptics} paper={RNPaper}>
                          {/* Wraps the stack (rather than sitting beside it like UpdateDialog) because
                          Home's useAutoShowGuide() and every Settings dialog's "How to play" row reach it
                          through context — see GuideHost's own doc. Must stay inside ToastProvider/
                          OrientationProvider: the card renders through a Portal and reads the live tilt. */}
                          <GuideHost>
                            <AppStack />
                          </GuideHost>
                          <AppRotationAwareStatusBar />
                          <UpdateDialog />
                          {/* historyButton/clearButton off — this app has no history modal use case
                          for them to open, and a stray control row above the toast stack for a
                          feature that goes nowhere is worse than just not offering it. limit is
                          already the package's own default (3); pinned explicitly so it stays 3
                          regardless of what that default does in a future toaster version. */}
                          <Toaster historyButton={null} clearButton={null} limit={3} />
                        </ToastProvider>
                      </OrientationProvider>
                    </GatedApp>
                  </ProfilesProvider>
                </GameStatsProvider>
              </GameSettingsProvider>
            </Theme>
          </Providers>
        </Fonts>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  flext: { flex: 1 }
})
