import { evaluateUnlockedIds as evaluate } from '@tastic/achievements'

import { ACHIEVEMENT_CATALOG } from '@/constants/achievements'
import { ProfileStats, StatsState } from '@/types'
import { getProfileStatsView } from '@/utils/statsEngine'

// Thin LightCycles-side bindings over @tastic/achievements' generic engine — this app's catalog is
// a module-level constant, so pre-binding it here keeps every call site reading as
// `evaluateUnlockedIds(stats)` rather than threading the catalog through by hand each time.

export function evaluateUnlockedIds(stats: StatsState): Set<string> {
  return evaluate(ACHIEVEMENT_CATALOG, stats)
}

// The profile-scoped counterpart — `scope: 'profile'` filters out scope:'device' achievements (see
// types/index.ts's AchievementDefinition) so its result can never produce a bogus
// `profileId:flawless_debut`-style key: every caller can treat "in this set" as immediately
// eligible for a profile-scoped unlockedKey with no further scope-checking of its own.
export function evaluateUnlockedIdsForProfile(profileStats: ProfileStats): Set<string> {
  return evaluate(ACHIEVEMENT_CATALOG, getProfileStatsView(profileStats), { scope: 'profile' })
}

// Re-exported unchanged: a device-wide/"All Profiles" unlock (profileId === null) is keyed as a
// bare achievement id, exactly as it always has been, so existing stored unlock timestamps keep
// meaning what they already mean; a profile-scoped unlock is keyed `${profileId}:${achievementId}`.
export { unlockedKey } from '@tastic/achievements'
