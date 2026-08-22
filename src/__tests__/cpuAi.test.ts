import { GameState, PlayerState } from '@/types'
import { applyCpuTurn, chooseCpuDirection } from '@/utils/cpuAi'

describe('chooseCpuDirection', () => {
  it('avoids a dead end and picks the direction with strictly more open space', () => {
    // 1-row strip: 'up' is immediately out of bounds, 'left' dead-ends after one cell, 'right'
    // opens onto 4 free cells — an unambiguous, hand-countable comparison.
    const grid = { cols: 8, rows: 1 }
    const player: PlayerState = { trail: [{ x: 3, y: 0 }], direction: 'up', pendingDirection: null, alive: true, color: '#000' }
    const occupied = new Set(['3,0', '1,0'])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard' })).toBe('right')
  })

  it('prefers continuing straight over an equally-good turn', () => {
    // 5x5 grid; 'left' is a sealed 1-cell pocket, 'up' and 'right' both open onto the same large
    // connected region (tied). Heading 'up' already, so the tie should resolve to 'up'.
    const grid = { cols: 5, rows: 5 }
    const player: PlayerState = { trail: [{ x: 2, y: 2 }], direction: 'up', pendingDirection: null, alive: true, color: '#000' }
    const occupied = new Set(['2,2', '0,2', '1,1', '1,3'])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard' })).toBe('up')
  })

  it('returns the only safe option when the rest are fatal', () => {
    const grid = { cols: 3, rows: 1 }
    const player: PlayerState = { trail: [{ x: 1, y: 0 }], direction: 'up', pendingDirection: null, alive: true, color: '#000' }
    const occupied = new Set(['1,0', '2,0'])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard' })).toBe('left')
  })

  it('never returns a 180° reversal of the current heading', () => {
    const grid = { cols: 8, rows: 1 }
    const player: PlayerState = { trail: [{ x: 3, y: 0 }], direction: 'right', pendingDirection: null, alive: true, color: '#000' }
    const occupied = new Set(['3,0'])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard' })).not.toBe('left')
  })

  describe('normal difficulty', () => {
    const grid = { cols: 8, rows: 1 }
    const player: PlayerState = { trail: [{ x: 3, y: 0 }], direction: 'up', pendingDirection: null, alive: true, color: '#000' }
    const occupied = new Set(['3,0', '1,0'])

    it('takes the best move when the random roll misses the suboptimal chance', () => {
      expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'normal', random: () => 0.99 })).toBe('right')
    })

    it('takes the runner-up move when the random roll hits the suboptimal chance', () => {
      expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'normal', random: () => 0 })).toBe('left')
    })
  })

  describe('easy difficulty', () => {
    const grid = { cols: 8, rows: 1 }
    const player: PlayerState = { trail: [{ x: 3, y: 0 }], direction: 'up', pendingDirection: null, alive: true, color: '#000' }
    const occupied = new Set(['3,0', '1,0'])

    it('takes the best move when the random roll misses', () => {
      expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'easy', random: () => 0.99 })).toBe('right')
    })

    it('can take a non-optimal safe move when the random roll hits', () => {
      const rolls = [0, 0.9]
      let i = 0
      const random = () => rolls[i++]
      expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'easy', random })).toBe('left')
    })
  })
})

describe('applyCpuTurn', () => {
  function baseState(): GameState {
    return {
      phase: 'playing',
      grid: { cols: 10, rows: 10 },
      players: {
        1: { trail: [{ x: 2, y: 5 }], direction: 'right', pendingDirection: null, alive: true, color: '#3B82F6' },
        2: { trail: [{ x: 7, y: 5 }], direction: 'left', pendingDirection: null, alive: true, color: '#EF4444' }
      },
      outcome: null,
      tick: 0
    }
  }

  it('queues a turn for player 2 away from an immediate wall, and never touches player 1', () => {
    const state = baseState()
    state.players[2] = { ...state.players[2], trail: [{ x: 0, y: 5 }], direction: 'left' }

    const next = applyCpuTurn(state, 'hard')
    expect(next.players[2].pendingDirection).not.toBeNull()
    expect(next.players[2].pendingDirection).not.toBe('left')
    expect(next.players[1].pendingDirection).toBeNull()
  })

  it('is a no-op outside the playing phase', () => {
    const state = { ...baseState(), phase: 'onboarding' as const }
    expect(applyCpuTurn(state, 'hard')).toBe(state)
  })

  it('is a no-op once the CPU has been eliminated', () => {
    const state = baseState()
    state.players[2] = { ...state.players[2], alive: false }
    expect(applyCpuTurn(state, 'hard')).toBe(state)
  })
})
