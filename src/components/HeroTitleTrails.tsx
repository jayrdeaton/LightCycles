import { getContrastColor } from '@rific/auto-paper'
import { Canvas, Circle, Path, Skia, vec } from '@shopify/react-native-skia'
import { useEffect, useMemo } from 'react'
import { StyleSheet } from 'react-native'
import { Easing, useAnimatedReaction, useDerivedValue, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated'

import { TRAIL_CANVAS_PAD, TRAIL_TEXT_MARGIN_BOTTOM, TRAIL_TEXT_MARGIN_OUTER, TRAIL_TEXT_MARGIN_TOP, WordBox } from './heroTitleGeometry'

export interface HeroTitleTrailsProps {
  lightBox: WordBox
  cyclesBox: WordBox
  p1Color: string
  p2Color: string
  active: boolean
  // Delays the trail's own clock to start exactly when it becomes visible (AnimatedHeroTitle fades
  // this whole layer in well after mount). Without this, the clock — and the "grows from nothing"
  // first lap below — would run its course invisibly before anyone ever sees it start.
  startDelayMs: number
}

// Flat, un-blurred stroke — matches PlayerTrail's own trail rendering in GameBoard.tsx exactly,
// rather than inventing a separate glowing look for the title.
const TRAIL_STROKE_WIDTH = 3
const HEAD_RADIUS = 5
const HEAD_RING_WIDTH = 1.5
// A settled (non-animating) trail reads at the same dimmed opacity GameBoard.tsx uses for a
// round-over dead trail, rather than full brightness sitting still.
const STATIC_TRAIL_OPACITY = 0.6
// Trail length is a fraction of the SHORTER word's own perimeter, then shared as one absolute px
// length by both words — not a fraction applied independently to each word's own perimeter, which
// is what let "Cycles" (the longer loop) carry a longer trail in absolute px, reaching further past
// the shared corner and into "Light"'s territory. Measured against the actual rendered boxes at
// render time (see rectPerimeter below) rather than a guessed px constant — a guessed value
// silently stops matching reality if the font/copy ever changes, with no error to catch it.
const TRAIL_LENGTH_FRACTION = 0.44
// Both words share one lap duration rather than one px/sec speed, so their revolutions stay in
// sync — "Cycles" has a longer perimeter than "Light", so it moves faster to cover it in the same
// time instead of drifting in and out of phase with a shared px/sec pace.
const LAP_DURATION_MS = 3200

// Built by hand (moveTo/lineTo), sharp 90° corners — GameBoard.tsx's own trails are grid-based
// with sharp turns (only strokeCap/strokeJoin='round' softens the stroke itself at each joint,
// proportional to stroke width, not a deliberately-arced path), so this loop should turn the same
// way rather than sweeping through a wide rounded corner. Also gives an exact, guaranteed start
// point and initial direction rather than relying on addRRect's own convention: both words start
// at their own top-left corner, "Light" heading right (clockwise) and "Cycles" heading down
// (counter-clockwise) — a deliberate, matched pair of starting moves, not just "opposite windings"
// wherever that happens to land.
function wordPath(box: WordBox, clockwise: boolean) {
  // "Light" is clockwise with its seam on the right; "Cycles" is counter-clockwise with its seam
  // on the left (see HeroTitleTrails below) — so the margin goes on the opposite horizontal side
  // from whichever one that is, leaving the seam-facing edge untouched.
  const marginLeft = clockwise ? TRAIL_TEXT_MARGIN_OUTER : 0
  const marginRight = clockwise ? 0 : TRAIL_TEXT_MARGIN_OUTER

  const left = box.x + TRAIL_CANVAS_PAD - marginLeft
  const top = box.y + TRAIL_CANVAS_PAD - TRAIL_TEXT_MARGIN_TOP
  const right = left + box.width + marginLeft + marginRight
  const bottom = top + box.height + TRAIL_TEXT_MARGIN_TOP + TRAIL_TEXT_MARGIN_BOTTOM

  const path = Skia.Path.Make()
  path.moveTo(left, top)
  if (clockwise) {
    path.lineTo(right, top)
    path.lineTo(right, bottom)
    path.lineTo(left, bottom)
  } else {
    path.lineTo(left, bottom)
    path.lineTo(right, bottom)
    path.lineTo(right, top)
  }
  path.close()
  return path
}

// Exact perimeter of the same shape wordPath() draws (closed-form, no Skia needed): a plain
// rectangle, sharp corners. Takes the already-margin-expanded width/height (see wordTrailSize
// below), not the raw text box — the loop wordPath() actually draws is bigger than the measured
// text by the TRAIL_TEXT_MARGIN_* constants.
function rectPerimeter(width: number, height: number) {
  return 2 * (width + height)
}

// wordPath always adds TRAIL_TEXT_MARGIN_OUTER once to width (whichever single horizontal side
// isn't the seam) and TRAIL_TEXT_MARGIN_TOP + TRAIL_TEXT_MARGIN_BOTTOM to height — same total
// expansion regardless of which word.
function wordTrailSize(box: WordBox) {
  return { width: box.width + TRAIL_TEXT_MARGIN_OUTER, height: box.height + TRAIL_TEXT_MARGIN_TOP + TRAIL_TEXT_MARGIN_BOTTOM }
}

function WordTrail({ box, color, clockwise, active, trailLengthPx, startDelayMs }: { box: WordBox; color: string; clockwise: boolean; active: boolean; trailLengthPx: number; startDelayMs: number }) {
  // Keyed on box's own fields, not its identity — onLayout hands back a fresh object every fire
  // even when the measured values haven't actually changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const path = useMemo(() => wordPath(box, clockwise), [box.x, box.y, box.width, box.height, clockwise])

  // Measured once per path rebuild, not per frame — only t (below) drives per-frame motion.
  const { contour, length } = useMemo(() => {
    const c = Skia.ContourMeasureIter(path, true, 1).next()
    return { contour: c, length: c ? c.length() : 0 }
  }, [path])

  const segmentFraction = useMemo(() => (length > 0 ? trailLengthPx / length : 0), [length, trailLengthPx])

  const t = useSharedValue(0)
  // False for the very first lap only: piece B (below) is the "wrapped" tail that reads as trail
  // history from just before the loop's own start point — real history once the head has actually
  // been all the way around, but on the very first lap there IS no such history yet, so it must
  // stay suppressed or the trail would appear to already have a full-length tail the instant it
  // mounts, before the head has moved at all. Flips true forever the first time t wraps 1 -> 0.
  const hasLapped = useSharedValue(false)
  useEffect(() => {
    if (!active) {
      t.value = 0
      return
    }
    t.value = withDelay(startDelayMs, withRepeat(withTiming(1, { duration: LAP_DURATION_MS, easing: Easing.linear }), -1, false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // hasLapped is mutated only here (never inside the effect above) so it's reset the same way it's
  // set — reactively, off (t, active) — rather than splitting its two write sites across an effect
  // and a reaction, which is what trips react-hooks/immutability's cross-effect-mutation check.
  useAnimatedReaction(
    () => ({ t: t.value, active }),
    (current, previous) => {
      if (!current.active) {
        hasLapped.value = false
        return
      }
      if (previous !== null && current.t < previous.t) hasLapped.value = true
    }
  )

  // The trailing segment as two [start, end] fraction windows on the same base path — two pieces
  // rather than one so the segment can straddle the 0/1 seam without negative fractions. Whichever
  // piece isn't needed collapses to a zero-length [0,0] window instead of swapping paths in/out.
  // Piece A alone (0 -> t) is what makes the very first lap grow in from nothing: at t=0 it's
  // zero-length, and it grows linearly up to segmentFraction before piece A's own window starts
  // sliding — "no trail, then it grows to length, then follows at that distance," in one formula.
  const startA = useDerivedValue(() => (t.value >= segmentFraction ? t.value - segmentFraction : 0))
  const endA = useDerivedValue(() => t.value)
  const startB = useDerivedValue(() => (hasLapped.value && t.value < segmentFraction ? 1 - (segmentFraction - t.value) : 0))
  const endB = useDerivedValue(() => (hasLapped.value && t.value < segmentFraction ? 1 : 0))

  const headPos = useDerivedValue(() => {
    if (!contour) return vec(box.x + TRAIL_CANVAS_PAD, box.y + TRAIL_CANVAS_PAD)
    const [pos] = contour.getPosTan(t.value * length)
    return vec(pos.x, pos.y)
  })

  const contrastColor = useMemo(() => getContrastColor(color), [color])

  if (!active) {
    return <Path path={path} style='stroke' strokeWidth={TRAIL_STROKE_WIDTH} strokeCap='round' strokeJoin='round' color={color} opacity={STATIC_TRAIL_OPACITY} />
  }

  return (
    <>
      <Path path={path} start={startA} end={endA} style='stroke' strokeWidth={TRAIL_STROKE_WIDTH} strokeCap='round' strokeJoin='round' color={color} />
      <Path path={path} start={startB} end={endB} style='stroke' strokeWidth={TRAIL_STROKE_WIDTH} strokeCap='round' strokeJoin='round' color={color} />

      <Circle c={headPos} r={HEAD_RADIUS} color={color} />
      <Circle c={headPos} r={HEAD_RADIUS} style='stroke' strokeWidth={HEAD_RING_WIDTH} color={contrastColor} />
    </>
  )
}

export function HeroTitleTrails({ lightBox, cyclesBox, p1Color, p2Color, active, startDelayMs }: HeroTitleTrailsProps) {
  const trailLengthPx = useMemo(() => {
    const lightSize = wordTrailSize(lightBox)
    const cyclesSize = wordTrailSize(cyclesBox)
    const lightPerimeter = rectPerimeter(lightSize.width, lightSize.height)
    const cyclesPerimeter = rectPerimeter(cyclesSize.width, cyclesSize.height)
    return TRAIL_LENGTH_FRACTION * Math.min(lightPerimeter, cyclesPerimeter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightBox.width, lightBox.height, cyclesBox.width, cyclesBox.height])

  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <WordTrail box={lightBox} color={p1Color} clockwise={true} active={active} trailLengthPx={trailLengthPx} startDelayMs={startDelayMs} />
      <WordTrail box={cyclesBox} color={p2Color} clockwise={false} active={active} trailLengthPx={trailLengthPx} startDelayMs={startDelayMs} />
    </Canvas>
  )
}
