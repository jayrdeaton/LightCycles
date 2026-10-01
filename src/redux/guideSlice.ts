import { createGuideSlice } from '@tastic/hud/guide'

import { GUIDE_VERSION } from '@/constants/guide'

// Thin binding over @tastic/hud/guide's createGuideSlice factory: the persisted "which version of the
// how-to-play flow has this player finished or skipped" flag. A fresh install starts at 0 (the guide
// auto-shows on Home); a player who already had the app is stamped with GUIDE_VERSION on their first
// rehydrate, so an over-the-air update never greets them with a "how to play" screen (see the
// factory's own doc for how it tells the two apart, and LEGACY_STORAGE_KEYS below for players coming
// from the shipped pre-redux build). Mounted under `guide` in store.ts, the key the REHYDRATE payload
// is read from.
const slice = createGuideSlice({ currentVersion: GUIDE_VERSION })

// Every AsyncStorage key the last shipped build wrote: 7a595fa (otaVersion 13, 2026-09-12), read from
// that commit's own source. That build predates the redux-persist root store (added in 8094877), so its
// players have no root store at all and would otherwise look exactly like a fresh install. store.ts
// hands these to createReturningPlayerMigrate: no root store but any of these keys present means
// "played the shipped build", and that player is grandfathered past the guide.
//
// A historical record, so plain strings rather than today's constants: renaming a key in today's code
// must never change this list. Where each one was written at 7a595fa:
//   lightcycles.achievements, lightcycles.stats: hooks/useGameStats.tsx (useAchievements, namespace 'lightcycles')
//   lightcycles.appearance: components/Theme.tsx
//   lightcycles.cpuColor, lightcycles.playerColors: hooks/useSeatColors.ts
//   lightcycles.profiles: hooks/useProfiles.tsx
//   lightcycles.settings: hooks/useGameSettings.tsx
//   lightcycles.sound, lightcycles.vibrate: components/Feedback.tsx
//
// None of them may be written by today's build before PersistGate opens (the migrate would then take a
// fresh install for a returning player). Today, lightcycles.settings/.stats/.achievements are still
// written, but only by providers mounted inside PersistGate (see _layout.tsx and Providers.tsx).
export const LEGACY_STORAGE_KEYS: readonly string[] = ['lightcycles.achievements', 'lightcycles.appearance', 'lightcycles.cpuColor', 'lightcycles.playerColors', 'lightcycles.profiles', 'lightcycles.settings', 'lightcycles.sound', 'lightcycles.stats', 'lightcycles.vibrate']

export const guideActions = slice.actions
export const selectGuideVersionSeen = slice.selectVersionSeen
export default slice.reducer
