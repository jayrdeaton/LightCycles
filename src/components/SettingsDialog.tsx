import { useUpdateErrorToast } from '@rific/toaster'
import type { ViewRotation } from '@tastic/core'
import { BaseSettingsDialog } from '@tastic/hud'
import { useGuide } from '@tastic/hud/guide'

import { release } from '@/constants/release'
import { GameSettings } from '@/types'

export interface SettingsDialogProps {
  visible: boolean
  onDismiss: () => void
  settings: GameSettings
  setSettings: (update: Partial<GameSettings>) => void
  // Live physical-hold rotation (see @tastic/core's getViewRotation) — this is a centered,
  // app-wide modal with no per-player zone to match (unlike OnboardingOverlay/RoundOverDialog), so
  // it just rotates its own content in place; defaults to 0 for call sites that don't have a live
  // orientation signal handy (there's nothing else for it to stay consistent with).
  rotation?: ViewRotation
  // Shows the "How to play" row that replays the intro. Off by default: the in-game (/game) dialog
  // leaves it out, since opening a full-screen guide over a live match (settings there already
  // pauses play) is disruptive — Home and the lobby, where nothing is running, turn it on.
  showHowToPlay?: boolean
}

// Thin adapter over @tastic/hud's shared settings shell — LightCycles' own GameSettings (lock
// orientation, edge guard) is the only thing that varies here; everything else (sound, haptics,
// appearance, update checking) is identical across every app using BaseSettingsDialog and lives
// entirely inside that package now. Keeps this file's own external props unchanged so none of its
// three call sites (index.tsx, lobby.tsx, game.tsx) needed to change.
export function SettingsDialog({ visible, onDismiss, settings, setSettings, rotation = 0, showHowToPlay = false }: SettingsDialogProps) {
  const { open: openGuide } = useGuide()
  return <BaseSettingsDialog visible={visible} onDismiss={onDismiss} rotation={rotation} version={release.otaVersion} lockOrientation={settings.lockOrientation} onLockOrientationChange={(value) => setSettings({ lockOrientation: value })} deferBottomEdgeGestures={settings.deferBottomEdgeGestures} onDeferBottomEdgeGestures={(value) => setSettings({ deferBottomEdgeGestures: value })} onUpdateError={useUpdateErrorToast()} onShowHowToPlay={showHowToPlay ? openGuide : undefined} />
}
