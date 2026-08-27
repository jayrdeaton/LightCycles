import { ACHIEVEMENT_CATALOG } from '@/constants/achievements'
import { ProfileStats, StatsState } from '@/types'
import { getProfileStatsView } from '@/utils/statsEngine'

export function evaluateUnlockedIds(stats: StatsState): Set<string> {
  return new Set(ACHIEVEMENT_CATALOG.filter((achievement) => achievement.isUnlocked(stats)).map((achievement) => achievement.id))
}

// The profile-scoped counterpart to evaluateUnlockedIds above — filters out scope:'device'
// achievements (see types/index.ts's AchievementDefinition.scope) so its result can never produce a
// bogus `profileId:flawless_debut`-style key: every caller can treat "in this set" as immediately
// eligible for a profile-scoped unlockedKey with no further scope-checking of its own.
export function evaluateUnlockedIdsForProfile(profileStats: ProfileStats): Set<string> {
  const profileView = getProfileStatsView(profileStats)
  return new Set(ACHIEVEMENT_CATALOG.filter((achievement) => achievement.scope !== 'device' && achievement.isUnlocked(profileView)).map((achievement) => achievement.id))
}

// A device-wide/"All Profiles" unlock (profileId === null) is keyed exactly as it always has been —
// a bare achievement id — so existing stored unlock timestamps keep meaning what they already mean.
// A profile-scoped unlock is keyed `${profileId}:${achievementId}`. Safe to disambiguate on `:`
// alone: catalog ids are fixed snake_case constants and generateProfileId() (useProfiles.tsx) never
// produces one containing `:`.
export function unlockedKey(achievementId: string, profileId: string | null): string {
  return profileId === null ? achievementId : `${profileId}:${achievementId}`
}
