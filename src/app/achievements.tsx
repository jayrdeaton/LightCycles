import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton } from '@rific/feedback-press'
import { usePopoverHost } from '@tastic/hud'
import { ProfileChip, ProfilePicker } from '@tastic/profile'
import { useCallback, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Icon, Portal, ProgressBar, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ACHIEVEMENT_CATALOG, ACHIEVEMENT_TIER_COLORS } from '@/constants/achievements'
import { MONO_FONT } from '@/constants/fonts'
import { useGameStats } from '@/hooks/useGameStats'
import { useProfiles } from '@/hooks/useProfiles'
import { ColorStats } from '@/types'
import { unlockedKey } from '@/utils/achievementEngine'
import { safeBack } from '@/utils/navigation'
import { getBestPerformingColor, getFavoriteColor, getOverallTotals, getProfileOverallTotals, getProfileRankings, getProfileStatsView, ProfileRanking } from '@/utils/statsEngine'
import { DEFAULT_PROFILE_STATS } from '@/utils/statsValidation'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const LOCKED_BADGE_COLOR = 'rgba(128,128,128,0.3)'

// Calendar-day difference, not raw elapsed time — matches the day-streak convention in
// statsEngine.ts's localDateString/previousDateString, so an achievement unlocked at 11pm reads
// as "1 day ago" once the calendar date rolls over at midnight, not 24 hours later.
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function unlockedLabel(unlockedAt: number): string {
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(unlockedAt))) / MS_PER_DAY)
  if (days <= 0) return 'Unlocked today'
  if (days === 1) return 'Unlocked 1 day ago'
  return `Unlocked ${days} days ago`
}

interface StatRowProps {
  label: string
  value: string
  fg: string
  fgMuted: string
}

function StatRow({ label, value, fg, fgMuted }: StatRowProps) {
  return (
    <View style={styles.statRow}>
      <Text variant='bodyMedium' style={{ color: fgMuted, fontFamily: MONO_FONT }}>
        {label}
      </Text>
      <Text variant='bodyMedium' style={[styles.boldText, { color: fg, fontFamily: MONO_FONT }]}>
        {value}
      </Text>
    </View>
  )
}

interface ColorStatRowProps {
  hex: string
  colorStats: ColorStats
  isFavorite: boolean
  isBest: boolean
  fg: string
  fgMuted: string
}

// One row per color ever played, most-played first — the actual per-color win/loss/draw
// breakdown, not just a single derived "favorite"/"best" highlight.
function ColorStatRow({ hex, colorStats, isFavorite, isBest, fg, fgMuted }: ColorStatRowProps) {
  return (
    <View style={styles.statRow}>
      <View style={styles.colorValue}>
        <View style={[styles.swatch, { backgroundColor: hex }]} />
        <Text variant='bodyMedium' style={[styles.boldText, { color: fg, fontFamily: MONO_FONT }]}>
          {hex.toUpperCase()}
        </Text>
        {isFavorite && <Icon source='star' size={14} color='#FFD54F' />}
        {isBest && <Icon source='trophy' size={14} color='#FFD54F' />}
      </View>
      <Text variant='bodyMedium' style={{ color: fgMuted, fontFamily: MONO_FONT }}>
        {colorStats.wins}-{colorStats.losses}-{colorStats.draws}
        <Text style={{ color: fgMuted, fontFamily: MONO_FONT }}> ({colorStats.played} played)</Text>
      </Text>
    </View>
  )
}

interface ProfileRankingRowProps {
  ranking: ProfileRanking
  fg: string
  fgMuted: string
}

// One row per saved profile, structurally matching ColorStatRow — a ProfileChip (the profile's own
// saved color and tag, not a live seat color/icon) + name in place of a hex swatch/label.
function ProfileRankingRow({ ranking, fg, fgMuted }: ProfileRankingRowProps) {
  const { profile, wins, losses, draws, played } = ranking
  return (
    <View style={styles.statRow}>
      <View style={styles.colorValue}>
        <ProfileChip profile={profile} />
        <Text variant='bodyMedium' style={[styles.boldText, { color: fg, fontFamily: MONO_FONT }]} numberOfLines={1}>
          {profile.name}
        </Text>
      </View>
      <Text variant='bodyMedium' style={{ color: fgMuted, fontFamily: MONO_FONT }}>
        {wins}-{losses}-{draws}
        <Text style={{ color: fgMuted, fontFamily: MONO_FONT }}> ({played} played)</Text>
      </Text>
    </View>
  )
}

export default function AchievementsScreen() {
  const { dark, colors: themeColors } = useAutoPaperTheme()
  const insets = useSafeAreaInsets()
  const { stats, unlockedAchievements, resetAll } = useGameStats()
  const { profiles } = useProfiles()
  // Same ProfilePicker used to select a profile per-seat in the lobby (see LobbyPlayerPanel.tsx) —
  // reused here as-is rather than a bespoke picker, with its null-selection row relabeled to "All
  // Profiles" instead of the lobby's "Player" (see ProfilePicker's own nullLabel/nullIcon props).
  // Needs its own host since this screen has no other popover on it to share one with.
  const profilePickerHost = usePopoverHost()
  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'
  const sectionBg = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'
  // Matches every other custom overlay dialog in the app (SettingsDialog/MatchOverDialog/
  // RoundOverDialog) exactly, for the reset-confirmation dialog below.
  const cardBg = dark ? '#111111' : '#F2F2F2'
  const cardBorder = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'

  const [confirmResetVisible, setConfirmResetVisible] = useState(false)
  const handleConfirmReset = useCallback(() => {
    resetAll()
    setConfirmResetVisible(false)
  }, [resetAll])

  // null = "All Profiles" (device-wide, today's original view). Self-heals to null on its own if the
  // selected profile gets deleted from another still-mounted screen (see expo-router's keep-prior-
  // screens-mounted behavior) — effectiveProfileId below just stops matching any entry in `profiles`.
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const effectiveProfileId = selectedProfileId && profiles.some((p) => p.id === selectedProfileId) ? selectedProfileId : null
  const profileBucket = effectiveProfileId ? (stats.profiles[effectiveProfileId] ?? DEFAULT_PROFILE_STATS) : null
  // The exact same StatsState-shaped object every stat helper/achievement predicate below already
  // knows how to read — statsView === stats for "All Profiles", so every section that swaps `stats`
  // for `statsView` collapses back to today's untouched behavior in that case.
  const statsView = profileBucket ? getProfileStatsView(profileBucket) : stats

  // getOverallTotals is device-wide only (see its own caveat comment in statsEngine.ts) — a selected
  // profile routes through getProfileOverallTotals instead, never through statsView here.
  const overall = useMemo(() => (profileBucket ? getProfileOverallTotals(profileBucket) : getOverallTotals(stats)), [stats, profileBucket])
  const favoriteColor = useMemo(() => getFavoriteColor(statsView), [statsView])
  const bestColor = useMemo(() => getBestPerformingColor(statsView), [statsView])
  // Most-played first, so the favorite color (if any) naturally leads the list.
  const sortedColors = useMemo(() => Object.entries(statsView.colors).sort(([, a], [, b]) => b.played - a.played), [statsView.colors])
  // Cross-profile comparison — only meaningful for "All Profiles" (see its own gated render below).
  const rankings = useMemo(() => getProfileRankings(profiles, stats.profiles), [profiles, stats.profiles])

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View style={[styles.header, { paddingTop: 8 + insets.top, paddingLeft: 8 + insets.left }]}>
        <IconButton icon='arrow-left' iconColor={fg} size={24} onPress={safeBack} />
        <Text variant='displaySmall' style={[styles.title, { color: fg, fontFamily: MONO_FONT }]}>
          Achievements
        </Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        {profiles.length > 0 && <ProfilePicker idPrefix='achievements' host={profilePickerHost} profiles={profiles} selectedId={effectiveProfileId} color={themeColors.primary} dark={dark} guestLabel='All Profiles' nullLabel='All Profiles' nullIcon='account-group' onSelect={(profile) => setSelectedProfileId(profile?.id ?? null)} />}

        <View style={[styles.section, { backgroundColor: sectionBg }]}>
          <Text variant='labelMedium' style={[styles.sectionLabel, { color: fgMuted, fontFamily: MONO_FONT }]}>
            OVERALL
          </Text>
          <StatRow label='Played' value={String(overall.played)} fg={fg} fgMuted={fgMuted} />
          <StatRow label='Wins' value={String(overall.wins)} fg={fg} fgMuted={fgMuted} />
          <StatRow label='Losses' value={String(overall.losses)} fg={fg} fgMuted={fgMuted} />
          <StatRow label='Draws' value={String(overall.draws)} fg={fg} fgMuted={fgMuted} />
        </View>

        <View style={[styles.section, { backgroundColor: sectionBg }]}>
          <Text variant='labelMedium' style={[styles.sectionLabel, { color: fgMuted, fontFamily: MONO_FONT }]}>
            VS CPU
          </Text>
          <StatRow label='Record (W-L-D)' value={`${statsView.vsCpu.wins}-${statsView.vsCpu.losses}-${statsView.vsCpu.draws}`} fg={fg} fgMuted={fgMuted} />
          <StatRow label='Current Streak' value={String(statsView.vsCpu.currentWinStreak)} fg={fg} fgMuted={fgMuted} />
          <StatRow label='Best Streak' value={String(statsView.vsCpu.bestWinStreak)} fg={fg} fgMuted={fgMuted} />
        </View>

        <View style={[styles.section, { backgroundColor: sectionBg }]}>
          <Text variant='labelMedium' style={[styles.sectionLabel, { color: fgMuted, fontFamily: MONO_FONT }]}>
            TWO PLAYER (LOCAL)
          </Text>
          {/* All Profiles keeps today's original seat-framing (whoever sat where, regardless of
          profile) — a selected profile switches to that profile's own personal record instead
          (p1Wins+p2Wins is always THIS profile's own win count, see types/index.ts's ProfileStats
          doc comment), matching how every other section already frames things personally once a
          profile is selected. */}
          {profileBucket ? (
            <>
              <StatRow label='Played' value={String(statsView.twoPlayer.played)} fg={fg} fgMuted={fgMuted} />
              <StatRow label='Wins' value={String(statsView.twoPlayer.p1Wins + statsView.twoPlayer.p2Wins)} fg={fg} fgMuted={fgMuted} />
              <StatRow label='Losses' value={String(statsView.twoPlayer.played - statsView.twoPlayer.p1Wins - statsView.twoPlayer.p2Wins - statsView.twoPlayer.draws)} fg={fg} fgMuted={fgMuted} />
              <StatRow label='Draws' value={String(statsView.twoPlayer.draws)} fg={fg} fgMuted={fgMuted} />
            </>
          ) : (
            <>
              <StatRow label='Played' value={String(stats.twoPlayer.played)} fg={fg} fgMuted={fgMuted} />
              <StatRow label='Seat 1 Wins' value={String(stats.twoPlayer.p1Wins)} fg={fg} fgMuted={fgMuted} />
              <StatRow label='Seat 2 Wins' value={String(stats.twoPlayer.p2Wins)} fg={fg} fgMuted={fgMuted} />
              <StatRow label='Draws' value={String(stats.twoPlayer.draws)} fg={fg} fgMuted={fgMuted} />
            </>
          )}
        </View>

        {/* A leaderboard comparing every profile — inherently a cross-profile question, so it only
        makes sense on "All Profiles"; once you've drilled into one profile's own tab it's answering
        a different question than the one you just asked. */}
        {effectiveProfileId === null && rankings.length > 0 && (
          <View style={[styles.section, { backgroundColor: sectionBg }]}>
            <Text variant='labelMedium' style={[styles.sectionLabel, { color: fgMuted, fontFamily: MONO_FONT }]}>
              PLAYER RANKINGS
            </Text>
            {rankings.map((ranking) => (
              <ProfileRankingRow key={ranking.profile.id} ranking={ranking} fg={fg} fgMuted={fgMuted} />
            ))}
          </View>
        )}

        <View style={[styles.section, { backgroundColor: sectionBg }]}>
          <Text variant='labelMedium' style={[styles.sectionLabel, { color: fgMuted, fontFamily: MONO_FONT }]}>
            ACTIVITY
          </Text>
          <StatRow label='Days Played' value={String(statsView.distinctDaysPlayed)} fg={fg} fgMuted={fgMuted} />
          <StatRow label='Day Streak' value={String(statsView.currentDayStreak)} fg={fg} fgMuted={fgMuted} />
          <StatRow label='Best Day Streak' value={String(statsView.bestDayStreak)} fg={fg} fgMuted={fgMuted} />
        </View>

        {sortedColors.length > 0 && (
          <View style={[styles.section, { backgroundColor: sectionBg }]}>
            <Text variant='labelMedium' style={[styles.sectionLabel, { color: fgMuted, fontFamily: MONO_FONT }]}>
              COLORS (W-L-D)
            </Text>
            {sortedColors.map(([hex, colorStats]) => (
              <ColorStatRow key={hex} hex={hex} colorStats={colorStats} isFavorite={hex === favoriteColor} isBest={hex === bestColor} fg={fg} fgMuted={fgMuted} />
            ))}
          </View>
        )}

        <Text variant='labelMedium' style={[styles.sectionLabel, styles.listLabel, { color: fgMuted, fontFamily: MONO_FONT }]}>
          ALL ACHIEVEMENTS
        </Text>
        {ACHIEVEMENT_CATALOG.map((achievement) => {
          // scope:'device' (currently just flawless_debut — see its own doc comment in
          // constants/achievements.ts) always evaluates against the real device StatsState and its
          // bare-id unlock key, regardless of which tab is active — every other achievement follows
          // whichever view is currently selected. When effectiveProfileId is null (All Profiles),
          // this collapses to exactly today's original computation: evalStats === stats and
          // key === achievement.id either way.
          const scope = achievement.scope ?? 'profile'
          const evalStats = scope === 'device' ? stats : statsView
          const key = unlockedKey(achievement.id, scope === 'device' ? null : effectiveProfileId)
          const unlockedAt = unlockedAchievements[key]
          const progress = unlockedAt === undefined ? achievement.progress?.(evalStats) : undefined
          const badgeColor = unlockedAt !== undefined ? ACHIEVEMENT_TIER_COLORS[achievement.tier] : LOCKED_BADGE_COLOR
          const showsDeviceMarker = effectiveProfileId !== null && scope === 'device'
          return (
            <View key={achievement.id} style={[styles.achievementRow, { backgroundColor: sectionBg }]}>
              <View style={[styles.tierBadge, { backgroundColor: badgeColor }]}>
                <Icon source={achievement.icon} size={20} color={unlockedAt !== undefined ? '#000000' : fgMuted} />
              </View>
              <View style={styles.achievementText}>
                <Text variant='bodyLarge' style={[styles.boldText, { color: fg, fontFamily: MONO_FONT }]}>
                  {achievement.title}
                </Text>
                <Text variant='bodySmall' style={{ color: fgMuted, fontFamily: MONO_FONT }}>
                  {achievement.description}
                </Text>
                {/* The explicit visual distinction for a global-exception achievement viewed from a
                specific profile's tab — it unlocks/shows the same regardless of which profile is
                selected, so it shouldn't read as "this profile's own" progress. */}
                {showsDeviceMarker && (
                  <View style={styles.deviceMarker}>
                    <Icon source='earth' size={11} color={fgMuted} />
                    <Text variant='labelSmall' style={{ color: fgMuted, fontFamily: MONO_FONT }}>
                      Same for every profile
                    </Text>
                  </View>
                )}
                {unlockedAt === undefined && progress !== undefined && <ProgressBar progress={progress} color={ACHIEVEMENT_TIER_COLORS[achievement.tier]} style={styles.progressBar} />}
              </View>
              {unlockedAt !== undefined ? (
                <View style={styles.achievementStatus}>
                  <Icon source='check-circle' size={20} color={ACHIEVEMENT_TIER_COLORS[achievement.tier]} />
                  <Text variant='labelSmall' style={{ color: fgMuted, fontFamily: MONO_FONT }}>
                    {unlockedLabel(unlockedAt)}
                  </Text>
                </View>
              ) : (
                <Icon source='lock-outline' size={20} color={fgMuted} />
              )}
            </View>
          )
        })}

        <Button mode='outlined' onPress={() => setConfirmResetVisible(true)} textColor={themeColors.secondary} style={styles.resetButton}>
          Reset All Stats
        </Button>
      </ScrollView>

      {confirmResetVisible && (
        <Portal>
          <View style={styles.overlay}>
            <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <Icon source='alert-outline' size={64} color={themeColors.secondary} />
              <Text variant='headlineLarge' style={[styles.overlayTitle, { color: themeColors.secondary }]}>
                Reset Everything?
              </Text>
              <Text variant='bodyLarge' style={[styles.overlayBody, { color: fg }]}>
                This permanently erases all stats and achievements. This cannot be undone.
              </Text>
              <Button mode='contained' onPress={() => setConfirmResetVisible(false)} style={styles.overlayButton} buttonColor={themeColors.primary} textColor={themeColors.onPrimary}>
                Cancel
              </Button>
              <Button mode='contained' onPress={handleConfirmReset} style={styles.overlayButton} buttonColor={themeColors.secondary} textColor={themeColors.onSecondary}>
                Reset
              </Button>
            </View>
          </View>
        </Portal>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  achievementRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 12,
    padding: 12
  },
  achievementStatus: {
    alignItems: 'center',
    gap: 2,
    width: 64
  },
  achievementText: {
    flex: 1,
    gap: 2
  },
  boldText: {
    fontWeight: 'bold'
  },
  colorValue: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  container: {
    flex: 1
  },
  content: {
    gap: 12,
    paddingHorizontal: 20
  },
  deviceMarker: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingBottom: 8
  },
  listLabel: {
    marginTop: 8
  },
  // Matches SettingsDialog/MatchOverDialog/RoundOverDialog's identical overlay shape exactly —
  // this file doesn't share components with those, so the shape is duplicated the same way it
  // already is across those three.
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  overlayBody: { textAlign: 'center' },
  overlayButton: { width: 160 },
  overlayCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    maxWidth: 360,
    padding: 32
  },
  overlayTitle: { fontWeight: 'bold', marginBottom: -8 },
  progressBar: {
    borderRadius: 4,
    height: 6,
    marginTop: 6
  },
  resetButton: {
    marginTop: 16
  },
  // Bounds the ScrollView to the space container's flex:1 actually gives it — without this, a
  // ScrollView with only a contentContainerStyle isn't reliably height-constrained on native (it
  // can render at its full unclipped content height instead of the screen's), which left the
  // absolutely-positioned back button's touch target unreliable underneath it. Screens elsewhere
  // in the app don't hit this because none of them scroll — achievements.tsx is the only
  // full-screen route with a scrollable body.
  scrollView: {
    flex: 1
  },
  section: {
    borderRadius: 12,
    gap: 8,
    padding: 16
  },
  sectionLabel: {
    letterSpacing: 2
  },
  statRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  swatch: {
    borderColor: 'rgba(128,128,128,0.6)',
    borderRadius: 10,
    borderWidth: 1,
    height: 18,
    width: 18
  },
  tierBadge: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36
  },
  title: {
    flexShrink: 1,
    fontWeight: 'bold'
  }
})
