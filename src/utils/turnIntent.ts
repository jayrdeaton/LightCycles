import { Direction, OrientationMode, Player } from '@/types'

// Below this drag distance (px), a gesture release is treated as a tap/jitter rather than a
// deliberate flick-to-turn.
export const MIN_SWIPE_DISTANCE = 24

// Compares the magnitude of each axis at gesture end (not continuous tracking, per PLAN.md — this
// is a flick-to-turn game, not drag-to-move) to pick the swipe's dominant axis, then the sign of
// that axis for direction. Returns null for a drag too short to count as an intentional swipe.
export function resolveSwipeDirection(translationX: number, translationY: number): Direction | null {
  if (Math.abs(translationX) < MIN_SWIPE_DISTANCE && Math.abs(translationY) < MIN_SWIPE_DISTANCE) return null

  if (Math.abs(translationX) > Math.abs(translationY)) {
    return translationX > 0 ? 'right' : 'left'
  }
  return translationY > 0 ? 'down' : 'up'
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

// The one shared entry point every input source (mobile touch, web keyboard) should route through
// — see PLAN.md's "Input Architecture". Mobile touch derives translationX/Y from a Pan gesture's
// release; web keyboard calls this with a synthetic translation matching the pressed key's axis
// (see TouchInputLayer.web.tsx) so both sources produce identically-shaped turn-intent events.
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
  return resolveSwipeDirection(translationX, translationY)
}
