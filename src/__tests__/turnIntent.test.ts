import { resolveTurnIntent } from '@/utils/turnIntent'

// resolveSwipeDirection/flipDirection/isEffectiveTurn now live in @tastic/input (tested in that
// package's own repo) — resolveTurnIntent is the one function LightCycles still owns here, as the
// thin adapter (translationX/Y -> Vec2, plus this app's own MIN_SWIPE_DISTANCE) every input source
// routes through.
describe('resolveTurnIntent', () => {
  // Both players' swipes are captured over the same raw, un-rotated screen frame the board itself
  // renders in (see the function's own comment) — so the resolved direction never depends on
  // player or orientationMode, for either player, in either mode. A player-2/face-to-face flip
  // would make the cycle move opposite to what was physically swiped.
  it('never flips, for either player, in face-to-face mode', () => {
    expect(resolveTurnIntent({ player: 1, translationX: 40, translationY: 0, orientationMode: 'faceToFace' })).toBe('right')
    expect(resolveTurnIntent({ player: 2, translationX: 40, translationY: 0, orientationMode: 'faceToFace' })).toBe('right')
    expect(resolveTurnIntent({ player: 2, translationX: -40, translationY: 0, orientationMode: 'faceToFace' })).toBe('left')
  })

  it('never flips in side-by-side mode, for either player', () => {
    expect(resolveTurnIntent({ player: 1, translationX: 0, translationY: -40, orientationMode: 'sideBySide' })).toBe('up')
    expect(resolveTurnIntent({ player: 2, translationX: 0, translationY: -40, orientationMode: 'sideBySide' })).toBe('up')
  })

  it('returns null for sub-threshold drags regardless of mode or player', () => {
    expect(resolveTurnIntent({ player: 1, translationX: 4, translationY: 3, orientationMode: 'faceToFace' })).toBeNull()
  })
})
