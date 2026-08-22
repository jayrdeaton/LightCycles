import { StyleSheet, View } from 'react-native'
import { Icon } from 'react-native-paper'

import { POWERUP_ICONS } from '@/constants/game'
import { OrientationMode, Player, PlayerState } from '@/types'

export interface PowerupHudProps {
  players: Record<Player, PlayerState>
  orientationMode: OrientationMode
  // Only meaningful when orientationMode === 'sideBySide' — see useP1OnRight and GameBoard.tsx's
  // identical prop, which this positioning mirrors.
  p1OnRight: boolean
}

const BADGE_SIZE = 40

// Both players' held item is always visible to both — there's no realistic way to hide it anyway
// on a single shared screen where each player's own zone is already fully visible to the other
// (same as a rival's held item being visible in Mario Kart). The item's TYPE is the only thing
// that's a mystery (see GameBoard.tsx's Powerups layer) — once held, it's revealed here.
function HeldItemBadge({ heldPowerup, color }: { heldPowerup: PlayerState['heldPowerup']; color: string }) {
  return <View style={[styles.badge, { borderColor: heldPowerup ? color : 'rgba(255,255,255,0.25)' }]}>{heldPowerup && <Icon source={POWERUP_ICONS[heldPowerup]} size={20} color={color} />}</View>
}

// First persistent in-play overlay this screen has ever had (see game.tsx, where today nothing
// shows during phase === 'playing') — positioned in the bottom corners specifically so it never
// collides with the existing top-corner back/settings/peek buttons.
export function PowerupHud({ players, orientationMode, p1OnRight }: PowerupHudProps) {
  const p1Badge = <HeldItemBadge heldPowerup={players[1].heldPowerup} color={players[1].color} />
  const p2Badge = <HeldItemBadge heldPowerup={players[2].heldPowerup} color={players[2].color} />

  if (orientationMode === 'faceToFace') {
    return (
      <>
        <View pointerEvents='none' style={styles.bottomCenter}>
          {p1Badge}
        </View>
        {/* Player 2's zone is rotated 180° to face them from the opposite side of the device (see
        game.tsx's onboarding/round-over chrome) — their own badge matches that rotation rather
        than reading upside-down to them. */}
        <View pointerEvents='none' style={[styles.topCenter, styles.rotated180]}>
          {p2Badge}
        </View>
      </>
    )
  }

  const leftBadge = p1OnRight ? p2Badge : p1Badge
  const rightBadge = p1OnRight ? p1Badge : p2Badge
  return (
    <>
      <View pointerEvents='none' style={styles.bottomLeft}>
        {leftBadge}
      </View>
      <View pointerEvents='none' style={styles.bottomRight}>
        {rightBadge}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: BADGE_SIZE / 2,
    borderWidth: 2,
    height: BADGE_SIZE,
    justifyContent: 'center',
    width: BADGE_SIZE
  },
  bottomCenter: { alignItems: 'center', bottom: 12, left: 0, position: 'absolute', right: 0 },
  bottomLeft: { bottom: 12, left: 12, position: 'absolute' },
  bottomRight: { bottom: 12, position: 'absolute', right: 12 },
  rotated180: { transform: [{ rotate: '180deg' }] },
  topCenter: { alignItems: 'center', left: 0, position: 'absolute', right: 0, top: 12 }
})
