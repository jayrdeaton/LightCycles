import { isInBounds } from '@tastic/grid'

import { ArenaVariant, GridCell, GridSize, OrientationMode, Portal, Tunnel } from '@/types'

import { startingStateFor } from './grid'

// ─── Pillars ────────────────────────────────────────────────────────────────
// Below these thresholds (split-axis length / shared-axis length, in cells — see alongLengthFor/
// crossLengthFor below) there isn't enough room to place a quincunx with real clearance from both
// spawns and real separation between pips, so pillars gracefully degrades to an empty layout
// (indistinguishable from 'open') rather than forcing obstacles into a cramped board. Comfortably
// below every realistic phone-sized grid (see GRID_CELL_PX tiers in constants/game.ts — even the
// coarsest 'large' tier produces a split-axis length in the 50s/60s and a shared-axis length in the
// high 20s/low 30s on a typical phone), so this only ever bites unusually small custom/test grids.
export const PILLAR_MIN_ALONG_LENGTH = 30
export const PILLAR_MIN_CROSS_LENGTH = 20

// Five pips laid out like the "5" face on a die/playing card: one at board-center, four at the
// corners of a rectangle centered on it — per explicit user feedback that the original design (two
// mirror pairs plus a diagonal group, all within a fixed handful of cells of center) read as one
// small, overcomplicated cluster in the middle of the board rather than genuinely dispersed
// obstacles. Corner offsets are FRACTIONS of the board's own along/cross length (not fixed cell
// counts), so the spread scales with board size instead of staying pinned to a tiny fixed radius
// regardless of how big the grid actually is — a large grid gets pips that reach meaningfully toward
// its own edges, not the same few-cell huddle a small grid would get.
export const PILLAR_CORNER_ALONG_OFFSET_FRACTION = 0.2
export const PILLAR_CORNER_CROSS_OFFSET_FRACTION = 0.3

// Each pip is a filled square block of cells, not a single cell — per explicit user feedback that
// pillars should read as "bigger." Radius 1 = a 3x3 block (9 cells) centered on the pip's own
// along/cross coordinate.
export const PILLAR_BLOCK_RADIUS_CELLS = 1

// Minimum Chebyshev distance (see chebyshevDistance) a pillar cell must keep from EITHER spawn head
// for its whole group to be accepted — see isGroupClear. Keeps a pillar from ever spawning close
// enough to box a player in before they've had a chance to move.
export const PILLAR_SPAWN_CLEARANCE_CELLS = 4

// ─── Portals ────────────────────────────────────────────────────────────────
// Playing-card layout: one portal near each of the board's 4 corners, linked catty-corner across
// the center — top-left <-> bottom-right, top-right <-> bottom-left — 2 independent pairs, 4 cells
// total. Placed directly in real grid (x, y) space rather than the along/cross axis abstraction the
// other generators use below: a corner is a corner regardless of which way players are split, so
// there's no split-axis-relative concept here the way an along/cross pair has for pillars.
export const PORTAL_CORNER_MARGIN_CELLS = 5

// Same graceful-degrade reasoning as the pillar/gauntlet thresholds above, but a single shared
// floor for both cols and rows (not a bigger "along" + smaller "cross" pair like the other
// generators use) — corner placement needs comparable headroom on both axes regardless of which one
// players happen to be split along. Comfortably below the shorter dimension of every realistic
// phone-sized grid (see GRID_CELL_PX tiers in constants/game.ts) at every tier, including 'large'
// (the tightest case — a portrait/landscape phone at the coarsest tier still lands in the high 20s).
export const PORTAL_MIN_COLS = 20
export const PORTAL_MIN_ROWS = 20

export const PORTAL_SPAWN_CLEARANCE_CELLS = 4

// Minimum distance between a pair's own two cells. Doubles as a non-degeneracy guarantee (an
// adjacent "pair" would make a portal pointless — you'd step through and land right back next to
// where you started) and the load-bearing invariant GameBoard.tsx's isAdjacent relies on to tell a
// portal jump apart from an ordinary step (see grid.ts's own comment on isAdjacent). Trivially
// cleared here — opposite corners are always far apart — but still checked explicitly rather than
// just assumed, same defensive style isGroupClear's own callers already use.
export const PORTAL_MIN_PAIR_DISTANCE_CELLS = 6

function buildPortals(grid: GridSize, p1Head: GridCell, p2Head: GridCell): Portal[] {
  if (grid.cols < PORTAL_MIN_COLS || grid.rows < PORTAL_MIN_ROWS) return []

  const m = PORTAL_CORNER_MARGIN_CELLS
  const topLeft = { x: m, y: m }
  const topRight = { x: grid.cols - 1 - m, y: m }
  const bottomLeft = { x: m, y: grid.rows - 1 - m }
  const bottomRight = { x: grid.cols - 1 - m, y: grid.rows - 1 - m }

  // Each catty-corner pair is accepted or dropped independently — same "a partial layout is fine"
  // reasoning buildGauntlet's own mirrored wall groups use — so a spawn sitting unusually close to
  // one diagonal doesn't cost the other, otherwise-clear one.
  const portals: Portal[] = []
  for (const [a, b] of [
    [topLeft, bottomRight],
    [topRight, bottomLeft]
  ] as const) {
    if (!isGroupClear([a, b], grid, p1Head, p2Head, PORTAL_SPAWN_CLEARANCE_CELLS)) continue
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < PORTAL_MIN_PAIR_DISTANCE_CELLS) continue
    portals.push({ a, b })
  }

  return portals
}

// ─── Gauntlet ───────────────────────────────────────────────────────────────
// Same graceful-degrade reasoning as the pillar thresholds above.
export const GAUNTLET_MIN_ALONG_LENGTH = 36
export const GAUNTLET_MIN_CROSS_LENGTH = 14

// A third wall only appears once the split axis is long enough that 3 walls, spread across
// GAUNTLET_WALL_ALONG_FRACTIONS_THREE below, still keep their required spacing/clearance from spawn
// (see GAUNTLET_WALL_SPACING_CELLS/GAUNTLET_SPAWN_CLEARANCE_CELLS) comfortably. In practice this
// lands on the same 'medium'/'small' vs 'large' GridSizeTier split the pillar diagonal group used to
// draw.
export const GAUNTLET_THREE_WALL_MIN_ALONG_LENGTH = 80

// Wall positions as fractions of the FULL along axis (not just the span between the two spawn
// heads) — per explicit user feedback that walls spaced only across the inter-spawn gap all landed
// within a narrow band around board-center, leaving the outer quarters of the board (behind each
// spawn) completely empty while overcomplicating the middle. Spreading across the full axis instead
// pushes walls out toward each player's own territory (candidates too close to a spawn are simply
// dropped — see buildGauntlet), using much more of the board rather than clustering in the middle.
// The two-wall fractions stay as close to each spawn (0.25/0.75) as GAUNTLET_SPAWN_CLEARANCE_CELLS
// allows at GAUNTLET_MIN_ALONG_LENGTH itself (the tightest case): 0.32/0.68 sat only ~0.07*alongLength
// from each spawn, which cleared the 6-cell minimum only once alongLength exceeded ~86 — past
// GAUNTLET_THREE_WALL_MIN_ALONG_LENGTH, so the two-wall variant never actually produced a wall on any
// grid that reaches it. 0.45/0.55 keeps a one-cell safety margin above the minimum across the whole
// [GAUNTLET_MIN_ALONG_LENGTH, GAUNTLET_THREE_WALL_MIN_ALONG_LENGTH) range instead.
export const GAUNTLET_WALL_ALONG_FRACTIONS_TWO = [0.45, 0.55]
export const GAUNTLET_WALL_ALONG_FRACTIONS_THREE = [0.22, 0.5, 0.78]

// Minimum split-axis distance a wall must keep from either spawn head, and from any
// already-accepted wall — see buildGauntlet, which drops a candidate wall's whole mirrored group
// (not just the one wall, and not the whole variant) whenever either check fails.
export const GAUNTLET_SPAWN_CLEARANCE_CELLS = 6
export const GAUNTLET_WALL_SPACING_CELLS = 4

// Each wall now has TWO gaps, not one — per explicit user feedback that a single door per wall let
// one player simply camp (or trail-block) that one opening and permanently strand the other on their
// own side. Two gaps, symmetric around the wall's own cross-center, guarantee a second route through
// every wall that a block on the first can never fully close off. Gap width is a fraction of the
// shared (cross) axis length, clamped to a sane absolute cell-count range so gaps neither vanish on
// a tiny board nor swallow the whole wall on a huge one; the offset (also a fraction of that axis)
// keeps the two gaps far enough apart that a single trail segment can't plug both at once.
export const GAUNTLET_GAP_WIDTH_FRACTION = 0.18
export const GAUNTLET_GAP_WIDTH_MIN_CELLS = 3
export const GAUNTLET_GAP_WIDTH_MAX_CELLS = 6
export const GAUNTLET_GAP_OFFSET_FRACTION = 0.25

// ─── Axis helpers ───────────────────────────────────────────────────────────
// Mirrors grid.ts's startingStateFor: the split axis (the one the two players' zones are divided
// along — y for faceToFace/top-bottom, x for sideBySide/left-right) and the shared axis (the one
// both heads sit at the same coordinate on).
function alongLengthFor(grid: GridSize, mode: OrientationMode): number {
  return mode === 'faceToFace' ? grid.rows : grid.cols
}

function crossLengthFor(grid: GridSize, mode: OrientationMode): number {
  return mode === 'faceToFace' ? grid.cols : grid.rows
}

// Inverse of startingStateFor's own axis convention: given a (split-axis, shared-axis) coordinate
// pair, produce the real GridCell it corresponds to.
function fromAxisCoords(along: number, across: number, mode: OrientationMode): GridCell {
  return mode === 'faceToFace' ? { x: across, y: along } : { x: along, y: across }
}

// The split-axis coordinate of an already-computed cell (e.g. a real spawn head from
// startingStateFor) — the read side of fromAxisCoords' convention.
function alongCoordOf(cell: GridCell, mode: OrientationMode): number {
  return mode === 'faceToFace' ? cell.y : cell.x
}

function chebyshevDistance(a: GridCell, b: GridCell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

// ─── Pillars ────────────────────────────────────────────────────────────────
// A group survives only if EVERY member clears both bounds and spawn distance — never partially,
// which is what guarantees a pillar can never appear without its mirror (an asymmetric layout would
// otherwise favor whichever player it happened to land closer to). `clearanceCells` is caller-
// supplied (not a fixed constant) so every arena generator — each with its own spawn-clearance
// tuning — can share this same check rather than each hand-rolling an identical loop.
function isGroupClear(group: GridCell[], grid: GridSize, p1Head: GridCell, p2Head: GridCell, clearanceCells: number): boolean {
  return group.every((cell) => isInBounds(cell, grid) && chebyshevDistance(cell, p1Head) >= clearanceCells && chebyshevDistance(cell, p2Head) >= clearanceCells)
}

// A pip's own footprint — a square block of cells centered on (alongC, crossC), radius cells in
// every direction (radius 1 = 3x3). Cells are only ever added to the final obstacle list once the
// whole block has cleared isGroupClear, so a block that would clip a spawn's clearance zone at one
// corner is dropped in its entirety, never partially.
function blockCells(alongC: number, crossC: number, radius: number, mode: OrientationMode): GridCell[] {
  const cells: GridCell[] = []
  for (let a = alongC - radius; a <= alongC + radius; a++) {
    for (let c = crossC - radius; c <= crossC + radius; c++) {
      cells.push(fromAxisCoords(a, c, mode))
    }
  }
  return cells
}

function buildPillars(grid: GridSize, mode: OrientationMode, p1Head: GridCell, p2Head: GridCell): GridCell[] {
  const alongLength = alongLengthFor(grid, mode)
  const crossLength = crossLengthFor(grid, mode)
  if (alongLength < PILLAR_MIN_ALONG_LENGTH || crossLength < PILLAR_MIN_CROSS_LENGTH) return []

  const alongCenter = Math.floor(alongLength / 2)
  const crossCenter = Math.floor(crossLength / 2)
  const alongOffset = Math.round(alongLength * PILLAR_CORNER_ALONG_OFFSET_FRACTION)
  const crossOffset = Math.round(crossLength * PILLAR_CORNER_CROSS_OFFSET_FRACTION)
  const obstacles: GridCell[] = []

  // The quincunx's middle pip — dropped alone (no mirror needed: it already sits equidistant from
  // both players by construction, so there's no fairness concern with placing or dropping it solo).
  const centerBlock = blockCells(alongCenter, crossCenter, PILLAR_BLOCK_RADIUS_CELLS, mode)
  if (isGroupClear(centerBlock, grid, p1Head, p2Head, PILLAR_SPAWN_CLEARANCE_CELLS)) obstacles.push(...centerBlock)

  // The four corner pips, as two along-axis mirror pairs (near-cross-edge and far-cross-edge) —
  // each pair validated atomically, same reasoning as every other mirrored group in this file: a
  // corner pip near one player's zone can never appear without its mirror near the other's.
  const nearCrossPair = [...blockCells(alongCenter - alongOffset, crossCenter - crossOffset, PILLAR_BLOCK_RADIUS_CELLS, mode), ...blockCells(alongCenter + alongOffset, crossCenter - crossOffset, PILLAR_BLOCK_RADIUS_CELLS, mode)]
  if (isGroupClear(nearCrossPair, grid, p1Head, p2Head, PILLAR_SPAWN_CLEARANCE_CELLS)) obstacles.push(...nearCrossPair)

  const farCrossPair = [...blockCells(alongCenter - alongOffset, crossCenter + crossOffset, PILLAR_BLOCK_RADIUS_CELLS, mode), ...blockCells(alongCenter + alongOffset, crossCenter + crossOffset, PILLAR_BLOCK_RADIUS_CELLS, mode)]
  if (isGroupClear(farCrossPair, grid, p1Head, p2Head, PILLAR_SPAWN_CLEARANCE_CELLS)) obstacles.push(...farCrossPair)

  return obstacles
}

// ─── Gauntlet ───────────────────────────────────────────────────────────────
// The two gap windows for one wall — symmetric around the wall's own cross-center, each clamped
// into [0, crossLength - gapWidth] independently so both stay fully in-bounds regardless of grid
// size, then nudged apart if clamping ever left them touching/overlapping (only possible on a
// crossLength barely above the minimum) so there are always genuinely two separate routes through,
// never one wide one masquerading as two.
function computeGapStarts(crossLength: number, gapWidth: number): [number, number] {
  const crossCenter = Math.floor(crossLength / 2)
  const offset = Math.round(crossLength * GAUNTLET_GAP_OFFSET_FRACTION)
  const maxStart = Math.max(0, crossLength - gapWidth)
  const clamp = (start: number) => Math.min(Math.max(start, 0), maxStart)
  let first = clamp(crossCenter - offset - Math.floor(gapWidth / 2))
  let second = clamp(crossCenter + offset - Math.floor(gapWidth / 2))
  if (first > second) [first, second] = [second, first]
  if (second < first + gapWidth) second = Math.min(maxStart, first + gapWidth)
  return [first, second]
}

function buildGauntlet(grid: GridSize, mode: OrientationMode, p1Head: GridCell, p2Head: GridCell): GridCell[] {
  const alongLength = alongLengthFor(grid, mode)
  const crossLength = crossLengthFor(grid, mode)
  if (alongLength < GAUNTLET_MIN_ALONG_LENGTH || crossLength < GAUNTLET_MIN_CROSS_LENGTH) return []

  const p1Along = alongCoordOf(p1Head, mode)
  const p2Along = alongCoordOf(p2Head, mode)

  const wallCount = alongLength >= GAUNTLET_THREE_WALL_MIN_ALONG_LENGTH ? 3 : 2
  const fractions = wallCount === 3 ? GAUNTLET_WALL_ALONG_FRACTIONS_THREE : GAUNTLET_WALL_ALONG_FRACTIONS_TWO
  const gapWidth = Math.min(GAUNTLET_GAP_WIDTH_MAX_CELLS, Math.max(GAUNTLET_GAP_WIDTH_MIN_CELLS, Math.round(crossLength * GAUNTLET_GAP_WIDTH_FRACTION)))
  const [gap1Start, gap2Start] = computeGapStarts(crossLength, gapWidth)

  const obstacles: GridCell[] = []
  const acceptedPositions: number[] = []

  // Fractions are mirrored around 0.5 (0.32/0.68, or 0.22/0.78 plus the self-mirrored 0.5 center)
  // — grouping the outer pair here and validating each group atomically means a wall that fails
  // its own clearance check always takes its mirror partner down with it, rather than leaving that
  // partner standing alone. Without this, a spawn sitting just barely inside one wall's clearance
  // zone could drop ONLY that wall while its mirror survives, leaving a single wall deep in one
  // player's territory instead of the other's — exactly the kind of asymmetric, unfair layout every
  // other generator in this file (see buildPillars' isGroupClear) already guards against.
  const groups: number[][] = []
  for (let i = 0, j = fractions.length - 1; i <= j; i++, j--) {
    groups.push(i === j ? [fractions[i]] : [fractions[i], fractions[j]])
  }

  // The axis both wall groups mirror around is the real midpoint between the two actual spawn
  // heads (p1Along + p2Along), NOT Math.floor(alongLength / 2) — grid.ts's startingStateFor centers
  // each player's own zone independently (two nested Math.floor calls per zone), which lands the
  // pair exactly symmetric around (alongLength - 1) / 2 for some along-lengths and around
  // alongLength / 2 for others, depending on alongLength's parity mod 4. A wall axis fixed at
  // Math.floor(alongLength / 2) is therefore off by one cell from the real spawn-symmetry point for
  // roughly a quarter of all grid sizes — invisible in isolation, but it left one player one tick
  // closer to the nearest wall than the other on an otherwise-mirrored layout. Using the spawns' own
  // sum sidesteps needing to know which case applies; it's simply always correct.
  const axisSum = p1Along + p2Along

  for (const group of groups) {
    // A solo (unpaired) group is always the middle 0.5 fraction — the self-mirrored center wall in
    // the three-wall layout. Centered on the real axisSum (see above) rather than assumed board
    // geometry, so it sits equidistant between the two actual spawns.
    //
    // A paired group is derived as center ± offset, then mirrored via axisSum - position (not
    // center + offset) — same construction buildPillars' alongCenter ± alongOffset already uses,
    // extended to mirror around the real spawn axis exactly, no matter how axisSum's own parity
    // rounds. Rounding each mirrored fraction independently instead (e.g. alongLength=50: 0.45->23,
    // 0.55->28, not 27) would silently reintroduce the same one-wall-closer unfairness this guards
    // against.
    const axisCenter = Math.floor(axisSum / 2)
    const positions =
      group.length === 1
        ? [axisCenter]
        : (() => {
            const offset = Math.round(alongLength * (group[1] - 0.5))
            const position1 = axisCenter - offset
            return [position1, axisSum - position1]
          })()
    const groupClear = positions.every((position) => Math.abs(position - p1Along) >= GAUNTLET_SPAWN_CLEARANCE_CELLS && Math.abs(position - p2Along) >= GAUNTLET_SPAWN_CLEARANCE_CELLS && acceptedPositions.every((accepted) => Math.abs(position - accepted) >= GAUNTLET_WALL_SPACING_CELLS))
    if (!groupClear) continue

    // Two permanently-open gaps per wall (not one) — per explicit user feedback that a single door
    // let one player camp or trail-block it and permanently strand the other on their own side.
    for (const position of positions) {
      for (let across = 0; across < crossLength; across++) {
        if (across >= gap1Start && across < gap1Start + gapWidth) continue
        if (across >= gap2Start && across < gap2Start + gapWidth) continue
        const cell = fromAxisCoords(position, across, mode)
        if (isInBounds(cell, grid)) obstacles.push(cell)
      }
      acceptedPositions.push(position)
    }
  }

  return obstacles
}

// ─── Underpass ──────────────────────────────────────────────────────────────
// Same graceful-degrade reasoning as the pillar/gauntlet/portal thresholds above — raised from the
// original 30 alongside TUNNEL_LENGTH_CELLS tripling, so the corridor (now spanning 12 cells around
// board-center) still comfortably clears both spawns' own clearance zone at the threshold itself,
// not just on realistic phone-sized boards well above it.
export const TUNNEL_MIN_ALONG_LENGTH = 50
export const TUNNEL_MIN_CROSS_LENGTH = 16

// Long enough to feel like a real corridor — several ticks of travel, enough time for a surface
// trail to legitimately cross the same coordinate while a tunnel-traveler is passing underneath —
// per explicit user feedback that the original 4-cell version read as too small next to the other
// arenas' own "bigger" passes (pillars' 3x3 blocks, portals' powerup-sized rings). Still short
// enough to keep the collision-domain small, which is the entire cost argument for this mechanic
// over a board-wide layer system (see types/index.ts's own Tunnel comment) — a longer corridor is
// still just more entries in one flat Set, not a different kind of mechanic.
export const TUNNEL_LENGTH_CELLS = 12

// Minimum Chebyshev distance any tunnel cell (mouth or interior) must keep from either spawn head —
// the same isGroupClear check every other arena generator here already shares.
export const TUNNEL_SPAWN_CLEARANCE_CELLS = 5

// A single straight corridor, oriented ALONG the split axis (not across it) and centered at
// board-center — so a player driving straight from spawn toward the opponent runs directly into the
// near mouth, no detour required: the most literal reading of "just goes forward a bit... with a
// hallway to get there." Unlike pillars/portals, this is never mirrored into a second copy: a
// pillar/gauntlet obstacle BLOCKS movement, so an asymmetric placement would hand one player a worse
// path — mirroring is what keeps that fair. A tunnel blocks nothing (see buildArenaObstacles' own
// 'underpass' branch, which always returns []), so it's already fair simply by sitting equidistant
// from both spawns at board-center; a second tunnel would only double the rendering/collision/
// testing surface for no fairness gain.
function buildTunnel(grid: GridSize, mode: OrientationMode, p1Head: GridCell, p2Head: GridCell): Tunnel[] {
  const alongLength = alongLengthFor(grid, mode)
  const crossLength = crossLengthFor(grid, mode)
  if (alongLength < TUNNEL_MIN_ALONG_LENGTH || crossLength < TUNNEL_MIN_CROSS_LENGTH) return []

  const alongCenter = Math.floor(alongLength / 2)
  const crossCenter = Math.floor(crossLength / 2)
  const startOffset = Math.floor((TUNNEL_LENGTH_CELLS - 1) / 2)
  const cells: GridCell[] = []
  for (let i = 0; i < TUNNEL_LENGTH_CELLS; i++) {
    cells.push(fromAxisCoords(alongCenter - startOffset + i, crossCenter, mode))
  }

  if (!isGroupClear(cells, grid, p1Head, p2Head, TUNNEL_SPAWN_CLEARANCE_CELLS)) return []
  return [{ cells }]
}

// Deterministic static obstacle layout for the selected arena variant — same inputs always produce
// the same cells, so a round's arena never varies for the same settings (fairness: neither player
// gets a luckier draw than the other; testability: a layout can be asserted exactly). Always
// computed against the REAL spawn heads from startingStateFor, never assumed geometry, so obstacle
// placement stays correct even if that function's own zone-centering logic changes later.
export function buildArenaObstacles(variant: ArenaVariant, grid: GridSize, mode: OrientationMode, p1OnRight: boolean): GridCell[] {
  // Neither 'portals' nor 'underpass' blocks movement the way every other variant's cells do —
  // their geometry lives on GameState.portals/.tunnels instead (see buildArenaPortals below and
  // buildArenaTunnels), so both are obstacle-free exactly like 'open'.
  if (variant === 'open' || variant === 'portals' || variant === 'underpass') return []

  const p1Head = startingStateFor(1, grid, mode, p1OnRight).head
  const p2Head = startingStateFor(2, grid, mode, p1OnRight).head

  if (variant === 'pillars') return buildPillars(grid, mode, p1Head, p2Head)
  return buildGauntlet(grid, mode, p1Head, p2Head)
}

// Sibling to buildArenaObstacles above rather than folded into its own return type — obstacles and
// portals are different shapes (GridCell[] vs. Portal[]) with different collision semantics (see
// gameEngine.ts's tickGame), so keeping them as two separate, independently-callable functions lets
// every existing 'open'/'pillars'/'gauntlet' caller stay byte-identical rather than threading a new
// return field through call sites that never asked for one.
export function buildArenaPortals(variant: ArenaVariant, grid: GridSize, mode: OrientationMode, p1OnRight: boolean): Portal[] {
  if (variant !== 'portals') return []
  const p1Head = startingStateFor(1, grid, mode, p1OnRight).head
  const p2Head = startingStateFor(2, grid, mode, p1OnRight).head
  return buildPortals(grid, p1Head, p2Head)
}

// Sibling to buildArenaObstacles/buildArenaPortals above, same reasoning: a Tunnel's shape
// (`{ cells: GridCell[] }`) and collision semantics (see gameEngine.ts's tickGame) are different
// enough from either that folding it into one of their return types would only complicate every
// existing caller for a field they never asked for.
export function buildArenaTunnels(variant: ArenaVariant, grid: GridSize, mode: OrientationMode, p1OnRight: boolean): Tunnel[] {
  if (variant !== 'underpass') return []
  const p1Head = startingStateFor(1, grid, mode, p1OnRight).head
  const p2Head = startingStateFor(2, grid, mode, p1OnRight).head
  return buildTunnel(grid, mode, p1Head, p2Head)
}
