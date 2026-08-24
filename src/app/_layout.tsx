import { useAutoPaperTheme } from '@rific/auto-paper'
import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Feedback } from '@/components/Feedback'
import { Fonts } from '@/components/Fonts'
import { Theme } from '@/components/Theme'
import { UpdateDialog } from '@/components/UpdateDialog'
import { GameSettingsProvider } from '@/hooks/useGameSettings'

function AppStack() {
  const { dark } = useAutoPaperTheme()

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
        // Without this, the native screen container defaults to system white — every screen
        // paints its own themed background on an inner View, but that's inside this container,
        // so push/pop transitions briefly show white at the edges/corners underneath it.
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
