import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton } from '@rific/feedback-press'
import { router } from 'expo-router'
import * as ScreenOrientation from 'expo-screen-orientation'
import { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { AnimatedHeroTitle } from '@/components/AnimatedHeroTitle'
import { SettingsDialog } from '@/components/SettingsDialog'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useOrientationLock } from '@/hooks/useOrientationLock'
import { GameMode, GameSettings } from '@/types'

export default function HomeScreen() {
  // The title screen is always a single, un-split surface both players read right-side-up
  // together — locked to portrait regardless of the chosen in-round orientation mode, which only
  // takes effect once /game mounts its own lock.
  useOrientationLock(ScreenOrientation.OrientationLock.PORTRAIT_UP)

  const { settings, setSettings } = useGameSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { colors, dark } = useAutoPaperTheme()

  // High-contrast retro look: literal black/white, flipped by appearance, rather than auto-paper's
  // own (slightly tinted) background role.
  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  // Matches every other screen's own back-button/icon-row treatment (lobby.tsx, game.tsx,
  // achievements.tsx) — a plain muted icon, not a filled FAB chip.
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

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
      <IconButton icon='cog' iconColor={fgMuted} size={24} style={styles.topRight} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />

      <AnimatedHeroTitle color={fg} p1Color={colors.primary} p2Color={colors.secondary} />

      <View style={styles.actions}>
        <Button mode='contained' icon='robot' onPress={() => chooseMode('vsCpu')} style={styles.actionButton}>
          One Player
        </Button>
        <Button mode='contained' icon='account-multiple' onPress={() => chooseMode('twoPlayer')} style={styles.actionButton} buttonColor={colors.secondary} textColor={colors.onSecondary}>
          Two Player
        </Button>
      </View>

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} settings={settings} setSettings={setSettings} />
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
    alignItems: 'center',
    flex: 1,
    gap: 48,
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
