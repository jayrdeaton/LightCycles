import { AutoAppearancePicker, Dialog, useAutoPaperTheme } from '@rific/auto-paper'
import { Button, TouchableRipple, useHapticSettings, useSoundSettings } from '@rific/feedback-press'
import { useUpdater } from '@rific/updater'
import { Platform, ScrollView, StyleSheet, View } from 'react-native'
import { Icon, SegmentedButtons, Text } from 'react-native-paper'

import { release } from '@/constants/release'
import { GameSettings } from '@/types'

interface SettingIconProps {
  source: string
  color: string
  containerColor: string
}

// Small colored badge per row (icon tinted on its own MD3 container color) — echoes the
// primary/secondary/tertiary triad that's already the app's own identity (derived from the two
// players' colors, see Theme.tsx), so the settings list picks up that same palette instead of
// introducing new colors of its own.
function SettingIcon({ source, color, containerColor }: SettingIconProps) {
  return (
    <View style={[styles.iconBadge, { backgroundColor: containerColor }]}>
      <Icon source={source} size={18} color={color} />
    </View>
  )
}

export interface SettingsDialogProps {
  visible: boolean
  onDismiss: () => void
  settings: GameSettings
  setSettings: (update: Partial<GameSettings>) => void
}

export function SettingsDialog({ visible, onDismiss, settings, setSettings }: SettingsDialogProps) {
  const { colors } = useAutoPaperTheme()
  const { settings: hapticSettings, set: setHapticSettings } = useHapticSettings()
  const { settings: soundSettings, set: setSoundSettings } = useSoundSettings()
  // autoCheck: false — the root layout (_layout.tsx) already runs the background check via its own
  // useUpdater() instance; a second instance with autoCheck's default (true) would set up a second
  // AppState listener and double every foreground-resume update check. This instance only ever
  // checks on an explicit tap of the button below.
  const { check, checking, updateReady } = useUpdater({ autoCheck: false, autoPrompt: false })

  return (
    <Dialog visible={visible} onDismiss={onDismiss} style={styles.dialog}>
      <Dialog.Title>Settings</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <TouchableRipple onPress={() => setSettings({ lockOrientation: !settings.lockOrientation })} style={styles.toggleButton} accessibilityLabel={`Lock orientation ${settings.lockOrientation ? 'on' : 'off'}`}>
            <View style={styles.toggleContent}>
              <SettingIcon source={settings.lockOrientation ? 'lock' : 'lock-open-variant-outline'} color={settings.lockOrientation ? colors.secondary : colors.onSurfaceVariant} containerColor={settings.lockOrientation ? colors.secondaryContainer : colors.surfaceVariant} />
              <View style={styles.flexShrink}>
                <Text variant='bodyLarge' style={{ color: colors.onSurface }}>
                  Lock Orientation
                </Text>
                <Text variant='bodySmall' numberOfLines={1} style={{ color: colors.onSurfaceVariant }}>
                  Pins the current layout
                </Text>
              </View>
            </View>
          </TouchableRipple>

          <View style={styles.section}>
            <Text variant='labelMedium' style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>
              APPEARANCE
            </Text>
            <AutoAppearancePicker showLabels={false} />
          </View>

          <View style={styles.section}>
            <Text variant='labelMedium' style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>
              SOUND & HAPTICS
            </Text>
            <SegmentedButtons
              multiSelect
              value={[...(soundSettings.enabled ? ['sound'] : []), ...(Platform.OS !== 'web' && hapticSettings.vibrate ? ['haptics'] : [])]}
              onValueChange={(values) => {
                setSoundSettings({ enabled: values.includes('sound') })
                if (Platform.OS !== 'web') setHapticSettings({ vibrate: values.includes('haptics') })
              }}
              buttons={[{ value: 'sound', icon: 'volume-high', accessibilityLabel: 'Sound' }, ...(Platform.OS !== 'web' ? [{ value: 'haptics', icon: 'vibrate', accessibilityLabel: 'Haptics' }] : [])]}
            />
          </View>

          <View style={styles.section}>
            <Text variant='labelSmall' style={[styles.sectionLabel, { color: colors.onSurfaceVariant }]}>
              VERSION {release.otaVersion}
              {updateReady ? ' · UPDATE READY' : ''}
            </Text>
            <Button mode='outlined' onPress={check} loading={checking} disabled={checking}>
              Check for Updates
            </Button>
          </View>
        </ScrollView>
      </Dialog.ScrollArea>
    </Dialog>
  )
}

const styles = StyleSheet.create({
  content: {
    gap: 24,
    paddingVertical: 20
  },
  // Caps the card so it never grows past the screen — without this the dialog just keeps
  // growing to fit its content and the overflow gets clipped by the screen edge, which is
  // what happened in landscape where there's less height to work with. Dialog.ScrollArea +
  // ScrollView below then take over and let the content scroll within that bound.
  dialog: {
    maxHeight: '90%'
  },
  flexShrink: {
    flexShrink: 1
  },
  iconBadge: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36
  },
  section: {
    gap: 12
  },
  sectionLabel: {
    letterSpacing: 2
  },
  // Negative margin cancels the padding so the icon still lines up with APPEARANCE/SOUND &
  // HAPTICS below, while the ripple/hover highlight itself gets room to breathe on both sides
  // instead of a flush edge-to-edge slab. overflow: 'hidden' makes sure that highlight actually
  // clips to borderRadius instead of drawing as a plain rectangle.
  toggleButton: {
    borderRadius: 12,
    marginHorizontal: -12,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  toggleContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12
  }
})
