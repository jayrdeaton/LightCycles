import { flipDirection, isEffectiveTurn, resolveSwipeDirection, resolveTurnIntent } from '@/utils/turnIntent'

describe('resolveSwipeDirection', () => {
  it('returns null for a drag shorter than the minimum threshold', () => {
    expect(resolveSwipeDirection(5, -5)).toBeNull()
  })

  it('picks the dominant axis when a drag is diagonal', () => {
    expect(resolveSwipeDirection(60, 10)).toBe('right')
    expect(resolveSwipeDirection(10, 60)).toBe('down')
  })

  it.each([
    [40, 0, 'right'],
    [-40, 0, 'left'],
    [0, 40, 'down'],
    [0, -40, 'up']
  ] as const)('resolves (%i, %i) to %s', (tx, ty, expected) => {
    expect(resolveSwipeDirection(tx, ty)).toBe(expected)
  })
})

describe('flipDirection', () => {
  it.each([
    ['up', 'down'],
    ['down', 'up'],
    ['left', 'right'],
    ['right', 'left']
  ] as const)('flips %s to %s', (input, expected) => {
    expect(flipDirection(input)).toBe(expected)
  })
})

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

describe('isEffectiveTurn', () => {
  it('is false for a swipe matching the current heading (continuing straight)', () => {
    expect(isEffectiveTurn('up', 'up')).toBe(false)
  })

  it('is false for a swipe reversing 180° into the current heading', () => {
    expect(isEffectiveTurn('down', 'up')).toBe(false)
    expect(isEffectiveTurn('left', 'right')).toBe(false)
  })

  it('is true for a swipe perpendicular to the current heading', () => {
    expect(isEffectiveTurn('left', 'up')).toBe(true)
    expect(isEffectiveTurn('right', 'up')).toBe(true)
  })
})
