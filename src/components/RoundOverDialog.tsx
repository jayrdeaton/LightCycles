import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button } from '@rific/feedback-press'
import { getOpposingZoneRotation, ViewRotation } from '@tastic/split-screen'
import { StyleSheet, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'

import { AchievementDefinition, GameMode, OrientationMode, Player, RoundOutcome } from '@/types'

export interface RoundOverDialogProps {
  orientationMode: OrientationMode
  // Only meaningful when orientationMode === 'sideBySide' — see GameBoard.tsx's identical prop.
  p1OnRight: boolean
  // Live physical-hold rotation (see @tastic/split-screen's getFixedZoneRotation), applied to each
  // player's own CARD, not their zone — the zone rect must stay exactly the shape TouchInputLayer's
  // matching (unrotated) hit zone already is, or the two stop lining up. Note this is about the LIVE
  // hold, not the `orientationMode` prop above (which is the board's own always-'faceToFace'
  // structural layout and says nothing about how the device is actually being held right now) — see
  // this file's own use of getOpposingZoneRotation, which is what actually decides whether P2's card
  // gets an extra +180° on top of P1's (portrait: P2 sits across the device from P1, physically
  // upside-down relative to them) or not (landscape: P1 and P2 are held side by side, facing the
  // same way, so P2's card uses this rotation unmodified).
  rotation: ViewRotation
  humanPlayers: Player[]
  gameMode: GameMode
  outcome: RoundOutcome
  colors: Record<Player, string>
  // Seat -> whatever that seat's OWN saved profile newly unlocked this round (see
  // useGameStats.tsx's recordRoundOutcome) — only ever populated in two-player mode (see this
  // component's own humanPlayers.length===1 branch, which never reads it: vsCpu keeps its existing
  // plain Snackbar toast instead, since there's only one human perspective to address there). Badge
  // rides along on each player's own card, so it's automatically rotated/zoned to face them, same as
  // everything else on that card.
  profileUnlocked?: Partial<Record<Player, AchievementDefinition[]>>
  // Whether each human has already pressed Rematch this round-over — GameRound owns the actual
  // "both agreed" logic (it fires the real rematch once every human player's entry is true); this
  // component only reflects that state back per player and reports taps upward.
  rematchReady: Record<Player, boolean>
  onRequestRematch: (player: Player) => void
  onQuit: () => void
}

// vsCpu gets the original single, centered dialog (only one human to address, and the CPU always
// "agrees" to a rematch instantly — see GameRound's readiness effect, which needs just player 1).
// Two-player mode instead splits into each player's own zone — same top/bottom (face-to-face,
// P2's zone rotated 180° so it reads right-side-up from their side of the device) or left/right
// (side-by-side, ordered by p1OnRight) split OnboardingOverlay already uses for its countdown —
// so "YOU WIN!"/"YOU LOSE!" and each player's own Rematch/Quit always face the player they're for.
export default function RoundOverDialog({ orientationMode, p1OnRight, rotation, humanPlayers, gameMode, outcome, colors, profileUnlocked = {}, rematchReady, onRequestRematch, onQuit }: RoundOverDialogProps) {
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const cardBg = dark ? '#111111' : '#F2F2F2'
  const cardBorder = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'
  const fgMuted = dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'
  const onColors: Record<Player, string> = { 1: themeColors.onPrimary, 2: themeColors.onSecondary }
  // Quit deliberately avoids themeColors.secondary — Rematch already renders in colors[player], the
  // *viewing* player's own identity color, which for player 2 IS themeColors.secondary. Reusing it
  // here made Rematch and Quit render as the exact same color on player 2's own dialog (fine for
  // player 1, whose color is primary instead) — per explicit user feedback that the pair read as
  // "too much of one color" rather than two distinct actions. A neutral gray reads correctly
  // regardless of which player, or which theme-color slot, is looking at it.
  const quitBg = dark ? '#2A2A2A' : '#E0E0E0'
  const quitFg = dark ? '#FFFFFF' : '#000000'

  // Text/icon/color as seen from `player`'s own perspective — the only one of the three (win/lose/
  // draw) that's symmetric between the two players is the draw case.
  const perspective = (player: Player) => {
    if (outcome.type === 'draw') return { text: 'DRAW', icon: 'handshake-outline', color: fgMuted }
    if (outcome.winner === player) return { text: 'YOU WIN!', icon: 'trophy', color: colors[player] }
    // This player lost — vsCpu keeps its existing "CPU WINS!" copy (matching the CPU's own robot
    // icon elsewhere) rather than a generic "YOU LOSE!", which would misname who actually won.
    if (gameMode === 'vsCpu') return { text: 'CPU WINS!', icon: 'robot', color: fgMuted }
    return { text: 'YOU LOSE!', icon: 'emoticon-sad-outline', color: fgMuted }
  }

  if (humanPlayers.length === 1) {
    const player = humanPlayers[0]
    const { text, icon, color } = perspective(player)
    const ready = rematchReady[player]
    return (
      <View style={styles.overlay}>
        <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }, rotation % 360 !== 0 && { transform: [{ rotate: `${rotation}deg` }] }]}>
          <Icon source={icon} size={64} color={color} />
          <Text variant='headlineLarge' style={[styles.overlayTitle, { color }]}>
            {text}
          </Text>
          {/* Quit listed before Rematch: both cards below get rotated to face whichever player
          they're for, and that rotation is defined so the LAST item always lands nearest that
          player's own hands (see renderCard's identical ordering/comment) — so this order is what
          makes Rematch, not Quit, the easier reach. */}
          <Button mode='contained' onPress={onQuit} style={styles.overlayButton} buttonColor={quitBg} textColor={quitFg}>
            Quit
          </Button>
          <Button mode='contained' disabled={ready} onPress={() => onRequestRematch(player)} style={styles.overlayButton} buttonColor={colors[player]} textColor={onColors[player]}>
            {ready ? 'Waiting…' : 'Rematch'}
          </Button>
        </View>
      </View>
    )
  }

  const isFaceToFace = orientationMode === 'faceToFace'
  // Matches OnboardingOverlay's identical split exactly, so a player's zone never swaps sides
  // between the countdown and this dialog.
  const p1Zone = isFaceToFace ? styles.zoneBottom : p1OnRight ? styles.zoneRight : styles.zoneLeft
  const p2Zone = isFaceToFace ? styles.zoneTop : p1OnRight ? styles.zoneLeft : styles.zoneRight

  const renderCard = (player: Player) => {
    const { text, icon, color } = perspective(player)
    const ready = rematchReady[player]
    // getOpposingZoneRotation, not the board's own always-'faceToFace' orientationMode above (that's
    // structural — isFaceToFace is always true here, so it can never stand in for an actual live
    // landscape hold) — see that function's own doc for why P2's card only gets the +180 baseline
    // flip in portrait, not landscape.
    const cardRotation = player === 2 ? getOpposingZoneRotation(rotation) : rotation
    const unlocked = profileUnlocked[player]
    return (
      <View style={[styles.zoneCard, { backgroundColor: cardBg, borderColor: cardBorder }, cardRotation % 360 !== 0 && { transform: [{ rotate: `${cardRotation}deg` }] }]}>
        <Icon source={icon} size={28} color={color} />
        <Text variant='headlineSmall' style={[styles.overlayTitle, { color }]}>
          {text}
        </Text>
        {/* Rides along on this player's own card — already rotated/zoned to face them, same as
        everything else here — rather than a separate floating toast, which has no natural "which
        side of the device" concept of its own. */}
        {unlocked && unlocked.length > 0 && (
          <View style={styles.achievementBadge}>
            <Icon source='trophy-award' size={16} color={color} />
            <Text variant='labelSmall' style={{ color }}>
              {unlocked.length === 1 ? `${unlocked[0].title} unlocked!` : `${unlocked.length} achievements unlocked!`}
            </Text>
          </View>
        )}
        {/* Quit before Rematch — this card gets rotated (see cardRotation above) to read right-side-up
        from this player's own side of the device, which puts whichever button is authored LAST
        nearest their hands. Listing Rematch last makes it the easier reach for both players. */}
        <Button mode='contained' onPress={onQuit} style={styles.zoneButton} labelStyle={styles.zoneButtonLabel} buttonColor={quitBg} textColor={quitFg}>
          Quit
        </Button>
        <Button mode='contained' disabled={ready} onPress={() => onRequestRematch(player)} style={styles.zoneButton} labelStyle={styles.zoneButtonLabel} buttonColor={colors[player]} textColor={onColors[player]}>
          {ready ? 'Waiting…' : 'Rematch'}
        </Button>
      </View>
    )
  }

  return (
    <View style={styles.overlay}>
      <View style={[styles.zone, p1Zone, { borderColor: colors[1], backgroundColor: `${colors[1]}22` }]}>{renderCard(1)}</View>
      <View style={[styles.zone, p2Zone, { borderColor: colors[2], backgroundColor: `${colors[2]}22` }]}>{renderCard(2)}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  achievementBadge: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: -2
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
  // headlineLarge/headlineSmall's own line-height leaves slack under the glyphs that the flex `gap`
  // above stacks on top of — this claws it back, same fix game.tsx's own dialogs already use.
  overlayTitle: { fontWeight: 'bold', marginBottom: -8 },
  zone: {
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 3,
    justifyContent: 'center',
    // A per-player zone is exactly half the screen — on a short/landscape screen there isn't
    // always room for a full card (icon + title + two buttons) within that half. zoneCard is
    // already sized to comfortably fit realistic cases (see its own comment), but this is the
    // backstop for whatever's left: clipping at this zone's own edge reads as a minor crop in an
    // extreme case, instead of the two zones' cards spilling into and visibly overlapping each
    // other right at the shared seam.
    overflow: 'hidden',
    position: 'absolute'
  },
  zoneBottom: { bottom: 0, left: 0, right: 0, top: '50%' },
  zoneButton: { width: 130 },
  // marginVertical: 4 below (zoneButtonLabel) claws back react-native-paper's own default label
  // margin (10 per button, i.e. ~12px saved per button here) — combined with the smaller icon and
  // tighter gap/padding here, this keeps a full two-button card comfortably under half the height
  // of a typical short/landscape phone screen, so the overflow:hidden backstop above should only
  // ever actually clip in genuinely extreme cases.
  zoneButtonLabel: { marginVertical: 4 },
  zoneCard: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
    padding: 14
  },
  zoneLeft: { bottom: 0, left: 0, right: '50%', top: 0 },
  zoneRight: { bottom: 0, left: '50%', right: 0, top: 0 },
  zoneTop: { bottom: '50%', left: 0, right: 0, top: 0 }
})
