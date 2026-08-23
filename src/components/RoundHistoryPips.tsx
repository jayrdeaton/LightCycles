import { StyleSheet, View } from 'react-native'

import { RoundOutcome } from '@/types'

export interface RoundHistoryPipsProps {
  // Oldest first — same order the score was actually built in, so the row reads left-to-right as
  // a timeline rather than a shuffled tally.
  roundHistory: RoundOutcome[]
  p1Color: string
  p2Color: string
}

const DRAW_PIP_COLOR = '#9E9E9E'

// One dot per round played this match/streak, colored by who took it — shared between
// OnboardingOverlay (over the board, between rounds) and game.tsx's quit-confirmation dialog (the
// actual stakes of walking away), so "the score so far" always reads as the same row of dots
// rather than two different representations of the same data.
export default function RoundHistoryPips({ roundHistory, p1Color, p2Color }: RoundHistoryPipsProps) {
  return (
    <View style={styles.pipRow}>
      {roundHistory.map((result, i) => (
        <View key={i} style={[styles.pip, { backgroundColor: result.type === 'win' ? (result.winner === 1 ? p1Color : p2Color) : DRAW_PIP_COLOR }]} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  pip: {
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 5,
    borderWidth: 1.5,
    height: 10,
    width: 10
  },
  pipRow: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8
  }
})
