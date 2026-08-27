import { StyleSheet, View } from 'react-native'
import { Icon } from 'react-native-paper'

import { POWERUP_ICONS } from '@/constants/game'
import { OrientationMode, Player, PlayerState } from '@/types'

export interface PowerupHudProps {
  players: Record<Player, PlayerState>
  orientationMode: OrientationMode
  // Only meaningful when orientationMode === 'sideBySide' — see GameBoard.tsx's identical prop.
  p1OnRight: boolean
}

const BADGE_SIZE = 30

// Both players' held item is always visible to both — there's no realistic way to hide it anyway
// on a single shared screen where each player's own zone is already fully visible to the other
// (same as a rival's held item being visible in Mario Kart). The item's TYPE is the only thing
// that's a mystery (see GameBoard.tsx's Powerups layer) — once held, it's revealed here. Kept
// deliberately understated (small, low-opacity, no per-player color) — this is a quiet reference,
// not something that should compete for attention with the board itself.
function HeldItemBadge({ heldPowerup }: { heldPowerup: PlayerState['heldPowerup'] }) {
  return <View style={styles.badge}>{heldPowerup && <Icon source={POWERUP_ICONS[heldPowerup]} size={16} color='rgba(255,255,255,0.85)' />}</View>
}

// First persistent in-play overlay this screen has ever had (see game.tsx, where today nothing
// shows during phase === 'playing'). Corner picked per player from orientationMode/p1OnRight —
// same "is this player on the right" convention as GameBoard.tsx's wallPath and
// TouchInputLayer.tsx's zone split — so each badge always sits in that player's own zone rather
// than a side fixed regardless of which way the device was rotated. In faceToFace, column doesn't
// matter (each player's zone spans the full width), so player 1 stays bottom and player 2 stays
// top regardless of p1OnRight.
export function PowerupHud({ players, orientationMode, p1OnRight }: PowerupHudProps) {
  const p1OnRightSide = orientationMode === 'sideBySide' && p1OnRight
  const p2OnLeftSide = orientationMode === 'sideBySide' && !p1OnRight
  return (
    <>
      <View pointerEvents='none' style={p1OnRightSide ? styles.bottomRight : styles.bottomLeft}>
        <HeldItemBadge heldPowerup={players[1].heldPowerup} />
      </View>
      <View pointerEvents='none' style={p2OnLeftSide ? styles.topLeft : styles.topRight}>
        <HeldItemBadge heldPowerup={players[2].heldPowerup} />
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: BADGE_SIZE / 2,
    borderWidth: 1,
    height: BADGE_SIZE,
    justifyContent: 'center',
    opacity: 0.7,
    width: BADGE_SIZE
  },
  bottomLeft: { bottom: 12, left: 12, position: 'absolute' },
  bottomRight: { bottom: 12, position: 'absolute', right: 12 },
  topLeft: { left: 12, position: 'absolute', top: 12 },
  topRight: { position: 'absolute', right: 12, top: 12 }
})
