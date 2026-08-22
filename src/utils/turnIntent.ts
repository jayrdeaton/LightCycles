import { Direction, OrientationMode, Player } from '@/types'

// Below this drag distance (px), a gesture release is treated as a tap/jitter rather than a
// deliberate flick-to-turn.
export const MIN_SWIPE_DISTANCE = 24

// Compares the magnitude of each axis of a translation vector to pick its dominant axis, then the
// sign of that axis for direction. Returns null for a drag too short to count as an intentional
// swipe. The vector doesn't have to span a whole gesture end-to-end — TouchInputLayer feeds this
// per-segment deltas within one continuous touch (see its own comment) so a player can chain
// several turns without lifting their finger, resetting the baseline after each recognized swipe.
// Marked 'worklet' so it can run on the UI thread inside a Pan gesture's onUpdate, not just at
// gesture end.
export function resolveSwipeDirection(translationX: number, translationY: number): Direction | null {
  'worklet'
  if (Math.abs(translationX) < MIN_SWIPE_DISTANCE && Math.abs(translationY) < MIN_SWIPE_DISTANCE) return null

  if (Math.abs(translationX) > Math.abs(translationY)) {
    return translationX > 0 ? 'right' : 'left'
  }
  return translationY > 0 ? 'down' : 'up'
}

// Hack's steering inversion, applied here in the raw screen frame (left/right swapped, up/down
// untouched) — the same frame every input source already resolves swipes/keys in, and the same
// frame the game engine moves the cycle in (see resolveTurnIntent's own comment on why no
// per-orientation flip is needed). Every input source (native touch, web pointer, web keyboard)
// and the CPU's own decision path (see cpuAi.ts's applyCpuTurn) call this identically at their own
// single JS-thread chokepoint, rather than duplicating an if/else per call site.
export function applyControlInversion(direction: Direction, inverted: boolean): Direction {
  if (!inverted) return direction
  if (direction === 'left') return 'right'
  if (direction === 'right') return 'left'
  return direction
}

export function flipDirection(direction: Direction): Direction {
  switch (direction) {
    case 'up':
      return 'down'
    case 'down':
      return 'up'
    case 'left':
      return 'right'
    case 'right':
      return 'left'
  }
}

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
  return resolveSwipeDirection(translationX, translationY)
}
