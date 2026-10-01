import AsyncStorage from '@react-native-async-storage/async-storage'
import { combineReducers, configureStore, type Middleware } from '@reduxjs/toolkit'
import { createThemeReducer, getThirdColor } from '@rific/auto-paper'
import { defaultSoundSettings, hapticReducer, soundReducer, type SoundSettings } from '@rific/feedback-press'
import { createReturningPlayerMigrate } from '@tastic/hud/guide'
import { profilesReducer } from '@tastic/profile'
import { FLUSH, PAUSE, PERSIST, persistReducer, persistStore, PURGE, REGISTER, REHYDRATE } from 'redux-persist'

import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR } from '@/constants/game'

import guide, { LEGACY_STORAGE_KEYS } from './guideSlice'
import profileExtensions from './profileExtensionsSlice'
import profileSelection from './profileSelectionSlice'
import seatColors from './seatColorsSlice'

const hasError = (action: unknown): action is { error?: unknown } => typeof action === 'object' && action !== null && 'error' in action && Boolean(action.error)

const errorMiddleware: Middleware = () => (next) => (action) => {
  if (!hasError(action)) return next(action)
  return action
}

// @rific/feedback-press's own soundReducer defaults `enabled` to true unconditionally (that
// default isn't published with the dev-only override yet). Wrap it so a fresh install with no
// persisted preference (redux-persist finds nothing in AsyncStorage for the `sound` key) defaults
// muted in dev/simulator builds so Claude/local testing doesn't blast audio; production builds
// still default to sound on. All actual action handling still delegates to the package's reducer.
const initialSoundSettings: SoundSettings = { ...defaultSoundSettings, enabled: !__DEV__ }
const appSoundReducer = (state: SoundSettings = initialSoundSettings, action: { type: string }): SoundSettings => soundReducer(state, action)

// Explicit primary/secondary triad (rather than a single seed expanded via harmony) so the app's
// blue/red identity is pinned exactly instead of drifting with whatever hue math a harmony offset
// would produce. Primary/secondary ARE player 1/player 2's own default colors (DEFAULT_P1_COLOR/
// DEFAULT_P2_COLOR, see constants/game.ts) rather than independently-chosen hexes, so the app theme
// and the lobby's own default guest colors can never drift apart — mirrors Snake's own store.ts
// (SNAKE_COLORS there). Tertiary is still derived, not picked, via getThirdColor: the hue maximally
// distant from both primary and secondary (see @rific/auto-paper's README "Explicit triad" section).
// appearance is also overridden — 'dark', not createThemeReducer's own 'system' default — matching
// this app's own long-standing cold-boot fallback (see _layout.tsx's SystemUI.setBackgroundColorAsync
// comment, which the old AsyncStorage-based Theme.tsx also hardcoded); still freely changeable
// afterward via SettingsDialog's AutoAppearancePicker, same as before.
const themeReducer = createThemeReducer({
  appearance: 'dark',
  color: { primary: DEFAULT_P1_COLOR, secondary: DEFAULT_P2_COLOR, tertiary: getThirdColor(DEFAULT_P1_COLOR, DEFAULT_P2_COLOR) }
})

const rootReducer = combineReducers({
  theme: themeReducer,
  haptic: hapticReducer,
  sound: appSoundReducer,
  // The shared App Group roster (see @tastic/profile's resolveInitialProfiles/
  // useSharedProfilesSync, wired in hooks/useProfiles.tsx) is layered on top of this as a separate
  // sync target — this slice persisting normally via redux-persist, same as every other key here,
  // is what gives it local-fallback behavior for the platforms/builds where the shared store isn't
  // available, with no separate hand-rolled AsyncStorage path needed for that case.
  profiles: profilesReducer,
  profileSelection,
  // keyScheme — this app's one genuine per-profile extension field (see profileExtensionsSlice's
  // own doc) — deliberately kept out of the shared `profiles` slice above; always local.
  profileExtensions,
  // lobby.tsx's own dedicated guest/CPU/profile-override seat-color memory (lastGuestColor/
  // lastCpuColor/profileOverride) — separate from `theme` above (a live snapshot only) — see
  // seatColorsSlice.ts's own doc.
  seatColors,
  // Which version of the how-to-play flow this player has finished or skipped — its own key rather
  // than a GameSettings field, so it survives 'Reset stats'/'Reset match settings' and never touches
  // gameSettingsValidation's strict isValidSettings. See guideSlice.ts's own doc.
  guide
})

export const persistConfig = {
  key: 'root',
  storage: AsyncStorage,
  // Grandfathers players from the shipped pre-redux build (7a595fa) past the guide: they have no root
  // store yet, only that build's own keys, which would otherwise look like a fresh install. A no-op once
  // a root store exists. See LEGACY_STORAGE_KEYS in guideSlice.ts.
  migrate: createReturningPlayerMigrate(AsyncStorage, LEGACY_STORAGE_KEYS),
  // redux-persist defaults `timeout` to 5000ms: a failsafe setTimeout scheduled on every PERSIST
  // dispatch to force-resolve rehydrate if storage never responds. It's never cleared once
  // rehydrate resolves normally (only guarded by an internal `_sealed` flag), so it sits as a
  // pending timer for up to 5s after every store creation — under Jest that's a real open handle
  // ("A worker process has failed to exit gracefully"), confirmed via `jest --detectOpenHandles`
  // pointing straight at persistReducer.js's setTimeout. Disabling it (falsy timeout skips the
  // setTimeout call entirely) is redux-persist's own documented way to opt out; AsyncStorage reads
  // failing to ever resolve at all isn't a failure mode worth a 5s failsafe for.
  timeout: 0
}

const persistedReducer = persistReducer(persistConfig, rootReducer)

export const store = configureStore({
  middleware: (getDefaultMiddleware) => {
    const defaultMiddleware = getDefaultMiddleware({
      immutableCheck: false,
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER]
      }
    })
    return defaultMiddleware.concat(errorMiddleware)
  },
  reducer: persistedReducer
})

export const persistor = persistStore(store)
export type RootState = ReturnType<typeof rootReducer>
export type AppDispatch = typeof store.dispatch
