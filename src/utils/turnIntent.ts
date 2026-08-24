import { resolveSwipeDirection } from '@tastic/input'

import { Direction, OrientationMode, Player } from '@/types'

// Below this drag distance (px), a gesture release is treated as a tap/jitter rather than a
// deliberate flick-to-turn.
export const MIN_SWIPE_DISTANCE = 24

// How far a finger/pointer may drift and still count as a tap-to-activate, rather than the start
// of a drag — deliberately below MIN_SWIPE_DISTANCE (not equal to it) so the two never overlap: a
// touch that drifts past this is unambiguously either still within tap tolerance or already a
// recognized swipe, never both, and never neither. See TouchInputLayer.tsx's own Gesture.Tap
// (native) and TouchInputLayer.web.tsx's pointer-distance tracking (web), which both use this
// directly rather than re-deriving "was this a tap" from swipe-direction bookkeeping — that
// approach occasionally left a genuine, slightly-wobbly tap unrecognized.
export const TAP_MAX_DISTANCE = 18

export interface ResolveTurnIntentParams {
  player: Player
  translationX: number
  translationY: number
  orientationMode: OrientationMode
}

// The one shared entry point every input source (mobile touch, web pointer/keyboard) should route
// through — see PLAN.md's "Input Architecture". Mobile touch and web pointer both derive
// translationX/Y from a per-segment delta within an ongoing drag (reset after each recognized
// swipe, so several turns can chain within one continuous touch — see TouchInputLayer's onUpdate
// and TouchInputLayer.web.tsx's pointermove handler); web keyboard calls this with a synthetic
// translation matching the pressed key's axis, so all three sources produce identically-shaped
// turn-intent events. Also marked 'worklet' (via resolveSwipeDirection) so native's UI-thread
// gesture callback can call it directly.
//
// No flip for face-to-face's "far" player (player 2), even though they view the shared, un-rotated
// board from the opposite physical side of the device: translationX/translationY are captured in
// the same raw, un-rotated screen frame the board itself renders in (TouchInputLayer zones input
// purely via hitSlop over one undivided view — the canvas is never rotated per player), and that
// raw frame is also what the game engine moves the cycle in. So a raw swipe direction and the raw
// direction the cycle should move are the same physical event for every player, in every mode —
// like flicking a real object never needs "translating" your push just because you're viewing the
// table from the opposite side. Player 2's rotated seat only changes what THEY would call a given
// raw direction (their own perceived left/right/up/down is flipDirection of the raw one), but that
// relabeling applies equally to the swipe they made and the motion they watch, so it cancels out —
// flipping the raw value here would reintroduce exactly one unwanted flip and make the cycle move
// opposite to what they swiped. player/orientationMode stay in the signature (every input source
// already threads them through) in case a future accommodation genuinely needs them, but today
// they don't affect the result.
export function resolveTurnIntent({ translationX, translationY }: ResolveTurnIntentParams): Direction | null {
  'worklet'
  return resolveSwipeDirection({ x: translationX, y: translationY }, MIN_SWIPE_DISTANCE)
}
