import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Feedback } from '@/components/Feedback'
import { Fonts } from '@/components/Fonts'
import { Theme } from '@/components/Theme'
import { UpdateDialog } from '@/components/UpdateDialog'
import { GameSettingsProvider } from '@/hooks/useGameSettings'

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Fonts>
          <Feedback>
            <Theme>
              <GameSettingsProvider>
                {/* gestureEnabled: false — iOS's native swipe-back gesture otherwise competes with
                TouchInputLayer's own swipe-to-turn Pan gestures on /game (confirmed on-device: it
                wins, silently kicking the player back to the title screen mid-round instead of
                turning their cycle). Never surfaced on web, which has no such OS-level gesture. The
                title screen has nothing to swipe back to either way, and /game has its own explicit
                back button during onboarding. */}
                <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />
                <UpdateDialog />
              </GameSettingsProvider>
            </Theme>
          </Feedback>
        </Fonts>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
