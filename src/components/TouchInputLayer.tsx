import { useVibration } from '@rific/feedback-press'
import { useCallback, useMemo, useState } from 'react'
import { LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS, SharedValue, useSharedValue } from 'react-native-reanimated'

import { useGameSound } from '@/hooks/useGameSound'
import { Direction, KeyScheme, OrientationMode, Player } from '@/types'
import { applyControlInversion, resolveTurnIntent, TAP_MAX_DISTANCE } from '@/utils/turnIntent'

export interface TouchInputLayerProps {
  orientationMode: OrientationMode
  // Only meaningful when orientationMode === 'sideBySide' — see GameBoard.tsx's identical prop.
  p1OnRight: boolean
  // [1, 2] for pass-and-play (the usual two-zone split below); [1] or [2] for vs-CPU, where the
  // single human gets the whole board as their input area — see the solo branch below.
  humanPlayers: Player[]
  enabled: boolean
  onTurn: (player: Player, direction: Direction) => void
  // Fires the player's held powerup — see makePlayerGesture's own Gesture.Tap below, a dedicated
  // recognizer for "was this a tap" rather than one inferred from the Pan's own drag state.
  onActivate: (player: Player) => void
  // Whether Hack currently has this player's steering inverted — applied here, at the single
  // JS-thread chokepoint every recognized turn already flows through (handleTurn), not inside the
  // UI-thread gesture worklet itself.
  controlInverted: Record<Player, boolean>
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
export default function TouchInputLayer({ orientationMode, p1OnRight, humanPlayers, enabled, onTurn, onActivate, controlInverted }: TouchInputLayerProps) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  const solo = humanPlayers.length === 1

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setSize({ width, height })
  }, [])

  const playTurn = useGameSound(require('../../assets/sounds/turn.wav'), { poolSize: 8 })
  const playActivate = useGameSound(require('../../assets/sounds/select.wav'), { poolSize: 4 })
  const { selection } = useVibration()

  const handleTurn = useCallback(
    (player: Player, direction: Direction) => {
      onTurn(player, applyControlInversion(direction, controlInverted[player]))
      playTurn()
      selection()
    },
    [onTurn, controlInverted, playTurn, selection]
  )

  const handleActivate = useCallback(
    (player: Player) => {
      onActivate(player)
      playActivate()
      selection()
    },
    [onActivate, playActivate, selection]
  )

  // Per-player drag state, read/written from the UI-thread gesture worklets below (never touched
  // from JS) so a whole continuous touch can be tracked without bouncing through React state.
  // `base` is the translation (relative to the gesture's own onStart) at which the *current*
  // segment began; `lastDirection` is the most recent direction recognized within this touch.
  const p1Base = useSharedValue({ x: 0, y: 0 })
  const p2Base = useSharedValue({ x: 0, y: 0 })
  const p1LastDirection = useSharedValue<Direction | null>(null)
  const p2LastDirection = useSharedValue<Direction | null>(null)
  const baseFor = (player: Player) => (player === 1 ? p1Base : p2Base)
  const lastDirectionFor = (player: Player) => (player === 1 ? p1LastDirection : p2LastDirection)

  const gesture = useMemo(() => {
    if (size.width === 0 || size.height === 0) return null

    // Resolves a turn continuously during the drag (onUpdate) instead of once at release, so a
    // player can chain several turns within one continuous touch without lifting their finger.
    // `base` tracks where the current segment started (in the gesture's own translation frame);
    // once a segment's delta crosses MIN_SWIPE_DISTANCE in some direction, `base` snaps to the
    // current point so the *next* segment is measured fresh, keeping detection responsive even
    // after a long drag. Firing onTurn (and its sound/haptic) is gated on the direction actually
    // changing from the last one recognized in this touch, so holding a straight line doesn't
    // repeat the same turn every MIN_SWIPE_DISTANCE px — applyTurnIntent's own same-direction no-op
    // (see gameEngine.ts) would make repeats harmless for the game state, but not for the feedback.
    const makePlayerGesture = (player: Player, base: SharedValue<{ x: number; y: number }>, lastDirection: SharedValue<Direction | null>, hitSlop: { top?: number; bottom?: number; left?: number; right?: number }) => {
      const pan = Gesture.Pan()
        .maxPointers(1)
        .minDistance(0)
        .hitSlop(hitSlop)
        .enabled(enabled)
        .onStart(() => {
          base.value = { x: 0, y: 0 }
          lastDirection.value = null
        })
        .onUpdate((e) => {
          const direction = resolveTurnIntent({
            player,
            translationX: e.translationX - base.value.x,
            translationY: e.translationY - base.value.y,
            orientationMode
          })
          if (!direction) return
          base.value = { x: e.translationX, y: e.translationY }
          if (direction !== lastDirection.value) {
            lastDirection.value = direction
            runOnJS(handleTurn)(player, direction)
          }
        })

      // A dedicated, purpose-built recognizer for "was this a tap" — TAP_MAX_DISTANCE, kept below
      // MIN_SWIPE_DISTANCE, is what RNGH itself uses to decide the gesture failed once a finger
      // drifts too far, rather than this file re-deriving "no swipe direction was ever recognized"
      // from the Pan's own state (the previous approach — occasionally left a genuine but slightly
      // wobbly tap unrecognized, since human touches are rarely perfectly stationary). Runs
      // simultaneously with the Pan (see the Gesture.Simultaneous below), sharing its hitSlop so
      // taps and drags are zoned identically; `success` is false if the gesture failed (drifted too
      // far, or was cancelled), so only a real, released tap fires activation.
      const tap = Gesture.Tap()
        .maxDistance(TAP_MAX_DISTANCE)
        .hitSlop(hitSlop)
        .enabled(enabled)
        .onEnd((_event, success) => {
          if (success) runOnJS(handleActivate)(player)
        })

      return Gesture.Simultaneous(pan, tap)
    }

    if (solo) return makePlayerGesture(humanPlayers[0], baseFor(humanPlayers[0]), lastDirectionFor(humanPlayers[0]), {})

    // Face-to-face: top/bottom split (player 1 = near/bottom zone, since player 1 is assumed to be
    // the device's owner and the near zone faces them; player 2 = far/top zone).
    // Side-by-side (and web's shared layout): whichever player is on the right (see useP1OnRight)
    // gets the right zone — matches GameBoard.tsx's identical wallPath split.
    const p1HitSlop = p1OnRight ? { left: -(size.width / 2) } : { right: -(size.width / 2) }
    const p2HitSlop = p1OnRight ? { right: -(size.width / 2) } : { left: -(size.width / 2) }
    const p1Gesture = orientationMode === 'faceToFace' ? makePlayerGesture(1, p1Base, p1LastDirection, { top: -(size.height / 2) }) : makePlayerGesture(1, p1Base, p1LastDirection, p1HitSlop)
    const p2Gesture = orientationMode === 'faceToFace' ? makePlayerGesture(2, p2Base, p2LastDirection, { bottom: -(size.height / 2) }) : makePlayerGesture(2, p2Base, p2LastDirection, p2HitSlop)

    return Gesture.Simultaneous(p1Gesture, p2Gesture)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- p1Base/p2Base/p1LastDirection/p2LastDirection are stable SharedValue refs (like useRef), not reactive state
  }, [size, orientationMode, p1OnRight, humanPlayers, solo, enabled, handleTurn, handleActivate])

  if (!gesture) {
    return <View style={StyleSheet.absoluteFill} onLayout={onLayout} />
  }

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} onLayout={onLayout} />
    </GestureDetector>
  )
}
