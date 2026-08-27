import { getOpposingZoneRotation, ViewRotation } from '@tastic/split-screen'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import RoundHistoryPips from '@/components/RoundHistoryPips'
import { MONO_FONT } from '@/constants/fonts'
import { ONBOARDING_COUNTDOWN_STEP_MS, ONBOARDING_FADE_MS, ONBOARDING_GO_HOLD_MS } from '@/constants/game'
import { useGameSound } from '@/hooks/useGameSound'
import { OrientationMode, Player, RoundOutcome } from '@/types'

export interface OnboardingOverlayProps {
  orientationMode: OrientationMode
  // Only meaningful when orientationMode === 'sideBySide' — see GameBoard.tsx's identical prop.
  p1OnRight: boolean
  // Live physical-hold rotation (see @tastic/split-screen's getViewRotation) — applied to the
  // countdown text itself, NOT the zone it sits in. Deliberately not a FakeLandscapeView wrapper
  // around this whole component: that swaps width/height to fake a landscape-shaped screen, which
  // is right for the lobby's genuinely-wide layout but wrong here — these zones must stay exactly
  // the same shape as the board's own fixed split (see orientationMode's own comment), or the
  // swap distorts a full-width/half-height zone into a narrow, tall one that no longer matches
  // where TouchInputLayer's own (unrotated) hit zones actually are. Only the text rotates in place.
  rotation: ViewRotation
  humanPlayers: Player[]
  p1Color: string
  p2Color: string
  // Oldest first. Empty on the very first round's countdown — the pip row only renders once
  // there's a round to show, which is what makes it read as "games so far this rematch streak"
  // rather than a fixed piece of chrome.
  roundHistory: RoundOutcome[]
  onComplete: () => void
}

const COUNTDOWN_STAGES = ['3', '2', '1', 'GO!']

// A temporary UI layer over the board — not part of the Skia canvas (see PLAN.md). Each player's
// touch zone is tinted in their own color, a quiet hint of where their swipes will register
// (mirrors TouchInputLayer's own hitSlop halves exactly: top/bottom for face-to-face, left/right
// for side-by-side) rather than a bold "P1"/"YOU" label — the zone shape alone already says where
// to touch. A "3, 2, 1, GO!" counts down inside each player's own zone — face-to-face's top zone
// gets its copy flipped 180°, matching the lobby's own rotated-P2-panel convention, so it reads
// right-side-up from that player's actual physical side of the device rather than upside-down.
// Solo (vs CPU) gets a single full-board zone — TouchInputLayer never splits the board when
// there's only one human to swipe on it. The whole thing fades out and calls onComplete.
export default function OnboardingOverlay({ orientationMode, p1OnRight, rotation, humanPlayers, p1Color, p2Color, roundHistory, onComplete }: OnboardingOverlayProps) {
  const opacity = useSharedValue(1)
  const [stageIndex, setStageIndex] = useState(0)

  const playCountdownTick = useGameSound(require('../../assets/sounds/countdown-tick.wav'))
  const playCountdownGo = useGameSound(require('../../assets/sounds/countdown-go.wav'))
  const soundRef = useRef({ playCountdownTick, playCountdownGo })
  useEffect(() => {
    soundRef.current = { playCountdownTick, playCountdownGo }
  }, [playCountdownTick, playCountdownGo])

  // Fires alongside every digit change, including the initial "3" on mount — kept as its own
  // effect (rather than folded into the mount-only timer effect below) so the countdown's own
  // scheduling stays untouched by which sound happens to play for a given stage.
  useEffect(() => {
    const isGo = stageIndex === COUNTDOWN_STAGES.length - 1
    if (isGo) soundRef.current.playCountdownGo()
    else soundRef.current.playCountdownTick()
  }, [stageIndex])

  useEffect(() => {
    const digitTimers = COUNTDOWN_STAGES.slice(1).map((_, i) => setTimeout(() => setStageIndex(i + 1), ONBOARDING_COUNTDOWN_STEP_MS * (i + 1)))
    const fadeTimer = setTimeout(
      () => {
        opacity.value = withTiming(0, { duration: ONBOARDING_FADE_MS }, (finished) => {
          if (finished) runOnJS(onComplete)()
        })
      },
      ONBOARDING_COUNTDOWN_STEP_MS * 3 + ONBOARDING_GO_HOLD_MS
    )
    return () => {
      digitTimers.forEach(clearTimeout)
      clearTimeout(fadeTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

  const isFaceToFace = orientationMode === 'faceToFace'
  const countdown = COUNTDOWN_STAGES[stageIndex]
  // Side-by-side: whichever player is on the right (see useAccelerometerOrientation) gets the right zone —
  // matches GameBoard.tsx's identical wallPath split.
  const p1Zone = isFaceToFace ? styles.zoneBottom : p1OnRight ? styles.zoneRight : styles.zoneLeft
  const p2Zone = isFaceToFace ? styles.zoneTop : p1OnRight ? styles.zoneLeft : styles.zoneRight

  return (
    <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]} pointerEvents='none'>
      {humanPlayers.length === 1 ? (
        <View style={[styles.zone, styles.zoneFull, { borderColor: humanPlayers[0] === 1 ? p1Color : p2Color, backgroundColor: `${humanPlayers[0] === 1 ? p1Color : p2Color}22` }]}>
          <Text style={[styles.countdown, { transform: [{ rotate: `${rotation}deg` }] }]}>{countdown}</Text>
          {/* Stacked in normal flow below the digit (rather than the absolutely-centered overlay
          used for the two-zone case below) since a solo zone's countdown is already dead-center —
          overlaying pips there would sit right on top of the digit instead of under it. */}
          {roundHistory.length > 0 && (
            <View style={styles.pipRowStacked}>
              <RoundHistoryPips roundHistory={roundHistory} p1Color={p1Color} p2Color={p2Color} />
            </View>
          )}
        </View>
      ) : (
        <>
          <View style={[styles.zone, p1Zone, { borderColor: p1Color, backgroundColor: `${p1Color}22` }]}>
            <Text style={[styles.countdown, { transform: [{ rotate: `${rotation}deg` }] }]}>{countdown}</Text>
          </View>
          <View style={[styles.zone, p2Zone, { borderColor: p2Color, backgroundColor: `${p2Color}22` }]}>
            {/* getOpposingZoneRotation, not the board's own always-'faceToFace' orientationMode above
            (that's structural — isFaceToFace is always true here, so it can never stand in for an
            actual live landscape hold) — see that function's own doc for why P2's digit only gets
            the +180 baseline flip in portrait, not landscape. */}
            <Text style={[styles.countdown, { transform: [{ rotate: `${getOpposingZoneRotation(rotation)}deg` }] }]}>{countdown}</Text>
          </View>

          {roundHistory.length > 0 && (
            <View style={styles.pipRowWrap}>
              <RoundHistoryPips roundHistory={roundHistory} p1Color={p1Color} p2Color={p2Color} />
            </View>
          )}
        </>
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  countdown: {
    color: '#FFFFFF',
    fontFamily: MONO_FONT,
    fontSize: 72,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { height: 2, width: 0 },
    textShadowRadius: 8
  },
  // Solo zone only — the countdown digit and this row are both children of the same centered
  // zone, so this margin is what separates them instead of the digit's own line-height doing it.
  pipRowStacked: {
    marginTop: 16
  },
  // Absolutely centered over both player zones (rather than living inside either one) so it reads
  // as a shared, whole-screen indicator regardless of orientation mode — sitting right on the seam
  // between the two zones for face-to-face and side-by-side alike.
  pipRowWrap: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  zone: {
    alignItems: 'center',
    borderStyle: 'dashed',
    borderWidth: 3,
    justifyContent: 'center',
    position: 'absolute'
  },
  zoneBottom: { bottom: 0, left: 0, right: 0, top: '50%' },
  zoneFull: { bottom: 0, left: 0, right: 0, top: 0 },
  zoneLeft: { bottom: 0, left: 0, right: '50%', top: 0 },
  zoneRight: { bottom: 0, left: '50%', right: 0, top: 0 },
  zoneTop: { bottom: '50%', left: 0, right: 0, top: 0 }
})
