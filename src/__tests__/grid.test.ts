import { startingStateFor } from '@/utils/grid'

describe('startingStateFor', () => {
  const grid = { cols: 20, rows: 30 }

  it('places face-to-face players on the top/bottom axis, facing each other', () => {
    const p1 = startingStateFor(1, grid, 'faceToFace', true)
    const p2 = startingStateFor(2, grid, 'faceToFace', true)
    // Player 1 is assumed to be the device's owner, so they get the near/bottom zone; player 2
    // gets the far/top zone. p1OnRight is meaningless here (there's no left/right split), so it
    // shouldn't affect face-to-face placement either way.
    expect(p1.direction).toBe('up')
    expect(p2.direction).toBe('down')
    expect(p2.head.y).toBeLessThan(p1.head.y)
    expect(p1.head.x).toBe(p2.head.x)
    expect(startingStateFor(1, grid, 'faceToFace', false)).toEqual(p1)
    expect(startingStateFor(2, grid, 'faceToFace', false)).toEqual(p2)
  })

  it('places side-by-side players on the left/right axis, facing each other', () => {
    // p1OnRight false: player 1 gets the left zone here (see the swap test below for the true case).
    const p1 = startingStateFor(1, grid, 'sideBySide', false)
    const p2 = startingStateFor(2, grid, 'sideBySide', false)
    expect(p1.direction).toBe('right')
    expect(p2.direction).toBe('left')
    expect(p1.head.x).toBeLessThan(p2.head.x)
    expect(p1.head.y).toBe(p2.head.y)
  })

  it('swaps which zone each side-by-side player starts in based on p1OnRight', () => {
    const p1WhenOnRight = startingStateFor(1, grid, 'sideBySide', true)
    const p2WhenP1OnRight = startingStateFor(2, grid, 'sideBySide', true)
    const p1WhenOnLeft = startingStateFor(1, grid, 'sideBySide', false)
    const p2WhenP1OnLeft = startingStateFor(2, grid, 'sideBySide', false)
    // Whichever player ends up on the right always gets the same zone/heading, regardless of
    // which player it is...
    expect(p1WhenOnRight.head).toEqual(p2WhenP1OnLeft.head)
    expect(p1WhenOnRight.direction).toBe(p2WhenP1OnLeft.direction)
    expect(p1WhenOnLeft.head).toEqual(p2WhenP1OnRight.head)
    expect(p1WhenOnLeft.direction).toBe(p2WhenP1OnRight.direction)
    // ...so the two players are never on the same side facing the same way.
    expect(p1WhenOnRight.head.x).toBeGreaterThan(p1WhenOnLeft.head.x)
    expect(p1WhenOnRight.direction).toBe('left')
    expect(p1WhenOnLeft.direction).toBe('right')
  })

  it('keeps starting positions within the grid even on a tiny board', () => {
    const tiny = { cols: 4, rows: 4 }
    const p1 = startingStateFor(1, tiny, 'faceToFace', true)
    const p2 = startingStateFor(2, tiny, 'faceToFace', true)
    expect(p1.head.y).toBeGreaterThanOrEqual(0)
    expect(p2.head.y).toBeLessThan(tiny.rows)
  })

  it('clamps the margin to 0 rather than going negative on a degenerate 1-cell axis', () => {
    const degenerate = { cols: 1, rows: 1 }
    for (const mode of ['faceToFace', 'sideBySide'] as const) {
      for (const p1OnRight of [true, false]) {
        const p1 = startingStateFor(1, degenerate, mode, p1OnRight)
        const p2 = startingStateFor(2, degenerate, mode, p1OnRight)
        expect(p1.head.x).toBeGreaterThanOrEqual(0)
        expect(p1.head.y).toBeGreaterThanOrEqual(0)
        expect(p2.head.x).toBeGreaterThanOrEqual(0)
        expect(p2.head.y).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
