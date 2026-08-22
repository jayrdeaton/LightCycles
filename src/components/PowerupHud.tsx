import { StyleSheet, View } from 'react-native'
import { Icon } from 'react-native-paper'

import { POWERUP_ICONS } from '@/constants/game'
import { Player, PlayerState } from '@/types'

export interface PowerupHudProps {
  players: Record<Player, PlayerState>
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
// shows during phase === 'playing'). Fixed corners — bottom-left for player 1, top-right for
// player 2 — rather than adapting to orientationMode/p1OnRight: position alone already tells the
// two apart, and top-right only ever coincides with the settings cog during 'onboarding'/
// 'roundOver', phases this HUD is never shown in (see game.tsx's own gating), so there's no
// runtime collision to guard against.
export function PowerupHud({ players }: PowerupHudProps) {
  return (
    <>
      <View pointerEvents='none' style={styles.bottomLeft}>
        <HeldItemBadge heldPowerup={players[1].heldPowerup} />
      </View>
      <View pointerEvents='none' style={styles.topRight}>
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
  topRight: { position: 'absolute', right: 12, top: 12 }
})
