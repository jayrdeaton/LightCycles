import { GridCell, GridSize } from '@/types'

import { ALL_DIRECTIONS, cellKey, isInBounds, stepCell, wrapCell } from './grid'

// 4-directional BFS from `start`, counting cells reachable without crossing `occupied` or the
// grid edge — the "how much room is left to survive in" heuristic cpuAi.ts scores each candidate
// turn by. Index-walked queue (not Array#shift, which is O(n) per call and would make this
// O(cells²)) since this runs fresh for every candidate direction, every tick.
//
// `maxCount` stops the fill early once the queue reaches that many cells, bounding worst-case
// cost at O(maxCount) regardless of grid size — see CPU_FLOOD_FILL_CAP's own comment for why an
// exact count past that point is never actually needed. Defaults to unbounded for direct/test use.
// `portals` defaults to empty so every existing call site/test (predating portals) stays byte-
// identical — a neighbor landing on a portal cell is redirected to its paired exit before the
// visited/bounds/occupied checks run, the same "let + reassign before any check" shape tickGame's
// own movement resolution uses, so a portal reads to this search as a normal 1-step edge to
// wherever it actually leads, not a boundary (see gameEngine.ts's tickGame for why treating it as
// blocked instead would misjudge reachable space near one). `tunnelCellSet`/`tunnelOccupied` both
// default to empty for the same byte-identical-by-default reason — a tunnel-member cell's blocked
// check routes through `tunnelOccupied` instead of `occupied`, exactly mirroring tickGame's own
// `isBlocked` — otherwise this would see every tunnel cell as unconditionally empty regardless of
// what's actually sitting there underground, the CPU blind spot the mechanic's own params exist to
// close (see cpuAi.ts's callers). `wrapEdges` defaults to false so every existing call site/test
// (predating wrap) stays byte-identical — when true, a neighbor that steps off the grid re-enters
// from the opposite edge (see grid.ts's wrapCell) instead of being treated as a boundary, mirroring
// gameEngine.ts's own tickGame. Applied before the portal check, same order tickGame uses, though
// it's moot in practice: a portal is never placed on an edge cell (see arenas.ts), so a raw
// off-grid `next` can never also be a portal entrance.
export function countReachableCells(start: GridCell, grid: GridSize, occupied: ReadonlySet<string>, maxCount: number = Infinity, portals: ReadonlyMap<string, GridCell> = new Map(), tunnelCellSet: ReadonlySet<string> = new Set(), tunnelOccupied: ReadonlySet<string> = new Set(), wrapEdges: boolean = false): number {
  const isBlocked = (key: string): boolean => (tunnelCellSet.has(key) ? tunnelOccupied : occupied).has(key)
  if (!isInBounds(start, grid) || isBlocked(cellKey(start))) return 0

  const visited = new Set<string>([cellKey(start)])
  const queue: GridCell[] = [start]

  let head = 0
  while (head < queue.length && queue.length < maxCount) {
    const cell = queue[head]
    head++
    for (const direction of ALL_DIRECTIONS) {
      let next = stepCell(cell, direction)
      if (wrapEdges && !isInBounds(next, grid)) next = wrapCell(next, grid)
      let key = cellKey(next)
      if (portals.has(key)) {
        next = portals.get(key)!
        key = cellKey(next)
      }
      if (visited.has(key) || !isInBounds(next, grid) || isBlocked(key)) continue
      visited.add(key)
      queue.push(next)
    }
  }

  return queue.length
}

// Same 4-directional BFS shape as countReachableCells above, but stops early and returns the
// step-distance to the first cell in `targets` it reaches, or null if none is reachable within
// `maxCount` — used by cpuAi.ts to bias pickup-seeking without a second, differently-shaped search.
// `portals` follows the identical redirect-before-checks shape countReachableCells above uses;
// `tunnelCellSet`/`tunnelOccupied` follow its identical isBlocked-routing shape, and `wrapEdges`
// follows its identical wrap-before-portal-check shape too.
export function distanceToNearestTarget(start: GridCell, grid: GridSize, occupied: ReadonlySet<string>, targets: ReadonlySet<string>, maxCount: number = Infinity, portals: ReadonlyMap<string, GridCell> = new Map(), tunnelCellSet: ReadonlySet<string> = new Set(), tunnelOccupied: ReadonlySet<string> = new Set(), wrapEdges: boolean = false): number | null {
  const isBlocked = (key: string): boolean => (tunnelCellSet.has(key) ? tunnelOccupied : occupied).has(key)
  if (!isInBounds(start, grid) || isBlocked(cellKey(start))) return null
  if (targets.has(cellKey(start))) return 0

  const visited = new Set<string>([cellKey(start)])
  const queue: { cell: GridCell; dist: number }[] = [{ cell: start, dist: 0 }]

  let head = 0
  while (head < queue.length && queue.length < maxCount) {
    const { cell, dist } = queue[head]
    head++
    for (const direction of ALL_DIRECTIONS) {
      let next = stepCell(cell, direction)
      if (wrapEdges && !isInBounds(next, grid)) next = wrapCell(next, grid)
      let key = cellKey(next)
      if (portals.has(key)) {
        next = portals.get(key)!
        key = cellKey(next)
      }
      if (visited.has(key) || !isInBounds(next, grid) || isBlocked(key)) continue
      if (targets.has(key)) return dist + 1
      visited.add(key)
      queue.push({ cell: next, dist: dist + 1 })
    }
  }

  return null
}
