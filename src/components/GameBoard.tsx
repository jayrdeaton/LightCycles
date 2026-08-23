import { getContrastColor } from '@rific/auto-paper'
import { Canvas, Circle, Line, Path, Skia, vec } from '@shopify/react-native-skia'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Easing, useDerivedValue, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated'

import { MIN_TRAIL_LENGTH_BEFORE_TRIM, POWERUP_EFFECT_COLORS, POWERUP_PULSE_DURATION_MS, POWERUP_PULSE_SCALE, POWERUP_SPAWN_FADE_MS, powerupPickupRadiusPx, TRAIL_SEVER_EAT_MAX_MS, TRAIL_SEVER_EAT_MIN_MS, TRAIL_SEVER_EAT_MS_PER_CELL } from '@/constants/game'
import { GamePhase, GridCell, GridSize, OrientationMode, Player, PlayerState, PowerupPickup } from '@/types'
import { cellToPixel } from '@/utils/grid'

export interface GameBoardProps {
  players: Record<Player, PlayerState>
  phase: GamePhase
  tickIntervalMs: number
  cellPx: number
  grid: GridSize
  orientationMode: OrientationMode
  // Only meaningful when orientationMode === 'sideBySide' — see useP1OnRight and
  // TouchInputLayer.tsx's identical prop.
  p1OnRight: boolean
  // Ticks elapsed this round — see GameState's own comment. Drives PlayerTrail's head-glide
  // retrigger instead of trail.length, which a laggy trailGrowthTier can leave unchanged on a tick
  // that both grows and trims the trail.
  tick: number
  pickups: PowerupPickup[]
  // The app theme's tertiary color — pickups render in this, distinct from either player's own
  // primary/secondary trail color, so a glyph never gets mistaken for either player's own head.
  pickupColor: string
  // The resolved TRAIL_GROWTH_RATE number for the active trailGrowthTier (see constants/game.ts) —
  // lets PlayerTrail interpolate the tail's position continuously between trims instead of holding
  // still and then snapping a whole cell forward. Passed as the raw rate, not the tier, so this
  // component stays as decoupled from the tier enum as gameEngine.ts's own tickGame already is.
  trailGrowthRate: number
}

function cellCenter(cell: GridCell, cellPx: number) {
  const { x, y } = cellToPixel(cell, cellPx)
  return { x: x + cellPx / 2, y: y + cellPx / 2 }
}

// A crashed player's final trail dims relative to the survivor's, but stays legible — not faded
// to the point it's hard to make out against the board's own black/white background, especially
// now that the round-over dialog can be tucked away to actually look at the finished board.
const DEAD_TRAIL_OPACITY = 0.6
// A neutral grey rather than getContrastColor's black-or-white pick — that function is tuned for
// a *live* head marker standing out against the board, but on an already-dimmed dead one a pure
// white ring reads as too bright/stark against the muted fill it's outlining.
const DEAD_HEAD_OUTLINE_COLOR = '#888888'

// Thin on purpose — this is a boundary marker, not a trail, and shouldn't compete with the
// trails/heads for visual weight. Flat rather than scaled with cellPx, same reasoning as the head
// ring's own stroke width above.
const WALL_STROKE_WIDTH = 1.5

// Every live pickup renders identically, regardless of its actual (already-decided, see
// gameEngine.ts's maybeSpawnPickup) type — Mario-Kart mystery-box style. The type is only ever
// revealed once collected, in the holder's own HUD badge (see PowerupHud.tsx), never on the board.
function PowerupGlyph({ pickup, cellPx, color }: { pickup: PowerupPickup; cellPx: number; color: string }) {
  const baseRadius = powerupPickupRadiusPx(cellPx)
  const center = cellCenter(pickup.cell, cellPx)

  // `intro` runs 0 -> 1 once, the instant this glyph mounts (a fresh pickup — see this component's
  // own key below, which remounts on every genuine spawn) rather than popping straight into
  // existence. `pulse` only starts once intro finishes, then loops forever (see withRepeat's
  // reverse arg for the back-and-forth) for as long as the pickup sits uncollected, as a quiet
  // "I'm alive, come get me" cue. Both are purely cosmetic — never affect POWERUP_COLLECT_RADIUS_CELLS.
  const intro = useSharedValue(0)
  const pulse = useSharedValue(0)
  useEffect(() => {
    intro.value = withTiming(1, { duration: POWERUP_SPAWN_FADE_MS, easing: Easing.out(Easing.quad) })
    pulse.value = withDelay(POWERUP_SPAWN_FADE_MS, withRepeat(withTiming(1, { duration: POWERUP_PULSE_DURATION_MS, easing: Easing.inOut(Easing.ease) }), -1, true))
    // Intentionally runs once per mount (a fresh pickup, keyed by id in Powerups below) — not tied
    // to any prop that changes while the same pickup is still sitting there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const radius = useDerivedValue(() => baseRadius * (0.4 + 0.6 * intro.value) * (1 + pulse.value * POWERUP_PULSE_SCALE))
  const strokeOpacity = useDerivedValue(() => intro.value)
  const fillOpacity = useDerivedValue(() => intro.value * 0.35)

  return (
    <>
      <Circle cx={center.x} cy={center.y} r={radius} color={color} opacity={fillOpacity} />
      <Circle cx={center.x} cy={center.y} r={radius} style='stroke' strokeWidth={1.5} color={color} opacity={strokeOpacity} />
    </>
  )
}

function Powerups({ pickups, cellPx, color }: { pickups: PowerupPickup[]; cellPx: number; color: string }) {
  return (
    <>
      {pickups.map((pu) => (
        <PowerupGlyph key={pu.id} pickup={pu} cellPx={cellPx} color={color} />
      ))}
    </>
  )
}

// Each player "owns" the half of the perimeter behind their own zone — the same top/bottom or
// left/right split TouchInputLayer already uses for input zones (see grid.ts's startingStateFor)
// — so the wall reads as which player crashes into which edge, not just an arbitrary boundary.
// Drawn at the grid's own pixel size (cols/rows * cellPx), not the container's, since a container
// a few pixels larger than a whole number of cells (see computeGridSize's flooring) still crashes
// exactly at the grid edge — the outline should hug that real boundary, not the container's.
function wallPath(grid: GridSize, cellPx: number, orientationMode: OrientationMode, p1OnRight: boolean, player: Player) {
  const width = grid.cols * cellPx
  const height = grid.rows * cellPx
  const path = Skia.Path.Make()

  if (orientationMode === 'faceToFace') {
    // Player 2 is the "far" (top) zone, player 1 the "near" (bottom) zone.
    const midY = height / 2
    if (player === 2) {
      path.moveTo(0, midY)
      path.lineTo(0, 0)
      path.lineTo(width, 0)
      path.lineTo(width, midY)
    } else {
      path.moveTo(0, midY)
      path.lineTo(0, height)
      path.lineTo(width, height)
      path.lineTo(width, midY)
    }
    return path
  }

  // Side-by-side (and web's shared layout): whichever player is currently on the right gets the
  // right zone — see useP1OnRight for which physical rotation direction puts P1 there (and
  // TouchInputLayer.tsx's identical split), so the wall matches wherever each player's zone
  // actually ended up rather than assuming a fixed side.
  const onRight = player === 1 ? p1OnRight : !p1OnRight
  const midX = width / 2
  if (!onRight) {
    path.moveTo(midX, 0)
    path.lineTo(0, 0)
    path.lineTo(0, height)
    path.lineTo(midX, height)
  } else {
    path.moveTo(midX, 0)
    path.lineTo(width, 0)
    path.lineTo(width, height)
    path.lineTo(midX, height)
  }
  return path
}

function Walls({ grid, cellPx, orientationMode, p1OnRight, players, phase }: { grid: GridSize; cellPx: number; orientationMode: OrientationMode; p1OnRight: boolean; players: Record<Player, PlayerState>; phase: GamePhase }) {
  const p1Path = useMemo(() => wallPath(grid, cellPx, orientationMode, p1OnRight, 1), [grid, cellPx, orientationMode, p1OnRight])
  const p2Path = useMemo(() => wallPath(grid, cellPx, orientationMode, p1OnRight, 2), [grid, cellPx, orientationMode, p1OnRight])

  // Hidden during the onboarding countdown — the boundary marker is only meaningful once a round
  // is actually live, and it visually clutters the countdown's own player-zone overlay.
  if (phase === 'onboarding') return null

  return (
    <>
      <Path path={p1Path} style='stroke' strokeWidth={WALL_STROKE_WIDTH} color={players[1].color} />
      <Path path={p2Path} style='stroke' strokeWidth={WALL_STROKE_WIDTH} color={players[2].color} />
    </>
  )
}

// How far the tail should have visually crept from trail[0] toward trail[1] as of `tick`, as a
// fraction in [0, 1) — the *continuous* counterpart to gameEngine.ts's shouldTrimTrailAt, which
// only tracks the discrete "has a whole cell been trimmed yet" boundary. Trimming one whole cell
// exactly when this fraction wraps from just-under-1 back to 0 is what keeps this consistent with
// the actual (discrete) trail data: shouldTrimTrailAt's own condition is precisely "did this
// fraction's floor change this tick," so the two can never disagree about when a trim happens —
// this just fills in what the trim looks like *between* ticks instead of holding still until it
// does. Without it, every tick that doesn't land on a whole trim left the tail dead still, then
// jumped a full cell on the tick that did — a held-then-hop cadence, not a following one.
// `trailLength` mirrors gameEngine.ts's own MIN_TRAIL_LENGTH_BEFORE_TRIM gate on the trim itself —
// without it this would compute a nonzero creep purely from elapsed ticks even during the grace
// period where the trail isn't actually being trimmed yet, visually detaching the tail from
// trail[0] before any cell has really been removed.
function tailProgress(tick: number, growthRate: number, trailLength: number): number {
  if (growthRate >= 1 || trailLength <= MIN_TRAIL_LENGTH_BEFORE_TRIM) return 0
  const fractionalTrims = tick * (1 - growthRate)
  return fractionalTrims - Math.floor(fractionalTrims)
}

function trailPath(trail: PlayerState['trail'], cellPx: number) {
  const path = Skia.Path.Make()
  if (trail.length === 0) return path
  const first = cellCenter(trail[0], cellPx)
  path.moveTo(first.x, first.y)
  for (const cell of trail.slice(1)) {
    const { x, y } = cellCenter(cell, cellPx)
    path.lineTo(x, y)
  }
  return path
}

function PlayerTrail({ player, phase, tickIntervalMs, cellPx, tick, trailGrowthRate }: { player: PlayerState; phase: GamePhase; tickIntervalMs: number; cellPx: number; tick: number; trailGrowthRate: number }) {
  // Nearly fill their own cell on purpose — combined with a small cellPx (see constants/game.ts's
  // GRID_CELL_PX), this makes the actual hit-detection boundary obvious at a glance: a trail or head
  // reads as occupying essentially the whole cell it's in, so a one-cell gap between two trails
  // looks (and is) a real, precise near-miss rather than a vague blob-to-blob distance.
  const trailWidth = cellPx * 0.85
  const headRadius = cellPx * 0.475 // 95% diameter

  const trail = player.trail
  const head = cellCenter(trail[trail.length - 1], cellPx)
  const tail = cellCenter(trail[0], cellPx)
  // trail[1] doubles as two different things below: the fixed far end of the tail's own segment
  // (once the trail is long enough that it's a distinct cell from the head), and the "next" cell
  // the tail creeps toward between trims (see tailTarget below). Falls back to trail[0] itself —
  // same as trail[1] would equal once trimmed all the way down — when there's nothing else yet.
  const nextCell = trail.length > 1 ? trail[1] : trail[0]
  const nextCenter = cellCenter(nextCell, cellPx)
  // Continuously interpolated toward nextCenter (see tailProgress) rather than snapping straight to
  // `tail` — the fractional creep between trims, not just the trims themselves, is what needs to
  // animate for the tail to read as *following* rather than holding still and then hopping.
  const progress = tailProgress(tick, trailGrowthRate, trail.length)
  const tailTarget = { x: tail.x + (nextCenter.x - tail.x) * progress, y: tail.y + (nextCenter.y - tail.y) * progress }

  // The game state advances in discrete grid steps (see gameEngine.ts) — snapping straight to
  // each new cell every tick is what read as "choppy" at a tick rate well under the screen's own
  // refresh rate. Animating the head (and the trail's last segment, which follows it) smoothly
  // between cells over the tick's own duration decouples how it looks from how often the
  // simulation actually steps, without touching the underlying grid logic at all. The tail end
  // gets the identical treatment below it: under a laggy trailGrowthTier (see gameEngine.ts's
  // shouldTrimTrailAt) it also advances, and snapping it forward a whole cell on every trim tick
  // read exactly as janky as the head snapping did before this glide existed.
  const animX = useSharedValue(head.x)
  const animY = useSharedValue(head.y)
  const tailAnimX = useSharedValue(tail.x)
  const tailAnimY = useSharedValue(tail.y)
  // The head segment's fixed starting point. Deliberately a shared value snapshotted from
  // animX/animY's own current position (see the tick effect below) rather than recomputed fresh
  // from trail data each render — that was the real source of the jolt: trail data updates the
  // instant a tick commits, but the previous glide's *duration* was only ever a best guess (see
  // lastTickAtRef below), so it routinely hadn't actually finished yet at that instant. A fresh
  // trail-derived anchor would snap straight to the new cell regardless, landing ahead of wherever
  // animX/animY actually were and opening a visible gap/backtrack every single tick it happened on
  // — which, under any jitter, was most of them.
  const edgeStartX = useSharedValue(head.x)
  const edgeStartY = useSharedValue(head.y)
  // Wall-clock time (see lastTickAtRef below) the previous glide actually started at — always set
  // by the reset branch before the animate branch can read it.
  const lastTickAtRef = useRef(0)
  // The chain of cells a Prune or Shield break-through just severed from the front, ordered from
  // the break point (nearest the surviving trail) to the old tail (farthest) — see the severed-eat
  // effect and severedPath below. Grid coordinates, not pixels, so cellPx changing (it never does
  // mid-round, but nothing here should assume that) wouldn't desync it. Plain objects rather than
  // GridCell[] directly only because a shared value's contents need to be worklet-safe/serializable.
  const severedCells = useSharedValue<{ x: number; y: number }[]>([])
  // 0 = the full severed chain still visible, 1 = fully eaten away — see severedPath, which draws
  // only the suffix of severedCells still "ahead of" this progress. Starts at 1 (nothing to show)
  // rather than 0, so an idle trail with no severed segment yet doesn't render one.
  const severedProgress = useSharedValue(1)

  useEffect(() => {
    if (tick === 0) {
      // First paint, or a fresh round via rematch — GameState.tick resets to 0 on every new round
      // (see createInitialGameState), which is what actually distinguishes this from a real tick:
      // rematch resets game *state* but doesn't remount this component, so a plain "have we ever
      // mounted" ref stayed true across rounds and this branch never re-ran — the animate branch
      // below took over on round 2 and tried to glide from wherever the previous round ended all
      // the way to the new spawn point. Jump straight to the starting cell instead.
      animX.value = head.x
      animY.value = head.y
      tailAnimX.value = tailTarget.x
      tailAnimY.value = tailTarget.y
      edgeStartX.value = head.x
      edgeStartY.value = head.y
      lastTickAtRef.current = performance.now()
      // A break's own eat-away can still be mid-flight the instant its round ends (see the
      // severed-eat effect's own comment on why that's fine to just let vanish) — clear it here so
      // a rematch's fresh trail doesn't inherit a stale, unrelated severed segment left over from
      // wherever the previous round's animation happened to stop.
      severedCells.value = []
      severedProgress.value = 1
      return
    }
    // Duration is measured against the actual gap since the previous tick's glide started, not
    // the nominal tickIntervalMs the tick loop (useGameState.ts) is targeting — that loop only
    // checks its own elapsed time once per rAF frame, so it can overshoot the target by up to a
    // frame every tick. Capped at 3x the nominal interval so a real stall (backgrounded tab, GC
    // pause) can't stretch a single glide across it.
    const now = performance.now()
    const duration = Math.max(1, Math.min(now - lastTickAtRef.current, tickIntervalMs * 3))
    lastTickAtRef.current = now
    // Freeze wherever the head glide actually is *right now* — not its target — as the next
    // segment's fixed anchor, before retargeting it below. See edgeStartX's own comment for why:
    // this is what guarantees the fixed anchor and the animated point are always exactly
    // coincident the instant a new segment starts, regardless of whether the glide this replaces
    // had actually finished.
    edgeStartX.value = animX.value
    edgeStartY.value = animY.value
    animX.value = withTiming(head.x, { duration, easing: Easing.linear })
    animY.value = withTiming(head.y, { duration, easing: Easing.linear })
    // Targets tailTarget (the fractional creep toward nextCenter — see tailProgress), not `tail`
    // itself, so this animates every tick under a non-static tier, not only the ones that trim a
    // whole cell off. That's what actually fixes the held-then-hop cadence: previously this only
    // had two states, sitting at `tail` or gliding to a new `tail`, so any tick that didn't trim
    // looked identical to the tail not following at all.
    tailAnimX.value = withTiming(tailTarget.x, { duration, easing: Easing.linear })
    tailAnimY.value = withTiming(tailTarget.y, { duration, easing: Easing.linear })
    // Only an actual new tick should retrigger this — tickIntervalMs changing mid-glide (speed
    // ramp) should finish the current glide at its original pace, not restart it. Keyed on `tick`
    // rather than trail.length: under a laggy trailGrowthTier, a tick that both appends and trims
    // the trail leaves its length unchanged, which would otherwise silently skip the glide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  // Detects a Prune/Shield-break severing more than one cell off the trail's front in one go, and
  // kicks off severedPath's eat-away for exactly that chain of cells. Compares against the trail
  // this component saw on its OWN last run (a plain ref is fine here — read and written only
  // inside this effect, never during render) rather than trail.length, which can't tell "1 cell
  // trimmed" from "40 cells severed" and wouldn't have the actual cut cells to animate through
  // anyway. Keyed on `trail` itself, not `tick`: a Prune activation (see useGameState.ts's
  // `activate`) trims the trail independent of the tick loop entirely, so gating this on `tick`
  // the way the glide effect above does would miss it until the next real tick happened to land.
  const prevTrailRef = useRef(trail)
  useEffect(() => {
    const prevTrail = prevTrailRef.current
    prevTrailRef.current = trail
    const newFront = trail[0]
    const cutIndex = prevTrail.findIndex((c) => c.x === newFront.x && c.y === newFront.y)
    // 0 = nothing cut. 1 = the routine single-cell growth-tier trim, already handled smoothly by
    // tailProgress/tailAnimX above — no jump to fix there. -1 = no relation at all to the previous
    // trail (a fresh round's spawn cell vs. the last round's final trail), which this same check
    // conveniently also skips correctly with no separate tick===0 case needed.
    if (cutIndex <= 1) return
    // Order: index 0 nearest the break (surviving trail), last index the old tail — the direction
    // severedPath actually eats through, matching where a player's eye is already looking (the
    // break just happened right there) rather than starting from the far, unwatched tail end.
    const removedCells = prevTrail.slice(0, cutIndex).reverse()
    const duration = Math.min(TRAIL_SEVER_EAT_MAX_MS, Math.max(TRAIL_SEVER_EAT_MIN_MS, removedCells.length * TRAIL_SEVER_EAT_MS_PER_CELL))
    // The surviving tail is now at `tail` (trail[0], post-break) — snapped instantly rather than
    // animated there, since the severed segment below is what now carries the "something just
    // happened" visual. Without this, the tick effect's own withTiming (see above — it runs first
    // within the same commit on a Shield break, which is tick-synchronized; this effect's plain
    // assignment overrides it, same "last write this commit wins" trick edgeStartX's snapshot
    // already relies on) would glide tailAnimX/Y from wherever it was toward the new, generally
    // non-adjacent `tail` in a straight pixel-space line — the exact diagonal this whole mechanism
    // exists to get rid of. Fresh fractional creep toward the new nextCenter (see tailTarget)
    // resumes correctly from here on subsequent ticks with no special-casing needed.
    //
    // react-hooks/immutability doesn't recognize Reanimated's SharedValue as the deliberate,
    // React-Compiler-exempt mutable escape hatch it is — every .value assignment in this file
    // (animX/tailAnimX/edgeStartX above included) has this identical shape, and this project
    // doesn't run the React Compiler itself (see eslint.config.cjs, where the rule is 'warn'-only
    // for exactly this reason: a heads-up for a future migration, not an enforced constraint now).
    /* eslint-disable react-hooks/immutability */
    severedCells.value = removedCells.map((c) => ({ x: c.x, y: c.y }))
    severedProgress.value = 0
    severedProgress.value = withTiming(1, { duration, easing: Easing.linear })
    tailAnimX.value = tail.x
    tailAnimY.value = tail.y
    /* eslint-enable react-hooks/immutability */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail])

  // The severed chain's currently-visible suffix, as a Skia path — a fractional point interpolated
  // between whichever two cells severedProgress currently falls between (same "creep along one
  // real segment" technique as tailTarget above), then straight lines through every cell after it
  // to the old tail. Every point plotted is always either a real trail cell or a lerp between two
  // ADJACENT ones, which is exactly what makes this immune to the bug it replaces: the old
  // mechanism free-glided the tail's live position in raw pixel space toward wherever the trail's
  // new front ended up, with nothing stopping that straight line from cutting across the board at
  // an angle no real trail could ever occupy. Renders nothing (Skia strokes an empty/1-point path
  // as nothing) once fully eaten, or when there's no severed segment at all — the idle default.
  const severedPath = useDerivedValue(() => {
    const cells = severedCells.value
    const path = Skia.Path.Make()
    if (cells.length < 2) return path
    const eatenFloat = severedProgress.value * (cells.length - 1)
    const eatenWhole = Math.floor(eatenFloat)
    if (eatenWhole >= cells.length - 1) return path
    const frac = eatenFloat - eatenWhole
    const a = cells[eatenWhole]
    const b = cells[eatenWhole + 1]
    path.moveTo((a.x + (b.x - a.x) * frac) * cellPx + cellPx / 2, (a.y + (b.y - a.y) * frac) * cellPx + cellPx / 2)
    for (let i = eatenWhole + 1; i < cells.length; i++) {
      path.lineTo(cells[i].x * cellPx + cellPx / 2, cells[i].y * cellPx + cellPx / 2)
    }
    return path
  })

  // `anchorCell` is where the head stood BEFORE its most recent move, as a GRID cell — matching
  // `trail`'s own element type, not `head`'s pixel one, since boundaryIndex below searches for it
  // WITHIN `trail`; comparing pixel coordinates against grid ones there would never match at all.
  // `prevHeadCell` is scratch state purely for detecting the transition; `anchorCell` is the actual
  // payload, captured from `prevHeadCell`'s OLD value in the SAME render-phase update that advances
  // `prevHeadCell` to the new head cell. This two-state split is required, not stylistic: React's
  // "adjusting state during render" pattern (see
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders, the
  // `trend`-derived-from-`prevCount` example) immediately re-invokes this component once
  // `prevHeadCell` is updated, and `prevHeadCell` reads as the NEW head cell from that very
  // re-invocation onward — a single `prevHeadCell` state, read anywhere outside this `if`, would
  // desync by exactly one head-move, always resolving to the head's own index and quietly breaking
  // the animated bridge to it. A ref would have the identical problem this pattern exists to avoid,
  // plus reading it during render is unsafe (and lint-forbidden) under concurrent rendering; an
  // effect-based update would land one render late, after `trail` had already moved on to yet
  // another tick's data.
  const headCell = trail[trail.length - 1]
  const [prevHeadCell, setPrevHeadCell] = useState(headCell)
  const [anchorCell, setAnchorCell] = useState(headCell)
  if (headCell.x !== prevHeadCell.x || headCell.y !== prevHeadCell.y) {
    setAnchorCell(prevHeadCell)
    setPrevHeadCell(headCell)
  }
  // Index of anchorCell within the CURRENT trail array — the front animated segment's true fixed
  // anchor (settledPath below stops there; everything past it is this tick's own new movement,
  // tracked live by animX/animY instead so it glides into place rather than snapping). Re-looked-up
  // fresh every render, rather than cached as an index alongside anchorCell, so it stays correct
  // even when the trail's FRONT also shifted since anchorCell was captured — a Prune/Shield severing
  // cells off the front (see the severed-eat effect below) can land on any render, not just the ones
  // where the head itself also happens to move, and a cached index would silently point at whatever
  // cell now sits at that position instead of at anchorCell's actual, possibly-shifted one. -1 (not
  // found — anchorCell itself got severed away too, or a fresh round's spawn cell has no relation to
  // the last round's final trail) clamps to 0: the whole current trail counts as new movement.
  const foundIndex = trail.findIndex((c) => c.x === anchorCell.x && c.y === anchorCell.y)
  const boundaryIndex = foundIndex === -1 ? 0 : foundIndex

  // Every settled cell except the first and the ones this tick's own movement just added (which
  // are instead tracked live by (tailAnimX, tailAnimY) and (animX, animY) below so both ends glide
  // into place rather than snapping).
  const settledPath = useMemo(() => trailPath(trail.slice(1, boundaryIndex + 1), cellPx), [trail, cellPx, boundaryIndex])
  const fullPath = useMemo(() => trailPath(trail, cellPx), [trail, cellPx])

  // trail[boundaryIndex] (this segment's true fixed anchor) and trail[1] (nextCell/nextCenter, the
  // tail segment's own far end) are the exact same cell whenever boundaryIndex === 1 — the trail's
  // only "middle" cell is both at once (the single-step-per-tick case this used to hardcode as
  // trail.length === 3; boundaryIndex generalizes it to a boosted tick's larger step count too).
  // settledPath (trail.slice(1, boundaryIndex+1)) is what's supposed to visually cover any slack
  // between the two segments meeting there, but when boundaryIndex <= 1 that slice has at most one
  // point — Skia strokes nothing for a path with no line segments — so there's no stroke left to
  // mask even the small mismatch edgeStartX's own snapshot timing can leave (see its comment): the
  // two segments could each land a pixel or two short of the shared cell and the result is a visible
  // gap with nothing drawn between them. Using the real cell directly there instead of the snapshot
  // costs nothing and guarantees the two segments meet exactly, independent of animation timing.
  // boundaryIndex === 0 needs `tail` specifically, not `nextCenter` — trail[0] and trail[1] are
  // DIFFERENT cells (unlike the boundaryIndex === 1 case, where trail[1] IS trail[boundaryIndex]),
  // and substituting the wrong one here skips the tail-to-trail[1] cell entirely from this segment,
  // opening a real gap wherever tailEdgeStart/tailEdgeEnd doesn't independently happen to cover the
  // exact same span (see boundaryIndex's own comment for how it can land on 0: anchorCell itself
  // getting severed away, or a boost active before the trail's grown past its own step count).
  // Longer trails keep the snapshot: trail[boundaryIndex] is a cell neither `tail` nor `nextCenter`
  // there.
  const edgeAnchor = boundaryIndex === 0 ? tail : boundaryIndex === 1 ? nextCenter : null
  const edgeStart = useDerivedValue(() => (edgeAnchor ? vec(edgeAnchor.x, edgeAnchor.y) : vec(edgeStartX.value, edgeStartY.value)))
  const edgeEnd = useDerivedValue(() => vec(animX.value, animY.value))

  const tailEdgeStart = useDerivedValue(() => vec(tailAnimX.value, tailAnimY.value))
  // trail[1] (nextCell/nextCenter, computed above) IS the head itself once the trail's down to two
  // cells or less — trimmed aggressively enough (see 'fast', or any tier early in a round before
  // the trail has grown past a couple of cells) that there's nothing between the tail and the head
  // to be a distinct fixed point. Using nextCenter's plain (unanimated) position there snapped this
  // segment's far end straight to the head's *discrete* cell the instant that happened, while the
  // head itself was still mid-glide toward it — the tail's line would already reach exactly where
  // the head marker hadn't visually arrived yet, reading as the tail poking out ahead of the
  // vehicle. Following animX/animY instead — the same live position the head marker itself uses —
  // keeps the two exactly coincident the whole time, same fix as edgeStartX's own for the same
  // underlying mismatch (a static, trail-derived point vs. a live animated one that hasn't caught
  // up to it yet).
  const tailEdgeEnd = useDerivedValue(() => (trail.length > 2 ? vec(nextCenter.x, nextCenter.y) : vec(animX.value, animY.value)))

  const dimmed = phase === 'roundOver' && !player.alive

  return (
    <>
      {player.alive ? (
        <>
          <Path path={settledPath} style='stroke' strokeWidth={trailWidth} strokeCap='round' strokeJoin='round' color={player.color} />
          {/* The chain a Prune/Shield break just cut off `trail` entirely — no longer part of
          settledPath/tailEdgeEnd's own data at all, but still visibly eating itself away for a
          beat rather than just vanishing. See severedPath's own comment. */}
          <Path path={severedPath} style='stroke' strokeWidth={trailWidth} strokeCap='round' strokeJoin='round' color={player.color} />
          <Line p1={tailEdgeStart} p2={tailEdgeEnd} strokeWidth={trailWidth} strokeCap='round' color={player.color} />
          {/* Skipped once the tail's own segment already reaches the head (trail.length <= 2 —
          see tailEdgeEnd's comment): edgeStart is a snapshot of the head's own glide a moment
          ago, updated on its own schedule, unrelated to tailAnimX's — the two segments could
          each be "correct" on their own terms and still not meet exactly, leaving a visible gap
          between them right where the trail is shortest. There's nothing for this segment to add
          once the tail segment already spans tail-to-head on its own. */}
          {trail.length > 2 && <Line p1={edgeStart} p2={edgeEnd} strokeWidth={trailWidth} strokeCap='round' color={player.color} />}
          <Circle cx={animX} cy={animY} r={headRadius} color={player.color} />
          <Circle cx={animX} cy={animY} r={headRadius} style='stroke' strokeWidth={1.5} color={getContrastColor(player.color)} />
          {/* Active-effect "tell" rings, nested at increasing radii so more than one at once
          (e.g. Shield popped while already Overclocked) stays visually distinguishable rather
          than overlapping exactly. Colored by what's actually driving the effect (see
          POWERUP_EFFECT_COLORS) so Overdrive/Overclock read as visually distinct at a glance
          despite sharing the same 2x multiplier — one is something you chose, the other isn't. */}
          {player.effects.speed && <Circle cx={animX} cy={animY} r={headRadius * 1.35} style='stroke' strokeWidth={2} color={POWERUP_EFFECT_COLORS[player.effects.speed.type]} />}
          {player.effects.control && <Circle cx={animX} cy={animY} r={headRadius * 1.7} style='stroke' strokeWidth={2} color={POWERUP_EFFECT_COLORS.hack} />}
          {player.effects.shield && <Circle cx={animX} cy={animY} r={headRadius * 2.05} style='stroke' strokeWidth={2} color={POWERUP_EFFECT_COLORS.shield} />}
        </>
      ) : (
        // Round already decided for this player — show the exact final path statically rather
        // than mid-glide, but keep a (static, non-animated) head marker at the crash cell so
        // exactly where they went down is still visible, not just inferable from where the line
        // happens to end.
        <>
          <Path path={fullPath} style='stroke' strokeWidth={trailWidth} strokeCap='round' strokeJoin='round' color={player.color} opacity={dimmed ? DEAD_TRAIL_OPACITY : 1} />
          <Circle cx={head.x} cy={head.y} r={headRadius} color={player.color} opacity={dimmed ? DEAD_TRAIL_OPACITY : 1} />
          <Circle cx={head.x} cy={head.y} r={headRadius} style='stroke' strokeWidth={1.5} color={DEAD_HEAD_OUTLINE_COLOR} opacity={dimmed ? DEAD_TRAIL_OPACITY : 1} />
        </>
      )}
    </>
  )
}

export function GameBoard({ players, phase, tickIntervalMs, cellPx, grid, orientationMode, p1OnRight, tick, pickups, pickupColor, trailGrowthRate }: GameBoardProps) {
  return (
    <View style={styles.container}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Walls grid={grid} cellPx={cellPx} orientationMode={orientationMode} p1OnRight={p1OnRight} players={players} phase={phase} />
        <Powerups pickups={pickups} cellPx={cellPx} color={pickupColor} />
        <PlayerTrail player={players[1]} phase={phase} tickIntervalMs={tickIntervalMs} cellPx={cellPx} tick={tick} trailGrowthRate={trailGrowthRate} />
        <PlayerTrail player={players[2]} phase={phase} tickIntervalMs={tickIntervalMs} cellPx={cellPx} tick={tick} trailGrowthRate={trailGrowthRate} />
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 }
})
