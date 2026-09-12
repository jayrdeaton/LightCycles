import { useAutoPaperTheme } from '@rific/auto-paper'
import { Toaster, ToastProvider } from '@rific/toaster'
import { getViewRotation, OrientationProvider, useOrientationState } from '@tastic/core'
import * as Haptics from 'expo-haptics'
import { Stack } from 'expo-router'
import { DeviceMotion } from 'expo-sensors'
import { StatusBar } from 'expo-status-bar'
import * as SystemUI from 'expo-system-ui'
import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as RNPaper from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Feedback } from '@/components/Feedback'
import { Fonts } from '@/components/Fonts'
import { Theme } from '@/components/Theme'
import { UpdateDialog } from '@/components/UpdateDialog'
import { GameSettingsProvider } from '@/hooks/useGameSettings'
import { GameStatsProvider } from '@/hooks/useGameStats'
import { ProfilesProvider } from '@/hooks/useProfiles'

// Matches Theme.tsx's own 'dark' fallback for the window before settings load — react-native-screens'
// push/pop transition animates the two screens' native views directly over this root window, so
// whatever it's left at (white, by default) shows through at the corners for the duration of the
// transition, wherever the sliding content hasn't yet caught up to the display's rounded-corner mask.
SystemUI.setBackgroundColorAsync('#000000')

function AppStack() {
  const { dark } = useAutoPaperTheme()

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(dark ? '#000000' : '#FFFFFF')
  }, [dark])

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // gestureEnabled: false — iOS's native swipe-back gesture otherwise competes with
        // TouchInputLayer's own swipe-to-turn Pan gestures on /game (confirmed on-device: it
        // wins, silently kicking the player back to the title screen mid-round instead of
        // turning their cycle). Never surfaced on web, which has no such OS-level gesture. The
        // title screen has nothing to swipe back to either way, and /game has its own explicit
        // back button during onboarding.
        gestureEnabled: false,
        // Screen-level backing, separate from the root window background set via SystemUI above.
        contentStyle: { backgroundColor: dark ? '#000000' : '#FFFFFF' }
      }}
    />
  )
}

// A sibling of AppStack, not a wrapper around it — calling useAccelerometerOrientation() here
// rather than in RootLayout itself is what keeps every live tilt update from re-rendering the whole
// app tree (AppStack included) on every commit, the same isolation MatchOverlays uses in game.tsx
// for the identical reason.
//
// The real OS status bar can't rotate with our own virtual content rotation (see @tastic/core's
// getViewRotation/@tastic/split-screen's FakeLandscapeView) — it's always pinned to the device's own
// physical top edge — so once anything on screen is rotated away from normal right-side-up portrait,
// it just reads as visually wrong (overlapping rotated content, sitting on a side edge in landscape,
// etc.) rather than blending in. Hiding it whenever the live rotation isn't 0° sidesteps that
// entirely. /game's own conditional `extendIntoSafeArea` StatusBar (see that screen's own comment)
// still layers on top of this one while mounted — expo-status-bar's own stack reverts to whichever
// config is here once that more specific one unmounts.
function RotationAwareStatusBar() {
  const { orientationMode, p1OnRight, upsideDown } = useOrientationState()
  const rotation = getViewRotation(orientationMode, p1OnRight, upsideDown)
  return <StatusBar hidden={rotation !== 0} />
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.flext}>
      <SafeAreaProvider>
        <Fonts>
          <Feedback>
            <Theme>
              <GameSettingsProvider>
                <GameStatsProvider>
                  <ProfilesProvider>
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
                        <AppStack />
                        <RotationAwareStatusBar />
                        <UpdateDialog />
                        {/* historyButton/clearButton off — this app has no history modal use case
                        for them to open, and a stray control row above the toast stack for a
                        feature that goes nowhere is worse than just not offering it. limit is
                        already the package's own default (3); pinned explicitly so it stays 3
                        regardless of what that default does in a future toaster version. */}
                        <Toaster historyButton={null} clearButton={null} limit={3} />
                      </ToastProvider>
                    </OrientationProvider>
                  </ProfilesProvider>
                </GameStatsProvider>
              </GameSettingsProvider>
            </Theme>
          </Feedback>
        </Fonts>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  flext: { flex: 1 }
})
