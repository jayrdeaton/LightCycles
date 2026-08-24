import { useAutoPaperTheme } from '@rific/auto-paper'
import { Stack } from 'expo-router'
import * as SystemUI from 'expo-system-ui'
import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Feedback } from '@/components/Feedback'
import { Fonts } from '@/components/Fonts'
import { Theme } from '@/components/Theme'
import { UpdateDialog } from '@/components/UpdateDialog'
import { GameSettingsProvider } from '@/hooks/useGameSettings'

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
        contentStyle: { backgroundColor: dark ? '#000000' : '#FFFFFF' },
      }}
    />
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Fonts>
          <Feedback>
            <Theme>
              <GameSettingsProvider>
                <AppStack />
                <UpdateDialog />
              </GameSettingsProvider>
            </Theme>
          </Feedback>
        </Fonts>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
