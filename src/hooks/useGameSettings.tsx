import { createGameSettingsProvider } from '@tastic/core'

import { GameSettings } from '@/types'
import { DEFAULT_SETTINGS, isValidSettings } from '@/utils/gameSettingsValidation'

// Single source of truth for game settings, mounted once in _layout.tsx. Every screen reads this
// same live instance via useGameSettings() below rather than each keeping its own AsyncStorage-
// backed copy — expo-router keeps prior screens mounted underneath when navigating forward, so a
// per-screen copy would go stale the moment another still-mounted screen changed a setting, and
// could even clobber that change by later writing its own stale snapshot back to storage. Mirrors
// Theme.tsx's own Provider pattern for the same reason.
//
// Was a hand-rolled GameSettingsProvider/useGameSettings pair (~100 LOC, byte-for-byte identical
// to AirHockey's/BoxHockey's/Pong's own copies apart from STORAGE_KEY and the settings shape
// itself) — now calls @tastic/core's shared factory instead. See that factory's own doc for what
// it provides (settings/setSettings, activeRoundSettings/commitRoundSettings, loaded,
// isActivelyPlaying/setIsActivelyPlaying, and the useEdgeGestureGuard wiring keyed off
// settings.deferBottomEdgeGestures) — this app's own DEFAULT_SETTINGS/isValidSettings from
// gameSettingsValidation.ts thread straight through unchanged.
export const { GameSettingsProvider, useGameSettings } = createGameSettingsProvider<GameSettings>({
  storageKey: 'lightcycles.settings',
  defaultSettings: DEFAULT_SETTINGS,
  isValidSettings
})
