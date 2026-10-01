import { useAutoPaperTheme } from '@rific/auto-paper'
import { StyleSheet, View } from 'react-native'
import { Icon } from 'react-native-paper'

// LightCycles-specific illustrations for the how-to-play cards (see constants/guideSteps.tsx). The
// generic ones (SwipeHint, DirectionKeysHint, SeatDiagram, SeatDevicesHint) live in @tastic/hud/guide;
// what's here only makes sense for this game. Plain Views and one Icon: no Skia, so it costs nothing to
// mount over the Home screen.

// Player 2's trail running into player 1's — the whole "don't touch a trail" rule in one picture.
// Seat colors come from the live theme (primary = P1, secondary = P2), so it always matches the
// colors the players have actually picked.
export function GuideTrailCrash() {
  const { colors } = useAutoPaperTheme()

  return (
    <View accessible accessibilityLabel="A cycle crashing into another cycle's trail" style={styles.stage}>
      <View style={[styles.trailAcross, { backgroundColor: colors.primary }]} />
      <View style={[styles.trailDown, { backgroundColor: colors.secondary }]} />
      <View style={[styles.head, { backgroundColor: colors.primary }]} />
      <View style={styles.crash}>
        <Icon source='close-thick' size={30} color={colors.error} />
      </View>
    </View>
  )
}

const TRAIL = 6

const styles = StyleSheet.create({
  crash: {
    left: 72,
    position: 'absolute',
    top: 43
  },
  head: {
    borderRadius: 7,
    height: 14,
    left: 132,
    position: 'absolute',
    top: 54,
    width: 14
  },
  stage: {
    height: 108,
    width: 156
  },
  trailAcross: {
    height: TRAIL,
    left: 16,
    position: 'absolute',
    top: 58,
    width: 124
  },
  trailDown: {
    height: 42,
    left: 85,
    position: 'absolute',
    top: 12,
    width: TRAIL
  }
})
