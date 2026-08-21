import { countReachableCells } from '@/utils/floodFill'

describe('countReachableCells', () => {
  it('counts every cell in a fully open grid', () => {
    const grid = { cols: 3, rows: 3 }
    expect(countReachableCells({ x: 1, y: 1 }, grid, new Set())).toBe(9)
  })

  it('returns 0 when the start cell is itself occupied', () => {
    const grid = { cols: 3, rows: 3 }
    expect(countReachableCells({ x: 1, y: 1 }, grid, new Set(['1,1']))).toBe(0)
  })

  it('returns 0 when the start cell is out of bounds', () => {
    const grid = { cols: 3, rows: 3 }
    expect(countReachableCells({ x: -1, y: 0 }, grid, new Set())).toBe(0)
  })

  it('does not cross occupied cells — a full-width wall splits the grid in two', () => {
    const grid = { cols: 5, rows: 5 }
    const occupied = new Set(['2,0', '2,1', '2,2', '2,3', '2,4'])
    expect(countReachableCells({ x: 0, y: 0 }, grid, occupied)).toBe(10)
    expect(countReachableCells({ x: 4, y: 0 }, grid, occupied)).toBe(10)
  })

  it('counts a sealed pocket smaller than the full grid', () => {
    const grid = { cols: 5, rows: 5 }
    const occupied = new Set(['2,0', '2,1', '0,2', '1,2'])
    expect(countReachableCells({ x: 0, y: 0 }, grid, occupied)).toBe(4)
  })

  it('stops early once maxCount is reached, without exploring the whole grid', () => {
    const grid = { cols: 20, rows: 20 } // 400 cells, fully open
    expect(countReachableCells({ x: 10, y: 10 }, grid, new Set())).toBe(400)

    const capped = countReachableCells({ x: 10, y: 10 }, grid, new Set(), 50)
    expect(capped).toBeGreaterThanOrEqual(50)
    expect(capped).toBeLessThan(400)
  })

  it('is unaffected by maxCount when the reachable area is already smaller than the cap', () => {
    const grid = { cols: 5, rows: 5 }
    const occupied = new Set(['2,0', '2,1', '0,2', '1,2'])
    expect(countReachableCells({ x: 0, y: 0 }, grid, occupied, 300)).toBe(4)
  })
})
