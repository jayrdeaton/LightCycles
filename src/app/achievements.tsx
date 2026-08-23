import { useAutoPaperTheme } from '@rific/auto-paper'
import { IconButton } from '@rific/feedback-press'
import { StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { MONO_FONT } from '@/constants/fonts'
import { useOrientationLock } from '@/hooks/useOrientationLock'
import { safeBack } from '@/utils/navigation'

export default function AchievementsScreen() {
  // No game content here to rotate for — always locked portrait, regardless of the Lock
  // Orientation setting or how the phone is currently held.
  useOrientationLock(true, 'faceToFace')

  const { dark } = useAutoPaperTheme()
  const insets = useSafeAreaInsets()
  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <IconButton icon='arrow-left' iconColor={fg} size={24} style={[styles.back, { top: 8 + insets.top, left: 8 + insets.left }]} onPress={safeBack} />

      <Text variant='displaySmall' style={[styles.title, { color: fg, fontFamily: MONO_FONT }]}>
        Achievements
      </Text>
      <Text variant='bodyLarge' style={[{ color: fgMuted, fontFamily: MONO_FONT }]}>
        Coming Soon
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  back: {
    left: 8,
    position: 'absolute',
    top: 8
  },
  container: {
    alignItems: 'center',
    flex: 1,
    gap: 16,
    justifyContent: 'center'
  },
  title: {
    fontWeight: 'bold'
  }
})
