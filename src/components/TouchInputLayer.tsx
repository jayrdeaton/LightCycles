import { useVibration } from '@rific/feedback-press'
import { applyControlInversion, isEffectiveTurn } from '@tastic/input'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS, SharedValue, useSharedValue } from 'react-native-reanimated'

import { useGameSound } from '@/hooks/useGameSound'
import { Direction, KeyScheme, OrientationMode, Player } from '@/types'
import { resolveTurnIntent, TAP_MAX_DISTANCE } from '@/utils/turnIntent'

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
  // Each player's current heading, straight from game state — used to gate turn feedback
  // (sound/haptic) on isEffectiveTurn, so continuing straight or reversing 180° (both of which
  // applyTurnIntent silently no-ops in gameEngine.ts) doesn't fire feedback for a turn that never
  // actually happens.
  currentDirections: Record<Player, Direction>
}

// Two independent single-finger Pan gestures, each on its OWN View (sized/positioned to its own
// half — see p1ZoneStyle/p2ZoneStyle below) rather than one shared View split via `hitSlop`. A
// single view hosting two hitSlop-zoned recognizers looks equivalent on paper (RNGH hit-tests each recognizer's own
// region against a touch's start coordinate either way), but only actually holds up when the two
// touches start at distinct moments — two fingers landing in the same native touch-event batch
// (a genuine simultaneous two-player swipe, not two swipes a few frames apart) raced on which
// recognizer claimed which pointer, and lost one or both turns entirely. Two separate native
// views/recognizers have nothing left to race: each one only ever sees the pointer that landed on
// it. The canvas underneath still stays one undivided render — only touch handling is zoned.
export default function TouchInputLayer({ orientationMode, p1OnRight, humanPlayers, enabled, onTurn, onActivate, controlInverted, currentDirections }: TouchInputLayerProps) {
  const solo = humanPlayers.length === 1

  const playTurn = useGameSound(require('../../assets/sounds/turn.wav'), { poolSize: 8 })
  const playActivate = useGameSound(require('../../assets/sounds/select.wav'), { poolSize: 4 })
  const { selection } = useVibration()

  // Everything handleTurn/handleActivate need, kept in a ref rather than closed over directly, so
  // those two callbacks — and therefore makePlayerGesture and the Gesture objects it builds below
  // — can stay referentially stable across renders. currentDirections in particular is a fresh
  // object every single game tick (see game.tsx), so closing over it directly meant rebuilding
  // every Gesture.Pan()/Gesture.Tap() several times a second during play: RNGH tears down and
  // re-attaches its native recognizer on every new gesture object handed to GestureDetector, and a
  // touch that starts (or is mid-drag) exactly while that re-attach is happening loses its
  // recognizer state — no onStart, no onUpdate, nothing, for either finger. Reproduced directly:
  // logging inside onStart showed it firing reliably for isolated single swipes but silently
  // skipping on others with no code change in between, and dropping out almost every time under a
  // genuine two-finger simultaneous swipe (twice the exposure to the same race). None of this ref
  // plumbing is itself observable — it only exists to keep the gesture objects from being rebuilt
  // on a timer that has nothing to do with the player's actual touch.
  const latestRef = useRef({ onTurn, onActivate, controlInverted, currentDirections, playTurn, playActivate, selection })
  useEffect(() => {
    latestRef.current = { onTurn, onActivate, controlInverted, currentDirections, playTurn, playActivate, selection }
  })

  const handleTurn = useCallback((player: Player, direction: Direction) => {
    const { onTurn, controlInverted, currentDirections, playTurn, selection } = latestRef.current
    const invertedDirection = applyControlInversion(direction, controlInverted[player])
    onTurn(player, invertedDirection)
    if (isEffectiveTurn(invertedDirection, currentDirections[player])) {
      playTurn()
      selection()
    }
  }, [])

  const handleActivate = useCallback((player: Player) => {
    const { onActivate, playActivate, selection } = latestRef.current
    onActivate(player)
    playActivate()
    selection()
  }, [])

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

  // Resolves a turn continuously during the drag (onUpdate) instead of once at release, so a
  // player can chain several turns within one continuous touch without lifting their finger.
  // `base` tracks where the current segment started (in the gesture's own translation frame);
  // once a segment's delta crosses MIN_SWIPE_DISTANCE in some direction, `base` snaps to the
  // current point so the *next* segment is measured fresh, keeping detection responsive even
  // after a long drag. Firing onTurn is gated on the direction actually changing from the last
  // one recognized in this touch, so holding a straight line doesn't repeat the same dispatch
  // every MIN_SWIPE_DISTANCE px. That alone doesn't stop feedback for a swipe along the player's
  // current heading or its exact reverse — direction here still differs from lastDirection.value
  // (null) the first time either is swiped in a touch — so handleTurn separately gates its own
  // sound/haptic on isEffectiveTurn against the player's actual current heading.
  const makePlayerGesture = useCallback(
    (player: Player, base: SharedValue<{ x: number; y: number }>, lastDirection: SharedValue<Direction | null>) => {
      const pan = Gesture.Pan()
        .maxPointers(1)
        .minDistance(0)
        // Empty, but required: Gesture.Simultaneous(pan, tap) below silently never recognizes
        // either gesture — no onStart, no onUpdate, nothing — when neither has an explicit
        // hitSlop() call. A bare Pan alone (no Tap composed in) works fine without it; it's
        // specifically the Simultaneous+Tap combination that needs it. Reproduced against RNGH
        // 2.32.0. Both gestures need it, matching each other.
        .hitSlop({})
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
      // simultaneously with the Pan (see the Gesture.Simultaneous below) on the same zoned view;
      // `success` is false if the gesture failed (drifted too far, or was cancelled), so only a
      // real, released tap fires activation.
      const tap = Gesture.Tap()
        .maxDistance(TAP_MAX_DISTANCE)
        .hitSlop({})
        .enabled(enabled)
        .onEnd((_event, success) => {
          if (success) runOnJS(handleActivate)(player)
        })

      return Gesture.Simultaneous(pan, tap)
    },
    [enabled, orientationMode, handleTurn, handleActivate]
  )

  const soloGesture = useMemo(() => (solo ? makePlayerGesture(humanPlayers[0], baseFor(humanPlayers[0]), lastDirectionFor(humanPlayers[0])) : null), [solo, humanPlayers, makePlayerGesture]) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/refs -- baseFor/lastDirectionFor read stable SharedValue refs (like useRef), not reactive state; SharedValue.value is only ever read inside worklet/event callbacks, never synchronously during render, despite the shape looking ref-like to this rule
  const p1Gesture = useMemo(() => (solo ? null : makePlayerGesture(1, p1Base, p1LastDirection)), [solo, makePlayerGesture]) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/refs -- p1Base/p1LastDirection are stable SharedValue refs (like useRef), not reactive state; SharedValue.value is only ever read inside worklet/event callbacks, never synchronously during render
  const p2Gesture = useMemo(() => (solo ? null : makePlayerGesture(2, p2Base, p2LastDirection)), [solo, makePlayerGesture]) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/refs -- p2Base/p2LastDirection are stable SharedValue refs (like useRef), not reactive state; SharedValue.value is only ever read inside worklet/event callbacks, never synchronously during render

  if (solo) {
    return (
      <GestureDetector gesture={soloGesture!}>
        {/* collapsable={false}: without a prop that makes it stand out, RN's view-flattening
        optimization merges this plain View into its parent, and GestureDetector's ref then attaches
        to nothing — the gesture silently never receives a single touch. */}
        <View collapsable={false} style={StyleSheet.absoluteFill} />
      </GestureDetector>
    )
  }

  // Face-to-face: top/bottom split (player 1 = near/bottom zone, since player 1 is assumed to be
  // the device's owner and the near zone faces them; player 2 = far/top zone).
  // Side-by-side (and web's shared layout): whichever player is on the right (see useAccelerometerOrientation)
  // gets the right zone — matches GameBoard.tsx's identical wallPath split. Percentage-based (not
  // measured pixel) rects, unlike the old hitSlop approach, so no onLayout/size plumbing is needed
  // just to zone these two views.
  const isFaceToFace = orientationMode === 'faceToFace'
  const p1ZoneStyle = isFaceToFace ? styles.zoneBottom : p1OnRight ? styles.zoneRight : styles.zoneLeft
  const p2ZoneStyle = isFaceToFace ? styles.zoneTop : p1OnRight ? styles.zoneLeft : styles.zoneRight

  return (
    <View style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={p1Gesture!}>
        <View collapsable={false} style={[styles.zone, p1ZoneStyle]} />
      </GestureDetector>
      <GestureDetector gesture={p2Gesture!}>
        <View collapsable={false} style={[styles.zone, p2ZoneStyle]} />
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  zone: { position: 'absolute' },
  zoneBottom: { bottom: 0, left: 0, right: 0, top: '50%' },
  zoneLeft: { bottom: 0, left: 0, right: '50%', top: 0 },
  zoneRight: { bottom: 0, left: '50%', right: 0, top: 0 },
  zoneTop: { bottom: '50%', left: 0, right: 0, top: 0 }
})
