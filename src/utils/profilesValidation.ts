import { isValidProfile as isValidBaseProfile, MAX_PROFILE_NAME_LENGTH, MAX_TAG_LENGTH } from '@tastic/profile'

import { KeyScheme, Player, Profile } from '@/types'

// Pulled out of hooks/useProfiles.tsx specifically so it's testable without dragging in
// @react-native-async-storage/async-storage, which throws at import time under Jest's plain Node
// environment (its native module is never linked there) — mirrors gameSettingsValidation.ts.
//
// The base identity fields (name/color/tag/timestamps) are validated by @tastic/profile's own
// isValidProfile/isValidTag — this file only adds the one field that package's Profile type doesn't
// have: keyScheme, which is LightCycles-specific (other apps built on the same package extend
// Profile with their own different fields instead).

export { MAX_PROFILE_NAME_LENGTH, MAX_TAG_LENGTH }
export { isValidTag } from '@tastic/profile'

export interface SavedProfilesState {
  profiles: Profile[]
  // Seat -> last-selected profile id, or null for Player (no profile) — the "set it up once"
  // convenience default.
  lastSelected: Record<Player, string | null>
}

export const DEFAULT_PROFILES_STATE: SavedProfilesState = {
  profiles: [],
  lastSelected: { 1: null, 2: null }
}

function isValidKeyScheme(value: unknown): value is KeyScheme {
  return value === 'wasd' || value === 'arrows' || value === 'ijkl'
}

export function isValidProfile(value: unknown): value is Profile {
  return isValidBaseProfile(value) && isValidKeyScheme((value as Partial<Profile>).keyScheme)
}

function isValidSeatProfileId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0)
}

function isValidLastSelected(value: unknown): value is Record<Player, string | null> {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<Record<Player, string | null>>
  return isValidSeatProfileId(v[1]) && isValidSeatProfileId(v[2])
}

// All-or-nothing, matching gameSettingsValidation.ts's isValidSettings and statsValidation.ts's own
// isValidColorsMap: one malformed entry in `profiles` invalidates the whole roster rather than
// silently dropping just that entry.
export function isValidProfilesState(value: unknown): value is SavedProfilesState {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<SavedProfilesState>
  return Array.isArray(v.profiles) && v.profiles.every(isValidProfile) && isValidLastSelected(v.lastSelected)
}
