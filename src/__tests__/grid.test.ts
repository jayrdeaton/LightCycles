import { GRID_CELL_PX } from '@/constants/game'
import { cellKey, computeGridSize, isAdjacent, isInBounds, isOppositeDirection, startingStateFor, stepCell, wrapCell } from '@/utils/grid'

describe('computeGridSize', () => {
  it('floors pixel dimensions down to whole cells', () => {
    expect(computeGridSize(GRID_CELL_PX.medium * 10 + 3, GRID_CELL_PX.medium * 7 + 5, GRID_CELL_PX.medium)).toEqual({ cols: 10, rows: 7 })
  })

  it('never returns fewer than one cell per axis', () => {
    expect(computeGridSize(2, 2, GRID_CELL_PX.medium)).toEqual({ cols: 1, rows: 1 })
  })

  it('yields more, smaller cells at the small tier than the large tier for the same pixel area', () => {
    const width = 500
    const height = 500
    const small = computeGridSize(width, height, GRID_CELL_PX.small)
    const large = computeGridSize(width, height, GRID_CELL_PX.large)
    expect(small.cols).toBeGreaterThan(large.cols)
    expect(small.rows).toBeGreaterThan(large.rows)
  })
})

describe('stepCell', () => {
  it.each([
    ['up', { x: 5, y: 4 }],
    ['down', { x: 5, y: 6 }],
    ['left', { x: 4, y: 5 }],
    ['right', { x: 6, y: 5 }]
  ] as const)('steps %s correctly', (direction, expected) => {
    expect(stepCell({ x: 5, y: 5 }, direction)).toEqual(expected)
  })
})

describe('isInBounds', () => {
  const grid = { cols: 10, rows: 8 }

  it('accepts cells within the grid', () => {
    expect(isInBounds({ x: 0, y: 0 }, grid)).toBe(true)
    expect(isInBounds({ x: 9, y: 7 }, grid)).toBe(true)
  })

  it('rejects cells at or past the edges', () => {
    expect(isInBounds({ x: -1, y: 0 }, grid)).toBe(false)
    expect(isInBounds({ x: 0, y: -1 }, grid)).toBe(false)
    expect(isInBounds({ x: 10, y: 0 }, grid)).toBe(false)
    expect(isInBounds({ x: 0, y: 8 }, grid)).toBe(false)
  })
})

describe('wrapCell', () => {
  const grid = { cols: 10, rows: 8 }

  it('leaves an already-in-bounds cell untouched', () => {
    expect(wrapCell({ x: 5, y: 4 }, grid)).toEqual({ x: 5, y: 4 })
  })

  it('wraps a step past the right/bottom edge back to 0 on that axis', () => {
    expect(wrapCell({ x: 10, y: 4 }, grid)).toEqual({ x: 0, y: 4 })
    expect(wrapCell({ x: 5, y: 8 }, grid)).toEqual({ x: 5, y: 0 })
  })

  it('wraps a step past the left/top edge to the far edge on that axis', () => {
    expect(wrapCell({ x: -1, y: 4 }, grid)).toEqual({ x: 9, y: 4 })
    expect(wrapCell({ x: 5, y: -1 }, grid)).toEqual({ x: 5, y: 7 })
  })
})

describe('isOppositeDirection', () => {
  it('identifies opposite pairs', () => {
    expect(isOppositeDirection('up', 'down')).toBe(true)
    expect(isOppositeDirection('left', 'right')).toBe(true)
  })

  it('rejects non-opposite pairs', () => {
    expect(isOppositeDirection('up', 'up')).toBe(false)
    expect(isOppositeDirection('up', 'left')).toBe(false)
  })
})

describe('isAdjacent', () => {
  it('accepts every 4-directional neighbor', () => {
    expect(isAdjacent({ x: 5, y: 5 }, { x: 5, y: 4 })).toBe(true)
    expect(isAdjacent({ x: 5, y: 5 }, { x: 5, y: 6 })).toBe(true)
    expect(isAdjacent({ x: 5, y: 5 }, { x: 4, y: 5 })).toBe(true)
    expect(isAdjacent({ x: 5, y: 5 }, { x: 6, y: 5 })).toBe(true)
  })

  it('rejects the same cell', () => {
    expect(isAdjacent({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(false)
  })

  it('rejects a diagonal neighbor', () => {
    expect(isAdjacent({ x: 5, y: 5 }, { x: 6, y: 6 })).toBe(false)
  })

  it('rejects a realistic portal-pair distance', () => {
    expect(isAdjacent({ x: 5, y: 5 }, { x: 5, y: 15 })).toBe(false)
  })
})

describe('cellKey', () => {
  it('produces a stable, distinct key per cell', () => {
    expect(cellKey({ x: 3, y: 4 })).toBe('3,4')
    expect(cellKey({ x: 3, y: 4 })).not.toBe(cellKey({ x: 4, y: 3 }))
  })
})

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
