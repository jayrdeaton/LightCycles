import { GridCell, GridSize } from '@/types'

import { ALL_DIRECTIONS, cellKey, isInBounds, stepCell } from './grid'

// 4-directional BFS from `start`, counting cells reachable without crossing `occupied` or the
// grid edge — the "how much room is left to survive in" heuristic cpuAi.ts scores each candidate
// turn by. Index-walked queue (not Array#shift, which is O(n) per call and would make this
// O(cells²)) since this runs fresh for every candidate direction, every tick.
//
// `maxCount` stops the fill early once the queue reaches that many cells, bounding worst-case
// cost at O(maxCount) regardless of grid size — see CPU_FLOOD_FILL_CAP's own comment for why an
// exact count past that point is never actually needed. Defaults to unbounded for direct/test use.
export function countReachableCells(start: GridCell, grid: GridSize, occupied: ReadonlySet<string>, maxCount: number = Infinity): number {
  if (!isInBounds(start, grid) || occupied.has(cellKey(start))) return 0

  const visited = new Set<string>([cellKey(start)])
  const queue: GridCell[] = [start]

  let head = 0
  while (head < queue.length && queue.length < maxCount) {
    const cell = queue[head]
    head++
    for (const direction of ALL_DIRECTIONS) {
      const next = stepCell(cell, direction)
      const key = cellKey(next)
      if (visited.has(key) || !isInBounds(next, grid) || occupied.has(key)) continue
      visited.add(key)
      queue.push(next)
    }
  }

  return queue.length
}
