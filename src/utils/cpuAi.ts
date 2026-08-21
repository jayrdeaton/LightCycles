import { CPU_EASY_RANDOM_CHANCE, CPU_FLOOD_FILL_CAP, CPU_NORMAL_SUBOPTIMAL_CHANCE } from '@/constants/game'
import { CpuDifficulty, Direction, GameState, GridSize, Player, PlayerState } from '@/types'

import { countReachableCells } from './floodFill'
import { applyTurnIntent, buildOccupiedSet } from './gameEngine'
import { ALL_DIRECTIONS, cellKey, isInBounds, isOppositeDirection, stepCell } from './grid'

// The CPU always plays player 2 — see index.tsx/game.tsx, which fix the human at player 1 (and
// suppress the face-to-face flip entirely) whenever gameMode is 'vsCpu'.
export const CPU_PLAYER: Player = 2

export interface ChooseCpuDirectionParams {
  player: PlayerState
  grid: GridSize
  occupied: ReadonlySet<string>
  difficulty: CpuDifficulty
  random?: () => number
}

// Scores each legal turn (i.e. not a 180° reversal — same rule the reducer enforces for human
// input, see gameEngine.ts) by how much open space it leads toward, via a flood fill from the
// resulting cell. That's what keeps the bot from boxing itself in the way a purely-greedy "avoid
// only the very next cell" bot would — a direction whose first step is safe but only opens onto a
// small pocket still scores low. Difficulty modulates how faithfully the bot follows that score,
// not how fast it reacts (see useGameState.ts) — 'hard' always takes the best-scoring move,
// 'normal'/'easy' sometimes settle for a worse one.
export function chooseCpuDirection({ player, grid, occupied, difficulty, random = Math.random }: ChooseCpuDirectionParams): Direction {
  const head = player.trail[player.trail.length - 1]
  const candidates = ALL_DIRECTIONS.filter((direction) => !isOppositeDirection(direction, player.direction))

  const scored = candidates
    .map((direction) => {
      const next = stepCell(head, direction)
      const safe = isInBounds(next, grid) && !occupied.has(cellKey(next))
      return { direction, space: safe ? countReachableCells(next, grid, occupied, CPU_FLOOD_FILL_CAP) : -1 }
    })
    .sort((a, b) => b.space - a.space)

  const maxSpace = scored[0].space
  const tiedForBest = scored.filter((s) => s.space === maxSpace)
  // Prefers continuing straight over an equally-good turn, purely so the bot doesn't zigzag
  // through symmetric open space for no reason — ties on open-space score are common early in a
  // round, when nothing has carved up the grid yet.
  const best = (tiedForBest.find((s) => s.direction === player.direction) ?? tiedForBest[0]).direction

  if (difficulty === 'hard') return best

  if (difficulty === 'normal') {
    const runnerUp = scored.find((s) => s.direction !== best)
    if (runnerUp && runnerUp.space >= 0 && random() < CPU_NORMAL_SUBOPTIMAL_CHANCE) return runnerUp.direction
    return best
  }

  // 'easy': half the time, ignore the score entirely and take any move that at least survives
  // this step — weak, but not so weak it feels broken by driving straight into a wall on purpose.
  const safeOptions = scored.filter((s) => s.space >= 0)
  if (safeOptions.length > 0 && random() < CPU_EASY_RANDOM_CHANCE) {
    const index = Math.min(safeOptions.length - 1, Math.floor(random() * safeOptions.length))
    return safeOptions[index].direction
  }
  return best
}

// Queues the CPU's chosen turn the same way a human input source would (see turnIntent.ts) —
// applyTurnIntent still owns the actual reversal/no-op/phase/alive guards, so the bot can't bypass
// those rules just by going through a different call site than human input does.
//
// `occupied` defaults to a fresh build from `state.players`, same reasoning as tickGame's own
// default in gameEngine.ts — useGameState.ts builds one set per tick and passes it to both this
// and the tickGame call that follows, instead of each rebuilding it independently.
export function applyCpuTurn(state: GameState, difficulty: CpuDifficulty, occupied: ReadonlySet<string> = buildOccupiedSet(state.players), random?: () => number): GameState {
  if (state.phase !== 'playing') return state
  const player = state.players[CPU_PLAYER]
  if (!player.alive) return state

  const direction = chooseCpuDirection({ player, grid: state.grid, occupied, difficulty, random })
  return applyTurnIntent(state, CPU_PLAYER, direction)
}
