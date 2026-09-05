import { zoneSideFor } from '@/utils/playerZones'

describe('zoneSideFor', () => {
  it('gives player 1 the near/bottom zone and player 2 the far/top zone in face-to-face, regardless of p1OnRight', () => {
    expect(zoneSideFor(1, 'faceToFace', true)).toBe('bottom')
    expect(zoneSideFor(2, 'faceToFace', true)).toBe('top')
    expect(zoneSideFor(1, 'faceToFace', false)).toBe('bottom')
    expect(zoneSideFor(2, 'faceToFace', false)).toBe('top')
  })

  it('gives whichever player p1OnRight names the right zone in side-by-side, and the other the left', () => {
    expect(zoneSideFor(1, 'sideBySide', true)).toBe('right')
    expect(zoneSideFor(2, 'sideBySide', true)).toBe('left')
    expect(zoneSideFor(1, 'sideBySide', false)).toBe('left')
    expect(zoneSideFor(2, 'sideBySide', false)).toBe('right')
  })

  it('never gives both players the same zone', () => {
    for (const mode of ['faceToFace', 'sideBySide'] as const) {
      for (const p1OnRight of [true, false]) {
        expect(zoneSideFor(1, mode, p1OnRight)).not.toBe(zoneSideFor(2, mode, p1OnRight))
      }
    }
  })
})
