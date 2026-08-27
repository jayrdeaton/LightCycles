import { UnlockedAchievementsState } from '@/types'

// Mirrors statsValidation.ts / gameSettingsValidation.ts — kept AsyncStorage-free for Jest.
export const DEFAULT_ACHIEVEMENTS: UnlockedAchievementsState = {}

// Doesn't cross-check keys against ACHIEVEMENT_CATALOG — an id from a since-removed achievement is
// just an inert extra entry, not a reason to discard the whole blob. Keys come in two formats (see
// achievementEngine.ts's unlockedKey): a bare achievement id for a device-wide/"All Profiles" unlock,
// or `profileId:achievementId` for one profile's own unlock — this validator doesn't need to (and
// doesn't) distinguish between them, since both are just "some string key -> a finite timestamp."
export function isValidAchievements(value: unknown): value is UnlockedAchievementsState {
  if (!value || typeof value !== 'object') return false
  return Object.values(value).every((v) => typeof v === 'number' && Number.isFinite(v))
}
