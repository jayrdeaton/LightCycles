import { useAutoPaperTheme } from '@rific/auto-paper'
import { getAchievementCatalogRows } from '@tastic/achievements'
import { FakeLandscapeView, rotateInsets, useRotation } from '@tastic/core'
import { AchievementCatalogSection, ActivityStatSection, BaseStatsScreen, StatRow, StatSection, usePopoverHost } from '@tastic/hud'
import { ProfileChip, ProfilePicker } from '@tastic/profile'
import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { ActivityIndicator, Icon, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ACHIEVEMENT_CATALOG } from '@/constants/achievements'
import { MONO_FONT } from '@/constants/fonts'
import { useGameStats } from '@/hooks/useGameStats'
import { useProfiles } from '@/hooks/useProfiles'
import { ColorStats } from '@/types'
import { safeBack } from '@/utils/navigation'
import { getBestPerformingColor, getFavoriteColor, getOverallTotals, getProfileOverallTotals, getProfileRankings, getProfileStatsView, ProfileRanking } from '@/utils/statsEngine'
import { DEFAULT_PROFILE_STATS } from '@/utils/statsValidation'

interface ColorStatRowProps {
  hex: string
  colorStats: ColorStats
  isFavorite: boolean
  isBest: boolean
  fg: string
  fgMuted: string
}

// One row per color ever played, most-played first — the actual per-color win/loss/draw
// breakdown, not just a single derived "favorite"/"best" highlight. Structurally similar to
// @tastic/hud's own StatRow (label/value either side) but with a leading color swatch — stays
// LightCycles-local since "a color swatch is the row's own identity" isn't a general stats concept
// the shared package should carry an opinion on.
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
  // Unlike index.tsx/lobby.tsx/game.tsx, this screen previously had no orientation handling at
  // all — it always rendered right-side-up regardless of how the phone was actually being held,
  // the one screen in the app that didn't rotate along with everywhere else. rotateInsets remaps
  // the device's own raw (never-rotated) safe-area reading onto whichever edge it actually
  // corresponds to once FakeLandscapeView below visually rotates the content.
  const rotation = useRotation()
  const insets = rotateInsets(useSafeAreaInsets(), rotation)
  const { stats, unlockedAchievements, loaded, resetAll } = useGameStats()
  const { profiles } = useProfiles()
  // Same ProfilePicker used to select a profile per-seat in the lobby (see @tastic/hud's
  // PlayerSetupPanel, wired up in lobby.tsx) — reused here as-is rather than a bespoke picker, with
  // its null-selection row relabeled to "All Profiles" instead of the lobby's "Player" (see
  // ProfilePicker's own nullLabel/nullIcon props).
  // Needs its own host since this screen has no other popover on it to share one with.
  const profilePickerHost = usePopoverHost()
  // Only needed here for ColorStatRow/ProfileRankingRow below, which stay LightCycles-local (see
  // their own doc comments) — @tastic/hud's own BaseStatsScreen/StatRow/StatSection/AchievementRow
  // all derive this identical dark-mode formula internally now, so nothing else in this file needs
  // to compute or thread it through anymore.
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

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

  // Every computation above already reads cleanly off useAchievements' own zeroed defaultStats
  // while still loading, so nothing above needs to change — but rendering the real sections over
  // that zeroed data would flash "0 games played" for a beat on every launch. onReset is withheld
  // here too: resetting stats that haven't actually been read back from storage yet has nothing
  // real to confirm against.
  if (!loaded) {
    return (
      <FakeLandscapeView style={styles.rotatable}>
        <BaseStatsScreen onBack={safeBack} insets={insets} rotation={rotation}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={themeColors.primary} />
          </View>
        </BaseStatsScreen>
      </FakeLandscapeView>
    )
  }

  return (
    <FakeLandscapeView style={styles.rotatable}>
      <BaseStatsScreen onBack={safeBack} insets={insets} onReset={resetAll} rotation={rotation}>
        {profiles.length > 0 && <ProfilePicker idPrefix='achievements' host={profilePickerHost} profiles={profiles} selectedId={effectiveProfileId} color={themeColors.primary} dark={dark} guestLabel='All Profiles' nullLabel='All Profiles' nullIcon='account-group' onSelect={(profile) => setSelectedProfileId(profile?.id ?? null)} />}

        <StatSection label='OVERALL'>
          <StatRow label='Played' value={String(overall.played)} />
          <StatRow label='Wins' value={String(overall.wins)} />
          <StatRow label='Losses' value={String(overall.losses)} />
          <StatRow label='Draws' value={String(overall.draws)} />
        </StatSection>

        <StatSection label='VS CPU'>
          <StatRow label='Record (W-L-D)' value={`${statsView.vsCpu.wins}-${statsView.vsCpu.losses}-${statsView.vsCpu.draws}`} />
          <StatRow label='Current Streak' value={String(statsView.vsCpu.currentWinStreak)} />
          <StatRow label='Best Streak' value={String(statsView.vsCpu.bestWinStreak)} />
        </StatSection>

        {/* All Profiles keeps today's original seat-framing (whoever sat where, regardless of
      profile) — a selected profile switches to that profile's own personal record instead
      (p1Wins+p2Wins is always THIS profile's own win count, see types/index.ts's ProfileStats doc
      comment), matching how every other section already frames things personally once a profile
      is selected. */}
        <StatSection label='TWO PLAYER (LOCAL)'>
          {profileBucket ? (
            <>
              <StatRow label='Played' value={String(statsView.twoPlayer.played)} />
              <StatRow label='Wins' value={String(statsView.twoPlayer.p1Wins + statsView.twoPlayer.p2Wins)} />
              <StatRow label='Losses' value={String(statsView.twoPlayer.played - statsView.twoPlayer.p1Wins - statsView.twoPlayer.p2Wins - statsView.twoPlayer.draws)} />
              <StatRow label='Draws' value={String(statsView.twoPlayer.draws)} />
            </>
          ) : (
            <>
              <StatRow label='Played' value={String(stats.twoPlayer.played)} />
              <StatRow label='Seat 1 Wins' value={String(stats.twoPlayer.p1Wins)} />
              <StatRow label='Seat 2 Wins' value={String(stats.twoPlayer.p2Wins)} />
              <StatRow label='Draws' value={String(stats.twoPlayer.draws)} />
            </>
          )}
        </StatSection>

        {sortedColors.length > 0 && (
          <StatSection label='COLORS (W-L-D)'>
            {sortedColors.map(([hex, colorStats]) => (
              <ColorStatRow key={hex} hex={hex} colorStats={colorStats} isFavorite={hex === favoriteColor} isBest={hex === bestColor} fg={fg} fgMuted={fgMuted} />
            ))}
          </StatSection>
        )}

        {/* A leaderboard comparing every profile — inherently a cross-profile question, so it only
      makes sense on "All Profiles"; once you've drilled into one profile's own tab it's answering
      a different question than the one you just asked. */}
        {effectiveProfileId === null && rankings.length > 0 && (
          <StatSection label='PLAYER RANKINGS'>
            {rankings.map((ranking) => (
              <ProfileRankingRow key={ranking.profile.id} ranking={ranking} fg={fg} fgMuted={fgMuted} />
            ))}
          </StatSection>
        )}

        <ActivityStatSection stats={statsView} />

        <AchievementCatalogSection rows={getAchievementCatalogRows(ACHIEVEMENT_CATALOG, stats, statsView, unlockedAchievements, effectiveProfileId)} />
      </BaseStatsScreen>
    </FakeLandscapeView>
  )
}

const styles = StyleSheet.create({
  boldText: {
    fontWeight: 'bold'
  },
  colorValue: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48
  },
  rotatable: {
    flex: 1
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
  }
})
