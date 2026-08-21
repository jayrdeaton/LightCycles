import { SPEED_RAMP_DECREMENT_MS, SPEED_RAMP_INTERVAL_MS, SPEED_RAMP_MIN_INTERVAL_MS } from '@/constants/game'
import { Direction, GameState, GridSize, OrientationMode, Player, PlayerState, RoundOutcome } from '@/types'

import { cellKey, computeGridSize, isInBounds, isOppositeDirection, startingStateFor, stepCell } from './grid'

function createPlayerState(grid: GridSize, player: Player, mode: OrientationMode, color: string): PlayerState {
  const { head, direction } = startingStateFor(player, grid, mode)
  return { trail: [head], direction, pendingDirection: null, alive: true, color }
}

export function createInitialGameState(width: number, height: number, mode: OrientationMode, colors: Record<Player, string>, cellPx: number): GameState {
  const grid = computeGridSize(width, height, cellPx)
  return {
    phase: 'onboarding',
    grid,
    players: {
      1: createPlayerState(grid, 1, mode, colors[1]),
      2: createPlayerState(grid, 2, mode, colors[2])
    },
    outcome: null
  }
}

export function startPlaying(state: GameState): GameState {
  return state.phase === 'onboarding' ? { ...state, phase: 'playing' } : state
}

// Every cell either player's trail currently occupies — the shared "what's blocked" set both
// tickGame's own collision check and cpuAi.ts's flood-fill scoring read from, built the same way
// in both places so they can never disagree about what counts as occupied.
export function buildOccupiedSet(players: Record<Player, PlayerState>): Set<string> {
  const occupied = new Set<string>()
  for (const cell of players[1].trail) occupied.add(cellKey(cell))
  for (const cell of players[2].trail) occupied.add(cellKey(cell))
  return occupied
}

// Queues a turn for the next tick. Ignored outside 'playing', for an eliminated player, or when
// the requested direction is a no-op (already heading that way) or a 180° reversal into the
// player's own trail (see PLAN.md's "No reversing" rule) — enforced here, once, rather than by
// every input source that could dispatch a turn.
export function applyTurnIntent(state: GameState, player: Player, direction: Direction): GameState {
  if (state.phase !== 'playing') return state
  const p = state.players[player]
  if (!p.alive) return state
  if (direction === p.direction) return state
  if (isOppositeDirection(direction, p.direction)) return state
  if (p.pendingDirection === direction) return state

  return { ...state, players: { ...state.players, [player]: { ...p, pendingDirection: direction } } }
}

// Advances the round exactly one grid step. Both players move simultaneously: each player's next
// head cell is computed from whichever direction they queued (or their current heading, if none),
// then both are checked for a crash against the combined trail-so-far, the grid edge, and each
// other. A crash ends the round immediately — this is a 2-player game, so one crash always means
// the other player wins outright; there's no "keep simulating with one survivor" state.
//
// `occupied` defaults to a fresh build from `state.players` (correct for every existing call
// site/test), but a caller that's already built one from this same state — see useGameState.ts,
// which also feeds applyCpuTurn from it — can pass it in to skip rebuilding it a second time on
// the same tick. Trails never change between that build and this call (only pendingDirection
// does), so reusing it is always safe, not just an optimization that happens to work today.
export function tickGame(state: GameState, occupied: ReadonlySet<string> = buildOccupiedSet(state.players)): GameState {
  if (state.phase !== 'playing') return state

  const { grid } = state
  const p1 = state.players[1]
  const p2 = state.players[2]

  const dir1 = p1.pendingDirection ?? p1.direction
  const dir2 = p2.pendingDirection ?? p2.direction

  const head1 = p1.trail[p1.trail.length - 1]
  const head2 = p2.trail[p2.trail.length - 1]
  const next1 = stepCell(head1, dir1)
  const next2 = stepCell(head2, dir2)

  // Both cycles moving into the same cell on the same tick — a head-on collision — counts as a
  // crash for both, regardless of whether that cell was otherwise free.
  const headOn = next1.x === next2.x && next1.y === next2.y
  const oob1 = !isInBounds(next1, grid)
  const oob2 = !isInBounds(next2, grid)
  const crash1 = headOn || oob1 || occupied.has(cellKey(next1))
  const crash2 = headOn || oob2 || occupied.has(cellKey(next2))

  if (crash1 || crash2) {
    const outcome: RoundOutcome = crash1 && crash2 ? { type: 'draw' } : { type: 'win', winner: crash1 ? 2 : 1 }
    return {
      ...state,
      phase: 'roundOver',
      outcome,
      players: {
        // A crash into a trail (own, opponent's, or head-on) still extends the trail to the
        // collision cell, so the cycle visibly reaches whatever it hit rather than stopping one
        // cell short — an out-of-bounds crash can't do this, since that cell doesn't exist on the
        // grid to render.
        1: { ...p1, trail: oob1 ? p1.trail : [...p1.trail, next1], alive: !crash1, pendingDirection: null },
        2: { ...p2, trail: oob2 ? p2.trail : [...p2.trail, next2], alive: !crash2, pendingDirection: null }
      }
    }
  }

  return {
    ...state,
    players: {
      1: { ...p1, trail: [...p1.trail, next1], direction: dir1, pendingDirection: null },
      2: { ...p2, trail: [...p2.trail, next2], direction: dir2, pendingDirection: null }
    }
  }
}

// Effective ms-per-grid-step at a given point in round time. Ramping is layered on top of the
// selected base tier rather than replacing it, so 'fast' + ramp reaches the floor sooner than
// 'slow' + ramp does. decrementMs/minIntervalMs default to the reference (medium grid-size tier)
// constants — a caller at a different tier passes its own scaleMsForCellPx'd values (see
// useGameState.ts) so the ramp scales consistently with the rest of the tick timing.
export function computeTickIntervalMs(baseIntervalMs: number, elapsedMs: number, rampEnabled: boolean, decrementMs: number = SPEED_RAMP_DECREMENT_MS, minIntervalMs: number = SPEED_RAMP_MIN_INTERVAL_MS): number {
  if (!rampEnabled) return baseIntervalMs
  const steps = Math.floor(elapsedMs / SPEED_RAMP_INTERVAL_MS)
  return Math.max(minIntervalMs, baseIntervalMs - steps * decrementMs)
}
