import { GRID_CELL_PX } from '@/constants/game'
import { ArenaVariant, GridCell, GridSizeTier, OrientationMode } from '@/types'
import { buildArenaObstacles, buildArenaPortals, buildArenaTunnels, GAUNTLET_MIN_ALONG_LENGTH, GAUNTLET_MIN_CROSS_LENGTH, GAUNTLET_SPAWN_CLEARANCE_CELLS, PILLAR_MIN_ALONG_LENGTH, PILLAR_MIN_CROSS_LENGTH, PILLAR_SPAWN_CLEARANCE_CELLS, PORTAL_MIN_COLS, PORTAL_MIN_PAIR_DISTANCE_CELLS, PORTAL_MIN_ROWS, PORTAL_SPAWN_CLEARANCE_CELLS, TUNNEL_LENGTH_CELLS, TUNNEL_MIN_ALONG_LENGTH, TUNNEL_MIN_CROSS_LENGTH, TUNNEL_SPAWN_CLEARANCE_CELLS } from '@/utils/arenas'
import { distanceToNearestTarget } from '@/utils/floodFill'
import { cellKey, computeGridSize, isAdjacent, isInBounds, startingStateFor } from '@/utils/grid'

function chebyshev(a: GridCell, b: GridCell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

describe('buildArenaObstacles', () => {
  describe("'open' variant", () => {
    it('always returns no obstacles, regardless of grid/mode/p1OnRight', () => {
      expect(buildArenaObstacles('open', { cols: 40, rows: 60 }, 'faceToFace', true)).toEqual([])
      expect(buildArenaObstacles('open', { cols: 40, rows: 60 }, 'sideBySide', false)).toEqual([])
    })

    it('returns no obstacles even on a degenerate 1x1 grid', () => {
      expect(buildArenaObstacles('open', { cols: 1, rows: 1 }, 'faceToFace', true)).toEqual([])
    })
  })

  describe("'portals' variant", () => {
    it('never produces obstacles — portal geometry lives on buildArenaPortals instead', () => {
      expect(buildArenaObstacles('portals', { cols: 40, rows: 80 }, 'faceToFace', true)).toEqual([])
      expect(buildArenaObstacles('portals', { cols: 1, rows: 1 }, 'faceToFace', true)).toEqual([])
    })
  })

  describe("'underpass' variant", () => {
    it('never produces obstacles — tunnel geometry lives on buildArenaTunnels instead', () => {
      expect(buildArenaObstacles('underpass', { cols: 40, rows: 80 }, 'faceToFace', true)).toEqual([])
      expect(buildArenaObstacles('underpass', { cols: 1, rows: 1 }, 'faceToFace', true)).toEqual([])
    })
  })

  // ─── Reachability + clearance invariants across realistic device sizes ────────────────────────
  // Every (GridSizeTier, phone orientation, OrientationMode, p1OnRight, variant) combination a real
  // device could actually produce, built the same way the app itself would: real cols/rows via
  // computeGridSize at each tier's GRID_CELL_PX, against realistic phone-sized pixel dimensions in
  // both physical orientations.
  const PHONE_SIZES: { label: string; width: number; height: number }[] = [
    { label: 'portrait', width: 390, height: 844 },
    { label: 'landscape', width: 844, height: 390 }
  ]
  const TIERS: GridSizeTier[] = ['small', 'medium', 'large']
  const MODES: OrientationMode[] = ['faceToFace', 'sideBySide']
  const P1_ON_RIGHT_VALUES = [true, false]
  const VARIANTS: Exclude<ArenaVariant, 'open'>[] = ['pillars', 'gauntlet']

  interface Combo {
    tier: GridSizeTier
    phone: { label: string; width: number; height: number }
    mode: OrientationMode
    p1OnRight: boolean
    variant: Exclude<ArenaVariant, 'open'>
  }

  const combos: Combo[] = []
  for (const tier of TIERS) {
    for (const phone of PHONE_SIZES) {
      for (const mode of MODES) {
        for (const p1OnRight of P1_ON_RIGHT_VALUES) {
          for (const variant of VARIANTS) {
            combos.push({ tier, phone, mode, p1OnRight, variant })
          }
        }
      }
    }
  }

  describe.each(combos)('$variant — $tier tier, $phone.label phone, mode=$mode, p1OnRight=$p1OnRight', ({ tier, phone, mode, p1OnRight, variant }) => {
    const grid = computeGridSize(phone.width, phone.height, GRID_CELL_PX[tier])
    const obstacles = buildArenaObstacles(variant, grid, mode, p1OnRight)
    const p1Head = startingStateFor(1, grid, mode, p1OnRight).head
    const p2Head = startingStateFor(2, grid, mode, p1OnRight).head
    const occupied = new Set(obstacles.map(cellKey))
    const clearance = variant === 'pillars' ? PILLAR_SPAWN_CLEARANCE_CELLS : GAUNTLET_SPAWN_CLEARANCE_CELLS

    it('never fully partitions the board — a path always exists between the two real spawn heads', () => {
      const distance = distanceToNearestTarget(p1Head, grid, occupied, new Set([cellKey(p2Head)]))
      expect(distance).not.toBeNull()
    })

    it('keeps every obstacle cell in bounds and at least the clearance constant away from both spawn heads', () => {
      for (const cell of obstacles) {
        expect(isInBounds(cell, grid)).toBe(true)
        expect(chebyshev(cell, p1Head)).toBeGreaterThanOrEqual(clearance)
        expect(chebyshev(cell, p2Head)).toBeGreaterThanOrEqual(clearance)
      }
    })
  })

  // ─── Symmetry (pillars) ─────────────────────────────────────────────────────────────────────
  // Hand-computed fixtures, sized to comfortably clear PILLAR_MIN_ALONG_LENGTH/PILLAR_MIN_CROSS_LENGTH
  // plus every pip's own clearance from spawn — same "exact coordinate" style as grid.test.ts's
  // startingStateFor tests. The shipped generator is a quincunx: one center pip plus a near/far
  // mirrored pair of corner pips, each pip a PILLAR_BLOCK_RADIUS_CELLS=1 (3x3) block — 5 pips * 9
  // cells = 45 obstacle cells when every pip clears spawn (as it does at this fixture size).
  describe('pillar symmetry', () => {
    it('produces a center pip plus two mirrored corner-pip pairs, centered on the board, in faceToFace mode', () => {
      // grid.cols=24, grid.rows=50 -> alongLength (rows)=50, crossLength (cols)=24.
      const grid = { cols: 24, rows: 50 }
      const obstacles = buildArenaObstacles('pillars', grid, 'faceToFace', true)

      expect(obstacles).toHaveLength(45)

      // Each pip is a 3x3 block; group obstacle cells by which pip center they belong to.
      const pipCenters = [
        { x: 12, y: 25 }, // center pip
        { x: 5, y: 15 }, // near pair
        { x: 5, y: 35 },
        { x: 19, y: 15 }, // far pair
        { x: 19, y: 35 }
      ]
      for (const center of pipCenters) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            expect(obstacles).toContainEqual({ x: center.x + dx, y: center.y + dy })
          }
        }
      }

      // The near/far pip pairs are each mirrored around the board's along-center (y=25)...
      expect(obstacles.filter((c) => c.x >= 4 && c.x <= 6 && c.y >= 14 && c.y <= 16)).toHaveLength(9)
      expect(obstacles.filter((c) => c.x >= 4 && c.x <= 6 && c.y >= 34 && c.y <= 36)).toHaveLength(9)
      // ...and around the board's cross-center (x=12), sharing the same along-coordinate as each other.
      expect(obstacles.filter((c) => c.x >= 4 && c.x <= 6)).toHaveLength(18)
      expect(obstacles.filter((c) => c.x >= 18 && c.x <= 20)).toHaveLength(18)
    })

    it('produces a center pip plus two mirrored corner-pip pairs, centered on the board, in sideBySide mode', () => {
      // grid.cols=50, grid.rows=24 -> alongLength (cols)=50, crossLength (rows)=24 — the sideBySide
      // mirror of the fixture above, with p1OnRight flipped and mode swapped.
      const grid = { cols: 50, rows: 24 }
      const obstacles = buildArenaObstacles('pillars', grid, 'sideBySide', false)

      expect(obstacles).toHaveLength(45)

      const pipCenters = [
        { x: 25, y: 12 }, // center pip
        { x: 15, y: 5 }, // near pair
        { x: 35, y: 5 },
        { x: 15, y: 19 }, // far pair
        { x: 35, y: 19 }
      ]
      for (const center of pipCenters) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            expect(obstacles).toContainEqual({ x: center.x + dx, y: center.y + dy })
          }
        }
      }

      expect(obstacles.filter((c) => c.y >= 4 && c.y <= 6 && c.x >= 14 && c.x <= 16)).toHaveLength(9)
      expect(obstacles.filter((c) => c.y >= 4 && c.y <= 6 && c.x >= 34 && c.x <= 36)).toHaveLength(9)
      expect(obstacles.filter((c) => c.y >= 4 && c.y <= 6)).toHaveLength(18)
      expect(obstacles.filter((c) => c.y >= 18 && c.y <= 20)).toHaveLength(18)
    })
  })

  // ─── Gauntlet wall symmetry ─────────────────────────────────────────────────────────────────
  // Regression coverage for a real bug: buildGauntlet used to accept/reject each candidate wall
  // independently against spawn clearance, so a spawn sitting just inside one wall's clearance zone
  // could drop ONLY that wall while its mirror survived — leaving a single wall deep in one player's
  // territory and letting that player reach it far sooner than the other on a straight run. Fixed by
  // validating each mirrored group of walls atomically, the same "never partially" rule
  // buildPillars' isGroupClear already enforces.
  describe('gauntlet wall symmetry', () => {
    function wallAlongPositions(obstacles: GridCell[], mode: OrientationMode): number[] {
      const coord = mode === 'faceToFace' ? (c: GridCell) => c.y : (c: GridCell) => c.x
      return [...new Set(obstacles.map(coord))].sort((a, b) => a - b)
    }

    it('never leaves a single, lopsided wall on the real small-tier phone grid that used to trigger the bug', () => {
      // computeGridSize(390, 844, GRID_CELL_PX.small) in sideBySide mode: the real-device combo
      // that used to produce one wall at along=25 while its mirrored candidate at along=53 was
      // dropped for sitting 5 cells from p1's spawn — just inside the 6-cell clearance.
      const grid = { cols: 78, rows: 168 }
      const obstacles = buildArenaObstacles('gauntlet', grid, 'sideBySide', true)
      const positions = wallAlongPositions(obstacles, 'sideBySide')
      // The mirror axis is the real spawn heads' own sum (see buildGauntlet's axisSum), not
      // Math.floor(grid.cols / 2) — the two aren't always equal (see "keeps each player equally
      // many ticks..." below), and for this particular grid they differ by one.
      const p1 = startingStateFor(1, grid, 'sideBySide', true)
      const p2 = startingStateFor(2, grid, 'sideBySide', true)
      const axisSum = p1.head.x + p2.head.x
      for (const position of positions) {
        expect(positions).toContain(axisSum - position)
      }
    })

    it('keeps each player equally many ticks from the nearest wall on a straight run, across every realistic grid/mode/orientation combo', () => {
      const TIERS: GridSizeTier[] = ['small', 'medium', 'large']
      const PHONE_SIZES = [
        { width: 390, height: 844 },
        { width: 844, height: 390 }
      ]
      const MODES: OrientationMode[] = ['faceToFace', 'sideBySide']

      for (const tier of TIERS) {
        for (const phone of PHONE_SIZES) {
          const grid = computeGridSize(phone.width, phone.height, GRID_CELL_PX[tier])
          for (const mode of MODES) {
            for (const p1OnRight of [true, false]) {
              const obstacles = buildArenaObstacles('gauntlet', grid, mode, p1OnRight)
              const positions = wallAlongPositions(obstacles, mode)
              const coord = mode === 'faceToFace' ? (c: GridCell) => c.y : (c: GridCell) => c.x
              const p1 = startingStateFor(1, grid, mode, p1OnRight)
              const p2 = startingStateFor(2, grid, mode, p1OnRight)
              const stepSign = (direction: string) => (direction === 'down' || direction === 'right' ? 1 : -1)
              const distanceToWall = (along: number, sign: number) => {
                const ahead = positions.filter((position) => (sign > 0 ? position > along : position < along))
                if (ahead.length === 0) return null
                return sign > 0 ? Math.min(...ahead) - along : along - Math.max(...ahead)
              }
              const d1 = distanceToWall(coord(p1.head), stepSign(p1.direction))
              const d2 = distanceToWall(coord(p2.head), stepSign(p2.direction))
              expect(d1).toBe(d2)
            }
          }
        }
      }
    })
  })

  // ─── Grid-size edge cases ───────────────────────────────────────────────────────────────────
  describe('grid-size thresholds', () => {
    it('pillars: returns no obstacles just under PILLAR_MIN_ALONG_LENGTH, with an otherwise-generous cross length', () => {
      const grid = { cols: PILLAR_MIN_ALONG_LENGTH - 1, rows: 20 } // sideBySide: along=cols, cross=rows
      const obstacles = buildArenaObstacles('pillars', grid, 'sideBySide', true)
      expect(obstacles).toEqual([])
    })

    it('pillars: returns no obstacles just under PILLAR_MIN_CROSS_LENGTH, with an otherwise-generous along length', () => {
      const grid = { cols: 40, rows: PILLAR_MIN_CROSS_LENGTH - 1 }
      const obstacles = buildArenaObstacles('pillars', grid, 'sideBySide', true)
      expect(obstacles).toEqual([])
    })

    it('pillars: places obstacles at exactly PILLAR_MIN_ALONG_LENGTH/PILLAR_MIN_CROSS_LENGTH, all in bounds', () => {
      const grid = { cols: PILLAR_MIN_ALONG_LENGTH, rows: PILLAR_MIN_CROSS_LENGTH } // sideBySide: along=cols, cross=rows
      const obstacles = buildArenaObstacles('pillars', grid, 'sideBySide', true)
      expect(obstacles.length).toBeGreaterThan(0)
      for (const cell of obstacles) expect(isInBounds(cell, grid)).toBe(true)
    })

    it('gauntlet: returns no obstacles just under GAUNTLET_MIN_ALONG_LENGTH, with an otherwise-generous cross length', () => {
      const grid = { cols: GAUNTLET_MIN_ALONG_LENGTH - 1, rows: 20 }
      const obstacles = buildArenaObstacles('gauntlet', grid, 'sideBySide', true)
      expect(obstacles).toEqual([])
    })

    it('gauntlet: returns no obstacles just under GAUNTLET_MIN_CROSS_LENGTH, with an otherwise-generous along length', () => {
      const grid = { cols: 40, rows: GAUNTLET_MIN_CROSS_LENGTH - 1 }
      const obstacles = buildArenaObstacles('gauntlet', grid, 'sideBySide', true)
      expect(obstacles).toEqual([])
    })

    it('gauntlet: places obstacles, all in bounds, comfortably at/above GAUNTLET_MIN_ALONG_LENGTH (the exact minimum can still legitimately yield none, since a short board also puts both candidate walls within spawn clearance)', () => {
      const grid = { cols: 40, rows: 20 } // alongLength(40) comfortably clears the 30 minimum
      const obstacles = buildArenaObstacles('gauntlet', grid, 'sideBySide', true)
      expect(obstacles.length).toBeGreaterThan(0)
      for (const cell of obstacles) expect(isInBounds(cell, grid)).toBe(true)
    })

    it('gauntlet: places obstacles at exactly GAUNTLET_MIN_CROSS_LENGTH, all in bounds', () => {
      const grid = { cols: 40, rows: GAUNTLET_MIN_CROSS_LENGTH }
      const obstacles = buildArenaObstacles('gauntlet', grid, 'sideBySide', true)
      expect(obstacles.length).toBeGreaterThan(0)
      for (const cell of obstacles) expect(isInBounds(cell, grid)).toBe(true)
    })

    it('never throws and never produces an out-of-bounds cell on a tiny degenerate grid', () => {
      for (const variant of ['pillars', 'gauntlet'] as const) {
        for (const mode of ['faceToFace', 'sideBySide'] as const) {
          const grid = { cols: 3, rows: 3 }
          const obstacles = buildArenaObstacles(variant, grid, mode, true)
          expect(obstacles).toEqual([])
        }
      }
    })
  })
})

// ─── Portals ────────────────────────────────────────────────────────────────
// Kept as its own top-level describe block, separate from the pillars/gauntlet reachability/
// clearance matrix above, since a portal's own reachability invariant is structurally guaranteed
// (it only ever ADDS connectivity — see the dedicated check below) rather than something the
// generator could actually fail the way a pillar/gauntlet placement can; folding it into that
// combos matrix would dilute a matrix that's meaningful precisely because pillars/gauntlet can.
describe('buildArenaPortals', () => {
  it('returns no portals for every variant except portals', () => {
    for (const variant of ['open', 'pillars', 'gauntlet'] as const) {
      expect(buildArenaPortals(variant, { cols: 40, rows: 80 }, 'faceToFace', true)).toEqual([])
    }
  })

  it('returns no portals just under PORTAL_MIN_COLS, with an otherwise-generous row count', () => {
    const grid = { cols: PORTAL_MIN_COLS - 1, rows: 40 }
    expect(buildArenaPortals('portals', grid, 'sideBySide', true)).toEqual([])
  })

  it('returns no portals just under PORTAL_MIN_ROWS, with an otherwise-generous column count', () => {
    const grid = { cols: 40, rows: PORTAL_MIN_ROWS - 1 }
    expect(buildArenaPortals('portals', grid, 'sideBySide', true)).toEqual([])
  })

  it('places both catty-corner portal pairs at/above the minimums, well clear of spawn and never adjacent to their own partner', () => {
    const grid = { cols: 40, rows: 80 }
    const portals = buildArenaPortals('portals', grid, 'faceToFace', true)
    expect(portals).toHaveLength(2)
    const p1Head = startingStateFor(1, grid, 'faceToFace', true).head
    const p2Head = startingStateFor(2, grid, 'faceToFace', true).head
    for (const { a, b } of portals) {
      for (const cell of [a, b]) {
        expect(isInBounds(cell, grid)).toBe(true)
        expect(chebyshev(cell, p1Head)).toBeGreaterThanOrEqual(PORTAL_SPAWN_CLEARANCE_CELLS)
        expect(chebyshev(cell, p2Head)).toBeGreaterThanOrEqual(PORTAL_SPAWN_CLEARANCE_CELLS)
      }
      // The load-bearing invariant GameBoard.tsx's own isAdjacent relies on to tell a portal jump
      // apart from an ordinary step (see grid.ts's own comment) — checked here, not just assumed.
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(PORTAL_MIN_PAIR_DISTANCE_CELLS)
      expect(isAdjacent(a, b)).toBe(false)
    }
  })

  // Hand-computed fixtures, same "exact coordinate" style as the pillar symmetry tests above —
  // playing-card layout: one portal near each corner, linked catty-corner across the center.
  it('links each corner catty-corner across the center, in faceToFace mode', () => {
    const grid = { cols: 40, rows: 80 }
    expect(buildArenaPortals('portals', grid, 'faceToFace', true)).toEqual([
      { a: { x: 5, y: 5 }, b: { x: 34, y: 74 } }, // top-left <-> bottom-right
      { a: { x: 34, y: 5 }, b: { x: 5, y: 74 } } // top-right <-> bottom-left
    ])
  })

  it('links each corner catty-corner across the center, in sideBySide mode', () => {
    const grid = { cols: 80, rows: 40 }
    expect(buildArenaPortals('portals', grid, 'sideBySide', false)).toEqual([
      { a: { x: 5, y: 5 }, b: { x: 74, y: 34 } }, // top-left <-> bottom-right
      { a: { x: 74, y: 5 }, b: { x: 5, y: 34 } } // top-right <-> bottom-left
    ])
  })

  it('never fully partitions the board — a portal only ever adds connectivity, it never blocks any', () => {
    const grid = { cols: 40, rows: 80 }
    const obstacles = buildArenaObstacles('portals', grid, 'faceToFace', true)
    const p1Head = startingStateFor(1, grid, 'faceToFace', true).head
    const p2Head = startingStateFor(2, grid, 'faceToFace', true).head
    const occupied = new Set(obstacles.map(cellKey))
    expect(distanceToNearestTarget(p1Head, grid, occupied, new Set([cellKey(p2Head)]))).not.toBeNull()
  })

  it('never throws and never produces an out-of-bounds portal on a tiny degenerate grid', () => {
    for (const mode of ['faceToFace', 'sideBySide'] as const) {
      const grid = { cols: 3, rows: 3 }
      expect(buildArenaPortals('portals', grid, mode, true)).toEqual([])
    }
  })
})

// ─── Underpass ──────────────────────────────────────────────────────────────
// Same "kept separate from the pillars/gauntlet reachability/clearance matrix" reasoning as
// buildArenaPortals above — a tunnel's own reachability invariant is structurally guaranteed (it
// never marks a cell as an obstacle, see buildArenaObstacles' own 'underpass' branch), not
// something the generator could actually fail.
describe('buildArenaTunnels', () => {
  it('returns no tunnels for every variant except underpass', () => {
    for (const variant of ['open', 'pillars', 'gauntlet', 'portals'] as const) {
      expect(buildArenaTunnels(variant, { cols: 40, rows: 80 }, 'faceToFace', true)).toEqual([])
    }
  })

  it('returns no tunnels just under TUNNEL_MIN_ALONG_LENGTH, with an otherwise-generous cross length', () => {
    const grid = { cols: TUNNEL_MIN_ALONG_LENGTH - 1, rows: 40 } // sideBySide: along=cols, cross=rows
    expect(buildArenaTunnels('underpass', grid, 'sideBySide', true)).toEqual([])
  })

  it('returns no tunnels just under TUNNEL_MIN_CROSS_LENGTH, with an otherwise-generous along length', () => {
    const grid = { cols: 40, rows: TUNNEL_MIN_CROSS_LENGTH - 1 }
    expect(buildArenaTunnels('underpass', grid, 'sideBySide', true)).toEqual([])
  })

  it('places a single TUNNEL_LENGTH_CELLS-long corridor at exactly the minimums, all in bounds and collinear', () => {
    const grid = { cols: TUNNEL_MIN_ALONG_LENGTH, rows: TUNNEL_MIN_CROSS_LENGTH } // sideBySide: along=cols, cross=rows
    const tunnels = buildArenaTunnels('underpass', grid, 'sideBySide', true)
    expect(tunnels).toHaveLength(1)
    const { cells } = tunnels[0]
    expect(cells).toHaveLength(TUNNEL_LENGTH_CELLS)
    const p1Head = startingStateFor(1, grid, 'sideBySide', true).head
    const p2Head = startingStateFor(2, grid, 'sideBySide', true).head
    for (const cell of cells) {
      expect(isInBounds(cell, grid)).toBe(true)
      expect(chebyshev(cell, p1Head)).toBeGreaterThanOrEqual(TUNNEL_SPAWN_CLEARANCE_CELLS)
      expect(chebyshev(cell, p2Head)).toBeGreaterThanOrEqual(TUNNEL_SPAWN_CLEARANCE_CELLS)
    }
    for (let i = 1; i < cells.length; i++) expect(isAdjacent(cells[i - 1], cells[i])).toBe(true)
  })

  it('keeps every tunnel cell at least TUNNEL_SPAWN_CLEARANCE_CELLS away from both spawn heads', () => {
    const grid = { cols: 40, rows: 80 }
    const tunnels = buildArenaTunnels('underpass', grid, 'faceToFace', true)
    expect(tunnels).toHaveLength(1)
    const p1Head = startingStateFor(1, grid, 'faceToFace', true).head
    const p2Head = startingStateFor(2, grid, 'faceToFace', true).head
    for (const cell of tunnels[0].cells) {
      expect(chebyshev(cell, p1Head)).toBeGreaterThanOrEqual(TUNNEL_SPAWN_CLEARANCE_CELLS)
      expect(chebyshev(cell, p2Head)).toBeGreaterThanOrEqual(TUNNEL_SPAWN_CLEARANCE_CELLS)
    }
  })

  // Hand-computed fixtures, same "exact coordinate" style as the pillar/portal symmetry tests above.
  it('centers the corridor on the along axis players are divided on, in faceToFace mode', () => {
    const grid = { cols: 40, rows: 80 }
    expect(buildArenaTunnels('underpass', grid, 'faceToFace', true)).toEqual([
      {
        cells: Array.from({ length: TUNNEL_LENGTH_CELLS }, (_, i) => ({ x: 20, y: 35 + i }))
      }
    ])
  })

  it('centers the corridor on the along axis players are divided on, in sideBySide mode', () => {
    const grid = { cols: 80, rows: 40 }
    expect(buildArenaTunnels('underpass', grid, 'sideBySide', false)).toEqual([
      {
        cells: Array.from({ length: TUNNEL_LENGTH_CELLS }, (_, i) => ({ x: 35 + i, y: 20 }))
      }
    ])
  })

  it('never fully partitions the board — a tunnel never marks a cell as an obstacle', () => {
    const grid = { cols: 40, rows: 80 }
    const obstacles = buildArenaObstacles('underpass', grid, 'faceToFace', true)
    const p1Head = startingStateFor(1, grid, 'faceToFace', true).head
    const p2Head = startingStateFor(2, grid, 'faceToFace', true).head
    const occupied = new Set(obstacles.map(cellKey))
    expect(distanceToNearestTarget(p1Head, grid, occupied, new Set([cellKey(p2Head)]))).not.toBeNull()
  })

  it('never throws and never produces an out-of-bounds tunnel cell on a tiny degenerate grid', () => {
    for (const mode of ['faceToFace', 'sideBySide'] as const) {
      const grid = { cols: 3, rows: 3 }
      expect(buildArenaTunnels('underpass', grid, mode, true)).toEqual([])
    }
  })
})
