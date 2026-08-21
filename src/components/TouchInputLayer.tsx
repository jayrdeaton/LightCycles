import { useVibration } from '@rific/feedback-press'
import { useCallback, useMemo, useState } from 'react'
import { LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS } from 'react-native-reanimated'

import { useGameSound } from '@/hooks/useGameSound'
import { Direction, KeyScheme, OrientationMode, Player } from '@/types'
import { resolveTurnIntent } from '@/utils/turnIntent'

export interface TouchInputLayerProps {
  orientationMode: OrientationMode
  // [1, 2] for pass-and-play (the usual two-zone split below); [1] or [2] for vs-CPU, where the
  // single human gets the whole board as their input area — see the solo branch below.
  humanPlayers: Player[]
  enabled: boolean
  onTurn: (player: Player, direction: Direction) => void
  // Web-only (see TouchInputLayer.web.tsx) — kept on the shared prop shape but unused here, same as
  // this file's own asymmetric use of humanPlayers relative to the web version.
  keyScheme: Record<Player, KeyScheme>
}

// Two independent single-finger Pan gestures, composed with Gesture.Simultaneous so neither can
// block or cancel the other when both players flick at once (see PLAN.md's Input Architecture).
// Each Pan is bound to its own half of this layer via `hitSlop` (a negative inset shrinks the
// activation region from that edge) rather than two separate overlaid Views — RNGH's own hit-
// testing against that region, using each touch's start coordinate, IS the "classify by start
// coordinate, not continuous tracking" the plan calls for; there's no extra manual classification
// to write. The canvas underneath stays one undivided render — only touch handling is zoned.
export default function TouchInputLayer({ orientationMode, humanPlayers, enabled, onTurn }: TouchInputLayerProps) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const solo = humanPlayers.length === 1

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setSize({ width, height })
  }, [])

  const playTurn = useGameSound(require('../../assets/sounds/turn.wav'), { poolSize: 8 })
  const { selection } = useVibration()

  const handleTurn = useCallback(
    (player: Player, translationX: number, translationY: number) => {
      const direction = resolveTurnIntent({ player, translationX, translationY, orientationMode })
      if (direction) {
        onTurn(player, direction)
        playTurn()
        selection()
      }
    },
    [orientationMode, onTurn, playTurn, selection]
  )

  const gesture = useMemo(() => {
    if (size.width === 0 || size.height === 0) return null

    const makePlayerPan = (player: Player, hitSlop: { top?: number; bottom?: number; left?: number; right?: number }) =>
      Gesture.Pan()
        .maxPointers(1)
        .minDistance(0)
        .hitSlop(hitSlop)
        .enabled(enabled)
        .onEnd((e) => {
          runOnJS(handleTurn)(player, e.translationX, e.translationY)
        })

    if (solo) return makePlayerPan(humanPlayers[0], {})

    // Face-to-face: top/bottom split (player 1 = near/bottom zone, since player 1 is assumed to be
    // the device's owner and the near zone faces them; player 2 = far/top zone).
    // Side-by-side (and web's shared layout): left/right split (player 1 = left, player 2 = right).
    const p1Pan = orientationMode === 'faceToFace' ? makePlayerPan(1, { top: -(size.height / 2) }) : makePlayerPan(1, { right: -(size.width / 2) })
    const p2Pan = orientationMode === 'faceToFace' ? makePlayerPan(2, { bottom: -(size.height / 2) }) : makePlayerPan(2, { left: -(size.width / 2) })

    return Gesture.Simultaneous(p1Pan, p2Pan)
  }, [size, orientationMode, humanPlayers, solo, enabled, handleTurn])

  if (!gesture) {
    return <View style={StyleSheet.absoluteFill} onLayout={onLayout} />
  }

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} onLayout={onLayout} />
    </GestureDetector>
  )
}
