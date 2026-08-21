import { GRID_CELL_PX, SPEED_RAMP_DECREMENT_MS, SPEED_RAMP_INTERVAL_MS, SPEED_RAMP_MIN_INTERVAL_MS } from '@/constants/game'
import { GameState } from '@/types'
import { applyTurnIntent, computeTickIntervalMs, createInitialGameState, startPlaying, tickGame } from '@/utils/gameEngine'

function makeState(overrides: Partial<GameState> = {}): GameState {
  const base: GameState = {
    phase: 'playing',
    grid: { cols: 10, rows: 10 },
    players: {
      1: { trail: [{ x: 2, y: 5 }], direction: 'right', pendingDirection: null, alive: true, color: '#3B82F6' },
      2: { trail: [{ x: 7, y: 5 }], direction: 'left', pendingDirection: null, alive: true, color: '#EF4444' }
    },
    outcome: null
  }
  return { ...base, ...overrides }
}

describe('createInitialGameState', () => {
  it('starts in the onboarding phase with two alive players and no outcome', () => {
    const state = createInitialGameState(200, 200, 'faceToFace', { 1: '#3B82F6', 2: '#EF4444' }, GRID_CELL_PX.medium)
    expect(state.phase).toBe('onboarding')
    expect(state.outcome).toBeNull()
    expect(state.players[1].alive).toBe(true)
    expect(state.players[2].alive).toBe(true)
    expect(state.players[1].color).toBe('#3B82F6')
    expect(state.players[2].color).toBe('#EF4444')
  })
})

describe('startPlaying', () => {
  it('transitions onboarding -> playing', () => {
    const state = createInitialGameState(200, 200, 'faceToFace', { 1: '#3B82F6', 2: '#EF4444' }, GRID_CELL_PX.medium)
    expect(startPlaying(state).phase).toBe('playing')
  })

  it('is a no-op once already playing', () => {
    const state = makeState()
    expect(startPlaying(state)).toBe(state)
  })
})

describe('applyTurnIntent', () => {
  it('queues a valid turn', () => {
    const state = makeState()
    const next = applyTurnIntent(state, 1, 'up')
    expect(next.players[1].pendingDirection).toBe('up')
  })

  it('ignores a 180° reversal into the trail', () => {
    const state = makeState()
    const next = applyTurnIntent(state, 1, 'left')
    expect(next).toBe(state)
    expect(next.players[1].pendingDirection).toBeNull()
  })

  it('ignores a turn matching the current heading (no-op)', () => {
    const state = makeState()
    const next = applyTurnIntent(state, 1, 'right')
    expect(next).toBe(state)
  })

  it('ignores turns outside the playing phase', () => {
    const state = makeState({ phase: 'onboarding' })
    expect(applyTurnIntent(state, 1, 'up')).toBe(state)
  })

  it('ignores turns for an eliminated player', () => {
    const state = makeState({ players: { ...makeState().players, 1: { ...makeState().players[1], alive: false } } })
    expect(applyTurnIntent(state, 1, 'up')).toBe(state)
  })
})

describe('tickGame', () => {
  it('advances both heads by one cell when there is no collision', () => {
    const state = makeState()
    const next = tickGame(state)
    expect(next.phase).toBe('playing')
    expect(next.players[1].trail).toEqual([
      { x: 2, y: 5 },
      { x: 3, y: 5 }
    ])
    expect(next.players[2].trail).toEqual([
      { x: 7, y: 5 },
      { x: 6, y: 5 }
    ])
  })

  it('applies a queued pendingDirection and clears it', () => {
    const state = makeState({ players: { ...makeState().players, 1: { ...makeState().players[1], pendingDirection: 'up' } } })
    const next = tickGame(state)
    expect(next.players[1].direction).toBe('up')
    expect(next.players[1].pendingDirection).toBeNull()
    expect(next.players[1].trail.at(-1)).toEqual({ x: 2, y: 4 })
  })

  it('crashes a player who steps off the edge of the grid — the other player wins', () => {
    const state = makeState({
      players: {
        1: { trail: [{ x: 0, y: 5 }], direction: 'left', pendingDirection: null, alive: true, color: '#3B82F6' },
        2: { trail: [{ x: 7, y: 5 }], direction: 'left', pendingDirection: null, alive: true, color: '#EF4444' }
      }
    })
    const next = tickGame(state)
    expect(next.phase).toBe('roundOver')
    expect(next.outcome).toEqual({ type: 'win', winner: 2 })
    expect(next.players[1].alive).toBe(false)
    expect(next.players[2].alive).toBe(true)
  })

  it('crashes a player who turns into their own trail', () => {
    const state = makeState({
      players: {
        1: {
          trail: [
            { x: 2, y: 5 },
            { x: 3, y: 5 },
            { x: 3, y: 6 }
          ],
          direction: 'up',
          pendingDirection: null,
          alive: true,
          color: '#3B82F6'
        },
        2: { trail: [{ x: 7, y: 0 }], direction: 'left', pendingDirection: null, alive: true, color: '#EF4444' }
      }
    })
    // Heading 'up' from (3,6) steps back onto (3,5), which is already in player 1's own trail.
    const next = tickGame(state)
    expect(next.outcome).toEqual({ type: 'win', winner: 2 })
  })

  it('crashes a player who drives into the opponent trail', () => {
    const state = makeState({
      players: {
        1: { trail: [{ x: 4, y: 5 }], direction: 'right', pendingDirection: null, alive: true, color: '#3B82F6' },
        2: {
          trail: [
            { x: 8, y: 5 },
            { x: 7, y: 5 },
            { x: 6, y: 5 },
            { x: 5, y: 5 }
          ],
          direction: 'up',
          pendingDirection: null,
          alive: true,
          color: '#EF4444'
        }
      }
    })
    const next = tickGame(state)
    expect(next.outcome).toEqual({ type: 'win', winner: 2 })
    expect(next.players[1].alive).toBe(false)
  })

  it('calls a head-on collision a draw', () => {
    const state = makeState({
      players: {
        1: { trail: [{ x: 4, y: 5 }], direction: 'right', pendingDirection: null, alive: true, color: '#3B82F6' },
        2: { trail: [{ x: 6, y: 5 }], direction: 'left', pendingDirection: null, alive: true, color: '#EF4444' }
      }
    })
    const next = tickGame(state)
    expect(next.phase).toBe('roundOver')
    expect(next.outcome).toEqual({ type: 'draw' })
    expect(next.players[1].alive).toBe(false)
    expect(next.players[2].alive).toBe(false)
  })

  it('calls simultaneous independent crashes a draw', () => {
    const state = makeState({
      grid: { cols: 10, rows: 10 },
      players: {
        1: { trail: [{ x: 0, y: 5 }], direction: 'left', pendingDirection: null, alive: true, color: '#3B82F6' },
        2: { trail: [{ x: 9, y: 5 }], direction: 'right', pendingDirection: null, alive: true, color: '#EF4444' }
      }
    })
    const next = tickGame(state)
    expect(next.outcome).toEqual({ type: 'draw' })
  })

  it('is a no-op once the round is already over', () => {
    const state = makeState({ phase: 'roundOver', outcome: { type: 'draw' } })
    expect(tickGame(state)).toBe(state)
  })
})

describe('computeTickIntervalMs', () => {
  it('returns the base interval when ramping is disabled', () => {
    expect(computeTickIntervalMs(110, 60_000, false)).toBe(110)
  })

  it('shrinks the interval in steps as elapsed time grows', () => {
    expect(computeTickIntervalMs(110, 0, true)).toBe(110)
    expect(computeTickIntervalMs(110, SPEED_RAMP_INTERVAL_MS, true)).toBe(110 - SPEED_RAMP_DECREMENT_MS)
    expect(computeTickIntervalMs(110, SPEED_RAMP_INTERVAL_MS * 2, true)).toBe(110 - SPEED_RAMP_DECREMENT_MS * 2)
  })

  it('never goes below the configured floor', () => {
    expect(computeTickIntervalMs(110, SPEED_RAMP_INTERVAL_MS * 1000, true)).toBe(SPEED_RAMP_MIN_INTERVAL_MS)
  })

  it('honors explicit decrement/floor overrides instead of the reference constants', () => {
    expect(computeTickIntervalMs(110, SPEED_RAMP_INTERVAL_MS, true, 20, 5)).toBe(90)
    expect(computeTickIntervalMs(110, SPEED_RAMP_INTERVAL_MS * 1000, true, 20, 5)).toBe(5)
  })
})
