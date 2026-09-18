import { createAchievementBindings } from '@tastic/achievements'

import { ACHIEVEMENT_CATALOG } from '@/constants/achievements'
import { getProfileStatsView } from '@/utils/statsEngine'

// Thin LightCycles-side bindings over @tastic/achievements' generic createAchievementBindings
// factory — this app's catalog and getProfileStatsView are module-level constants, so pre-binding
// them here keeps every call site reading as `evaluateUnlockedIds(stats)`/
// `evaluateUnlockedIdsForProfile(profileStats)` rather than threading them through by hand. Same
// three export names this file has always had, so no other call site needs to change its import.
export const { evaluateUnlockedIds, evaluateUnlockedIdsForProfile, unlockedKey } = createAchievementBindings(ACHIEVEMENT_CATALOG, getProfileStatsView)
