// Both of these now live in @tastic/achievements — re-exported here under their existing
// LightCycles names so every consumer (and this app's own test suite) keeps its current import.
// The stored shape is unchanged: a map of unlock key -> finite timestamp, where keys come in the
// two formats achievementEngine.ts's unlockedKey produces.
export { DEFAULT_UNLOCKED_ACHIEVEMENTS as DEFAULT_ACHIEVEMENTS, isValidUnlockedAchievements as isValidAchievements } from '@tastic/achievements'
