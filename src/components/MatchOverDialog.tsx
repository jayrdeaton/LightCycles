import { getContrastColor, useAutoPaperTheme } from '@rific/auto-paper'
import { Button } from '@rific/feedback-press'
import { StyleSheet, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'

import RoundHistoryPips from '@/components/RoundHistoryPips'
import { ACHIEVEMENT_TIER_COLORS } from '@/constants/achievements'
import { AchievementDefinition, GameMode, Player, RoundOutcome } from '@/types'

export interface MatchOverDialogProps {
  // Oldest first — same array GameScreen already tracks across rematches (see game.tsx). Whatever
  // round was in progress when a Quit ended the match is already included: onRoundOutcome fires
  // the instant a round's phase reaches 'roundOver', before its own dialog (let alone this one) is
  // even shown.
  roundHistory: RoundOutcome[]
  colors: Record<Player, string>
  // Seat -> saved profile name, only for seats that had one selected — falls back to the existing
  // P1/P2/YOU/CPU labels below when absent, so this stays fully optional/backward-compatible.
  profileNames?: Partial<Record<Player, string>>
  // Seat -> saved profile tag — badges each achievement row below with whichever seat earned it
  // (the same color+tag identity ProfileChip shows elsewhere), since both seats can unlock in the
  // same two-player match and the list itself no longer lives in either seat's own score column.
  profileTags?: Partial<Record<Player, string>>
  // Seat -> whatever that seat's OWN saved profile newly unlocked on the FINAL round of the match
  // (see useGameStats.tsx's recordRoundOutcome) — the match-ending round skips RoundOverDialog
  // entirely in favor of this dialog, so this is where that round's own badge needs to land instead.
  // Rendered in each seat's own score column, not independently rotated per seat (unlike
  // RoundOverDialog) — this dialog's own single shared `rotation` already covers the whole card.
  profileUnlocked?: Partial<Record<Player, AchievementDefinition[]>>
  gameMode: GameMode
  onExit: () => void
  // Live physical-hold rotation (see @tastic/split-screen's getViewRotation) — applied to the card
  // itself, not the outer overlay. No per-player offset: there's only ever one shared card here.
  rotation?: number
}

// Shown once either player quits from the round-over dialog (see RoundOverDialog) — "it's over"
// covers every round played this streak, not just the one that just finished, so this tallies the
// whole roundHistory rather than repeating that last round's own outcome. One shared, unrotated
// dialog (matching game.tsx's existing quit-confirmation dialog) rather than RoundOverDialog's
// per-player split — there's no decision left for either player to make here, just a result to
// read before backing out to the menu.
export default function MatchOverDialog({ roundHistory, colors, profileNames = {}, profileTags = {}, profileUnlocked = {}, gameMode, onExit, rotation = 0 }: MatchOverDialogProps) {
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const cardBg = dark ? '#111111' : '#F2F2F2'
  const cardBorder = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'
  const fg = dark ? '#FFFFFF' : '#000000'

  const p1Wins = roundHistory.filter((r) => r.type === 'win' && r.winner === 1).length
  const p2Wins = roundHistory.filter((r) => r.type === 'win' && r.winner === 2).length
  const draws = roundHistory.length - p1Wins - p2Wins
  const matchWinner: Player | null = p1Wins === p2Wins ? null : p1Wins > p2Wins ? 1 : 2

  // profileNames only ever has an entry for a seat with an actual saved profile selected — falls
  // back to the existing P1/P2/YOU/CPU copy otherwise, so the common no-profile case is unchanged.
  // Seat 1's vsCpu fallback ('YOU') is second-person ("YOU WIN"); a substituted profile name is
  // third-person ("ALICE WINS"), same as every other label here — only that one case's grammar
  // actually changes when a name is substituted in.
  const winnerLabel = matchWinner !== null ? (profileNames[matchWinner] ?? `P${matchWinner}`) : null
  const title = matchWinner === null ? 'MATCH TIED' : gameMode === 'vsCpu' ? (matchWinner === 1 ? `${profileNames[1] ?? 'YOU'} ${profileNames[1] ? 'WINS' : 'WIN'} THE MATCH!` : `${profileNames[2] ?? 'CPU'} WINS THE MATCH!`) : `${winnerLabel} WINS THE MATCH!`
  const icon = matchWinner === null ? 'handshake-outline' : gameMode === 'vsCpu' && matchWinner === 2 ? 'robot' : 'trophy'
  const titleColor = matchWinner === null ? fg : colors[matchWinner]

  const p1Label = profileNames[1] ?? (gameMode === 'vsCpu' ? 'YOU' : 'P1')
  const p2Label = profileNames[2] ?? (gameMode === 'vsCpu' ? 'CPU' : 'P2')

  return (
    <View style={styles.overlay}>
      <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }, rotation % 360 !== 0 && { transform: [{ rotate: `${rotation}deg` }] }]}>
        <Icon source={icon} size={64} color={titleColor} />
        <Text variant='headlineLarge' style={[styles.overlayTitle, { color: titleColor }]}>
          {title}
        </Text>
        <View style={styles.scoreRow}>
          <View style={styles.scoreSide}>
            <Text style={[styles.scoreLabel, { color: colors[1] }]}>{p1Label}</Text>
            <Text style={[styles.scoreValue, { color: colors[1] }]}>{p1Wins}</Text>
          </View>
          {draws > 0 && (
            <View style={styles.scoreSide}>
              <Text style={[styles.scoreLabel, { color: fg }]}>DRAWS</Text>
              <Text style={[styles.scoreValue, { color: fg }]}>{draws}</Text>
            </View>
          )}
          <View style={styles.scoreSide}>
            <Text style={[styles.scoreLabel, { color: colors[2] }]}>{p2Label}</Text>
            <Text style={[styles.scoreValue, { color: colors[2] }]}>{p2Wins}</Text>
          </View>
        </View>
        <RoundHistoryPips roundHistory={roundHistory} p1Color={colors[1]} p2Color={colors[2]} />
        {/* Listed individually rather than as a per-seat "N unlocked!" badge (which used to sit in
        the score column above and threw off the vertical alignment between the two scores whenever
        only one side had a badge) — one row per achievement, under the pips where it doesn't affect
        the score row's height. */}
        {(profileUnlocked[1]?.length ?? 0) + (profileUnlocked[2]?.length ?? 0) > 0 && (
          <View style={styles.achievementList}>
            {([1, 2] as Player[]).flatMap((player) =>
              (profileUnlocked[player] ?? []).map((achievement) => (
                <View key={`${player}-${achievement.id}`} style={styles.achievementRow}>
                  {/* Whose achievement this is — the same color+tag identity ProfileChip shows
                elsewhere — now that both seats' unlocks share one list instead of their own score
                column, color alone (as the icon used to carry) isn't enough once a tier color
                takes that role instead. */}
                  <View style={[styles.achievementAvatar, { backgroundColor: colors[player] }]}>
                    {profileTags[player] ? (
                      <Text style={[styles.achievementAvatarTag, { color: getContrastColor(colors[player]) }]} numberOfLines={1} adjustsFontSizeToFit>
                        {profileTags[player]}
                      </Text>
                    ) : (
                      <Icon source='account' size={10} color={getContrastColor(colors[player])} />
                    )}
                  </View>
                  <View style={[styles.achievementIconBadge, { backgroundColor: ACHIEVEMENT_TIER_COLORS[achievement.tier] }]}>
                    <Icon source={achievement.icon} size={12} color='#000000' />
                  </View>
                  <Text style={[styles.achievementRowLabel, { color: fg }]} numberOfLines={1}>
                    {achievement.title}
                  </Text>
                </View>
              ))
            )}
          </View>
        )}
        <Button mode='contained' onPress={onExit} style={styles.overlayButton} buttonColor={themeColors.primary} textColor={themeColors.onPrimary}>
          Menu
        </Button>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  achievementAvatar: {
    alignItems: 'center',
    borderRadius: 9,
    height: 18,
    justifyContent: 'center',
    width: 18
  },
  achievementAvatarTag: {
    fontSize: 8,
    fontWeight: '700',
    paddingHorizontal: 1
  },
  achievementIconBadge: {
    alignItems: 'center',
    borderRadius: 9,
    height: 18,
    justifyContent: 'center',
    width: 18
  },
  achievementList: {
    gap: 6
  },
  achievementRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6
  },
  achievementRowLabel: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '700'
  },
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
  overlayButton: { width: 160 },
  overlayCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    maxWidth: 360,
    padding: 32
  },
  // Uppercased via style rather than baked into the title string itself, so a mixed-case profile
  // name substituted into "{name} WINS THE MATCH!" always reads in the same case as the rest of the
  // sentence instead of visually breaking the flow.
  overlayTitle: { fontWeight: 'bold', marginBottom: -8, textAlign: 'center', textTransform: 'uppercase' },
  scoreLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  scoreRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 24 },
  scoreSide: { alignItems: 'center', gap: 2 },
  scoreValue: { fontSize: 32, fontWeight: 'bold' }
})
