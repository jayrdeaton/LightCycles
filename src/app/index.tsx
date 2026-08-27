import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton } from '@rific/feedback-press'
import { FakeLandscapeView, getViewRotation, rotateInsets, useAccelerometerOrientation } from '@tastic/split-screen'
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AnimatedHeroTitle } from '@/components/AnimatedHeroTitle'
import { SettingsDialog } from '@/components/SettingsDialog'
import { useGameSettings } from '@/hooks/useGameSettings'
import { GameMode } from '@/types'

export default function HomeScreen() {
  const { settings, setSettings } = useGameSettings()
  // No P1/P2 concept on this screen at all, but the rotation angle itself still needs the real
  // p1OnRight reading (which direction the device was actually turned) to pick the correct sign —
  // see @tastic/split-screen's FakeLandscapeView/getViewRotation.
  const { orientationMode, p1OnRight, upsideDown } = useAccelerometerOrientation(settings.lockOrientation)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const { colors, dark } = useAutoPaperTheme()
  const rotation = getViewRotation(orientationMode, p1OnRight, upsideDown)
  // See lobby.tsx's identical comment: react-native-safe-area-context always reports insets
  // relative to the device's own fixed physical frame, so they need remapping onto whichever edge
  // they actually correspond to once FakeLandscapeView below visually rotates the content.
  const rotatedInsets = rotateInsets(useSafeAreaInsets(), rotation)

  // High-contrast retro look: literal black/white, flipped by appearance, rather than auto-paper's
  // own (slightly tinted) background role.
  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'

  // Folds in what the old /mode-select screen's chooseMode() did — that screen only ever picked
  // gameMode, so its whole job now fits on two buttons here instead of a separate hop.
  const chooseMode = useCallback(
    (gameMode: GameMode) => {
      setSettings({ gameMode })
      router.push({ pathname: '/lobby', params: { gameMode } })
    },
    [setSettings]
  )

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Reads correctly no matter which way the phone is actually being held — see
      @tastic/split-screen's FakeLandscapeView. SettingsDialog stays outside it (a centered
      Portal-rendered modal isn't affected by a local transform on an ancestor) but still gets the
      same live `rotation` passed directly, rotating its own content in place instead. */}
      <FakeLandscapeView orientationMode={orientationMode} p1OnRight={p1OnRight} upsideDown={upsideDown} style={styles.rotatable}>
        <IconButton icon='trophy' iconColor={fg} size={24} style={[styles.topLeft, { top: 8 + rotatedInsets.top, left: 8 + rotatedInsets.left }]} onPress={() => router.push('/achievements')} accessibilityLabel='Stats & Achievements' />
        <IconButton icon='cog' iconColor={fg} size={24} style={[styles.topRight, { top: 8 + rotatedInsets.top, right: 8 + rotatedInsets.right }]} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />

        <AnimatedHeroTitle color={fg} p1Color={colors.primary} p2Color={colors.secondary} />

        <View style={styles.actions}>
          <Button mode='contained' icon='robot' onPress={() => chooseMode('vsCpu')} style={styles.actionButton}>
            One Player
          </Button>
          <Button mode='contained' icon='account-multiple' onPress={() => chooseMode('twoPlayer')} style={styles.actionButton} buttonColor={colors.secondary} textColor={colors.onSecondary}>
            Two Player
          </Button>
        </View>
      </FakeLandscapeView>

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} settings={settings} setSettings={setSettings} rotation={rotation} />
    </View>
  )
}

const styles = StyleSheet.create({
  actionButton: {
    minWidth: 180
  },
  actions: {
    alignItems: 'center',
    gap: 16
  },
  container: {
    flex: 1
  },
  // Owns the flex-centering layout `container` used to apply directly — now one level deeper,
  // since everything visible sits inside FakeLandscapeView, which needs a real (not shrink-wrapped)
  // full-bleed box to size its own absolutely-positioned children (the trophy/settings buttons)
  // against correctly.
  rotatable: {
    alignItems: 'center',
    flex: 1,
    gap: 72,
    justifyContent: 'center'
  },
  topLeft: {
    left: 8,
    position: 'absolute',
    top: 8
  },
  topRight: {
    position: 'absolute',
    right: 8,
    top: 8
  }
})
