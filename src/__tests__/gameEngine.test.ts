import { GRID_CELL_PX, POWERUP_ALL_TYPES, POWERUP_EFFECT_DURATION_TICKS, POWERUP_PRUNE_AMOUNT_CELLS, SPEED_RAMP_DECREMENT_MS, SPEED_RAMP_INTERVAL_MS, SPEED_RAMP_MIN_INTERVAL_MS } from '@/constants/game'
import { GameState, GridCell, PlayerState } from '@/types'
import { applyActivation, applyTurnIntent, computeTickIntervalMs, createInitialGameState, startPlaying, tickGame } from '@/utils/gameEngine'

// Fills in the fields every fixture needs regardless of what it's actually testing, so each call
// site only has to spell out what's relevant to it.
function ps(overrides: Partial<PlayerState> & Pick<PlayerState, 'trail' | 'direction'>): PlayerState {
  return { pendingDirection: null, alive: true, color: '#000', heldPowerup: null, effects: { speed: null, control: null, shield: null }, ...overrides }
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  const base: GameState = {
    phase: 'playing',
    grid: { cols: 10, rows: 10 },
    players: {
      1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6' }),
      2: ps({ trail: [{ x: 7, y: 5 }], direction: 'left', color: '#EF4444' })
    },
    outcome: null,
    tick: 0,
    pickups: []
  }
  return { ...base, ...overrides }
}

describe('createInitialGameState', () => {
  it('starts in the onboarding phase with two alive players and no outcome', () => {
    const state = createInitialGameState(200, 200, 'faceToFace', { 1: '#3B82F6', 2: '#EF4444' }, GRID_CELL_PX.medium, true)
    expect(state.phase).toBe('onboarding')
    expect(state.outcome).toBeNull()
    expect(state.players[1].alive).toBe(true)
    expect(state.players[2].alive).toBe(true)
    expect(state.players[1].color).toBe('#3B82F6')
    expect(state.players[2].color).toBe('#EF4444')
    expect(state.players[1].heldPowerup).toBeNull()
    expect(state.players[1].effects).toEqual({ speed: null, control: null, shield: null })
    expect(state.pickups).toEqual([])
  })
})

describe('startPlaying', () => {
  it('transitions onboarding -> playing', () => {
    const state = createInitialGameState(200, 200, 'faceToFace', { 1: '#3B82F6', 2: '#EF4444' }, GRID_CELL_PX.medium, true)
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

  it('still lets a frozen (Stasis) player queue a turn for whenever they unfreeze', () => {
    const state = makeState({ players: { ...makeState().players, 1: { ...makeState().players[1], effects: { speed: { type: 'stasis', multiplier: 0, expiresAtTick: 50 }, control: null, shield: null } } } })
    const next = applyTurnIntent(state, 1, 'up')
    expect(next.players[1].pendingDirection).toBe('up')
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
        1: ps({ trail: [{ x: 0, y: 5 }], direction: 'left', color: '#3B82F6' }),
        2: ps({ trail: [{ x: 7, y: 5 }], direction: 'left', color: '#EF4444' })
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
        1: ps({
          trail: [
            { x: 2, y: 5 },
            { x: 3, y: 5 },
            { x: 3, y: 6 }
          ],
          direction: 'up',
          color: '#3B82F6'
        }),
        2: ps({ trail: [{ x: 7, y: 0 }], direction: 'left', color: '#EF4444' })
      }
    })
    // Heading 'up' from (3,6) steps back onto (3,5), which is already in player 1's own trail.
    const next = tickGame(state)
    expect(next.outcome).toEqual({ type: 'win', winner: 2 })
  })

  it('crashes a player who drives into the opponent trail', () => {
    const state = makeState({
      players: {
        1: ps({ trail: [{ x: 4, y: 5 }], direction: 'right', color: '#3B82F6' }),
        2: ps({
          trail: [
            { x: 8, y: 5 },
            { x: 7, y: 5 },
            { x: 6, y: 5 },
            { x: 5, y: 5 }
          ],
          direction: 'up',
          color: '#EF4444'
        })
      }
    })
    const next = tickGame(state)
    expect(next.outcome).toEqual({ type: 'win', winner: 2 })
    expect(next.players[1].alive).toBe(false)
  })

  it('calls a head-on collision a draw', () => {
    const state = makeState({
      players: {
        1: ps({ trail: [{ x: 4, y: 5 }], direction: 'right', color: '#3B82F6' }),
        2: ps({ trail: [{ x: 6, y: 5 }], direction: 'left', color: '#EF4444' })
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
        1: ps({ trail: [{ x: 0, y: 5 }], direction: 'left', color: '#3B82F6' }),
        2: ps({ trail: [{ x: 9, y: 5 }], direction: 'right', color: '#EF4444' })
      }
    })
    const next = tickGame(state)
    expect(next.outcome).toEqual({ type: 'draw' })
  })

  it('is a no-op once the round is already over', () => {
    const state = makeState({ phase: 'roundOver', outcome: { type: 'draw' } })
    expect(tickGame(state)).toBe(state)
  })

  // Both players head 'up' in parallel, 5 columns apart — never cross or catch each other, so
  // every tick below stays crash-free out to the tested tick count.
  function makeParallelState(): GameState {
    return makeState({
      players: {
        1: ps({ trail: [{ x: 2, y: 9 }], direction: 'up', color: '#3B82F6' }),
        2: ps({ trail: [{ x: 7, y: 9 }], direction: 'up', color: '#EF4444' })
      }
    })
  }

  it('increments tick every advancing call, defaulting trailGrowthRate to 1 (never trims)', () => {
    let state = makeParallelState()
    for (let i = 1; i <= 4; i++) {
      state = tickGame(state)
      expect(state.tick).toBe(i)
      expect(state.players[1].trail).toHaveLength(i + 1)
    }
  })

  it('trims the trail tail on ticks needed to hold a sub-1 trailGrowthRate, keeping length below tick count', () => {
    let state = makeParallelState()
    for (let i = 0; i < 8; i++) {
      state = tickGame(state, undefined, 0.5)
    }
    // 8 ticks at a 0.5 growth rate: 4 trims, net length = 1 (start) + 8 (appends) - 4 (trims) = 5.
    expect(state.players[1].trail).toHaveLength(5)
    expect(state.players[2].trail).toHaveLength(5)
  })

  it('never trims on the tick a player crashes, even under a sub-1 trailGrowthRate', () => {
    const state = makeState({
      players: {
        1: ps({ trail: [{ x: 0, y: 5 }], direction: 'left', color: '#3B82F6' }),
        2: ps({ trail: [{ x: 7, y: 5 }], direction: 'left', color: '#EF4444' })
      }
    })
    const next = tickGame(state, undefined, 0.5)
    expect(next.players[1].trail).toEqual([{ x: 0, y: 5 }])
  })

  describe('powerup speed effects', () => {
    it('Overdrive covers 2 cells in a single tickGame call', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6', effects: { speed: { type: 'overdrive', multiplier: 2, expiresAtTick: 100 }, control: null, shield: null } }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        }
      })
      const next = tickGame(state)
      expect(next.phase).toBe('playing')
      expect(next.players[1].trail).toEqual([
        { x: 2, y: 5 },
        { x: 3, y: 5 },
        { x: 4, y: 5 }
      ])
    })

    it('catches a crash on the second sub-step of a boosted player, within one tickGame call', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6', effects: { speed: { type: 'overdrive', multiplier: 2, expiresAtTick: 100 }, control: null, shield: null } }),
          // Player 2's own trail leaves (4,5) occupied — clear of player 1's first step (3,5), but
          // exactly where their second step lands.
          2: ps({
            trail: [
              { x: 6, y: 5 },
              { x: 5, y: 5 },
              { x: 4, y: 5 }
            ],
            direction: 'up',
            color: '#EF4444'
          })
        }
      })
      const next = tickGame(state)
      expect(next.phase).toBe('roundOver')
      expect(next.outcome).toEqual({ type: 'win', winner: 2 })
      // First sub-step succeeded (3,5) before the second sub-step's crash into (4,5).
      expect(next.players[1].trail).toEqual([
        { x: 2, y: 5 },
        { x: 3, y: 5 },
        { x: 4, y: 5 }
      ])
    })

    it('Stasis fully skips movement for a tick, but still resolves a queued direction', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', pendingDirection: 'up', color: '#3B82F6', effects: { speed: { type: 'stasis', multiplier: 0, expiresAtTick: 100 }, control: null, shield: null } }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        }
      })
      const next = tickGame(state)
      expect(next.players[1].trail).toEqual([{ x: 2, y: 5 }])
      expect(next.players[1].direction).toBe('up')
      expect(next.players[1].pendingDirection).toBeNull()
    })

    it('clears a speed effect once its expiresAtTick has passed', () => {
      const state = makeState({
        tick: 4,
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6', effects: { speed: { type: 'overdrive', multiplier: 2, expiresAtTick: 5 }, control: null, shield: null } }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        }
      })
      const next = tickGame(state)
      expect(next.tick).toBe(5)
      expect(next.players[1].effects.speed).toBeNull()
    })
  })

  describe('Shield', () => {
    it('negates a trail-collision, consumes the shield, and destroys the broken trail back to the break point', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6', effects: { speed: null, control: null, shield: { expiresAtTick: 100 } } }),
          // Player 1's next cell (3,5) is player 2's own CURRENT head — the edge case where the
          // break point is the trail owner's own last cell, which trimTrailAtCell must clamp so at
          // least that head cell survives.
          2: ps({
            trail: [
              { x: 6, y: 5 },
              { x: 5, y: 5 },
              { x: 4, y: 5 },
              { x: 3, y: 5 }
            ],
            direction: 'up',
            color: '#EF4444'
          })
        }
      })
      const next = tickGame(state)
      expect(next.phase).toBe('playing')
      expect(next.players[1].alive).toBe(true)
      expect(next.players[1].effects.shield).toBeNull()
      expect(next.players[1].trail).toEqual([
        { x: 2, y: 5 },
        { x: 3, y: 5 }
      ])
      // Trimmed back to just its own head — trimTrailAtCell's clamp, since the break point here
      // was player 2's own last trail cell.
      expect(next.players[2].trail).toEqual([
        { x: 3, y: 5 },
        { x: 3, y: 4 }
      ])
    })

    it('does not protect against a head-on collision', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 4, y: 5 }], direction: 'right', color: '#3B82F6', effects: { speed: null, control: null, shield: { expiresAtTick: 100 } } }),
          2: ps({ trail: [{ x: 6, y: 5 }], direction: 'left', color: '#EF4444' })
        }
      })
      const next = tickGame(state)
      expect(next.outcome).toEqual({ type: 'draw' })
    })

    it('does not protect against leaving the arena', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 0, y: 5 }], direction: 'left', color: '#3B82F6', effects: { speed: null, control: null, shield: { expiresAtTick: 100 } } }),
          2: ps({ trail: [{ x: 7, y: 0 }], direction: 'down', color: '#EF4444' })
        }
      })
      const next = tickGame(state)
      expect(next.outcome).toEqual({ type: 'win', winner: 2 })
    })
  })

  describe('powerup pickups', () => {
    function stateWithPickup(pickupCell: GridCell, overrides: Partial<GameState> = {}): GameState {
      return makeState({
        pickups: [{ id: 'pu-test', type: 'overdrive', cell: pickupCell }],
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6' }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        },
        ...overrides
      })
    }

    it('collects a pickup into heldPowerup, only when powerups are enabled', () => {
      const state = stateWithPickup({ x: 3, y: 5 })
      const next = tickGame(state, undefined, 1, POWERUP_ALL_TYPES)
      expect(next.players[1].heldPowerup).toBe('overdrive')
    })

    it('leaves the pickup on the board when powerups are disabled', () => {
      const state = stateWithPickup({ x: 3, y: 5 })
      const next = tickGame(state, undefined, 1, [])
      expect(next.players[1].heldPowerup).toBeNull()
      expect(next.pickups).toHaveLength(1)
    })

    it('replaces the currently held powerup when driving over a new one', () => {
      const state = stateWithPickup({ x: 3, y: 5 }, { players: { 1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6', heldPowerup: 'shield' }), 2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' }) } })
      const next = tickGame(state, undefined, 1, POWERUP_ALL_TYPES)
      expect(next.players[1].heldPowerup).toBe('overdrive')
      // The board dropping to 0 pickups immediately triggers the "always at least one" spawn (see
      // its own describe block below) — asserting the original is gone, not that the board is
      // empty, since a replacement appearing right away is expected, not a bug.
      expect(next.pickups.some((pu) => pu.id === 'pu-test')).toBe(false)
    })

    it('collects a pickup by driving through any cell within its collection radius, not just its exact cell', () => {
      // Player 1 steps to (3,5); the pickup sits one cell further out at (4,5) — outside an exact
      // match, but within POWERUP_COLLECT_RADIUS_CELLS of (3,5).
      const state = stateWithPickup({ x: 4, y: 5 })
      const next = tickGame(state, undefined, 1, POWERUP_ALL_TYPES)
      expect(next.players[1].heldPowerup).toBe('overdrive')
      expect(next.pickups.some((pu) => pu.id === 'pu-test')).toBe(false)
    })

    it('does not collect a pickup outside its collection radius', () => {
      const state = stateWithPickup({ x: 5, y: 5 })
      const next = tickGame(state, undefined, 1, POWERUP_ALL_TYPES)
      expect(next.players[1].heldPowerup).toBeNull()
      expect(next.pickups).toHaveLength(1)
    })

    it('never spawns pickups when powerups are disabled', () => {
      const state = makeState({ tick: 10, pickups: [] })
      const next = tickGame(state, undefined, 1, [], () => 0)
      expect(next.pickups).toEqual([])
    })

    // Like a single apple in Snake — exactly one pickup is ever on the board, and a replacement
    // never has to wait out an interval/cooldown once it's gone.
    describe('always keeps exactly one pickup on the board', () => {
      it("spawns the round's very first pickup on tick 1", () => {
        const state = makeState({ tick: 0, pickups: [] })
        const next = tickGame(state, undefined, 1, POWERUP_ALL_TYPES, () => 0)
        expect(next.tick).toBe(1)
        expect(next.pickups).toHaveLength(1)
        expect(POWERUP_ALL_TYPES).toContain(next.pickups[0].type)
      })

      it('replaces a collected pickup immediately, on the very next tick', () => {
        const state = stateWithPickup({ x: 3, y: 5 }, { tick: 1 })
        const next = tickGame(state, undefined, 1, POWERUP_ALL_TYPES, () => 0)
        expect(next.players[1].heldPowerup).toBe('overdrive')
        expect(next.pickups).toHaveLength(1)
      })

      it('never spawns a second pickup while one is already on the board', () => {
        // (5,5) is off both players' paths this tick (player 1 steps to (3,5), player 2 to (0,1)),
        // so the existing pickup is NOT collected — a second should still never appear alongside it.
        const state = stateWithPickup({ x: 5, y: 5 }, { tick: 1 })
        const next = tickGame(state, undefined, 1, POWERUP_ALL_TYPES, () => 0)
        expect(next.pickups).toHaveLength(1)
        expect(next.pickups[0].cell).toEqual({ x: 5, y: 5 })
      })
    })
  })
})

describe('applyActivation', () => {
  function activationState(heldPowerup: PlayerState['heldPowerup'], overrides: Partial<GameState> = {}): GameState {
    return makeState({
      players: {
        1: ps({ trail: Array.from({ length: 20 }, (_, i) => ({ x: i, y: 5 })), direction: 'right', color: '#3B82F6', heldPowerup }),
        2: ps({ trail: Array.from({ length: 20 }, (_, i) => ({ x: i, y: 9 })), direction: 'right', color: '#EF4444' })
      },
      ...overrides
    })
  }

  it('is a no-op outside the playing phase', () => {
    const state = activationState('overdrive', { phase: 'onboarding' })
    expect(applyActivation(state, 1)).toBe(state)
  })

  it('is a no-op with nothing held', () => {
    const state = activationState(null)
    expect(applyActivation(state, 1)).toBe(state)
  })

  it('Overdrive sets a self speed effect and clears the inventory slot', () => {
    const state = activationState('overdrive', { tick: 10 })
    const next = applyActivation(state, 1)
    expect(next.players[1].heldPowerup).toBeNull()
    expect(next.players[1].effects.speed).toEqual({ type: 'overdrive', multiplier: 2, expiresAtTick: 10 + POWERUP_EFFECT_DURATION_TICKS.overdrive })
    expect(next.players[2].effects.speed).toBeNull()
  })

  it('Stasis sets a self speed effect with a 0 multiplier', () => {
    const state = activationState('stasis')
    const next = applyActivation(state, 1)
    expect(next.players[1].effects.speed?.multiplier).toBe(0)
  })

  it('Shield sets a self shield effect', () => {
    const state = activationState('shield', { tick: 3 })
    const next = applyActivation(state, 1)
    expect(next.players[1].effects.shield).toEqual({ expiresAtTick: 3 + POWERUP_EFFECT_DURATION_TICKS.shield })
  })

  it('Hack sets a control effect on the OPPONENT, not the activator', () => {
    const state = activationState('hack', { tick: 2 })
    const next = applyActivation(state, 1)
    expect(next.players[1].effects.control).toBeNull()
    expect(next.players[1].heldPowerup).toBeNull()
    expect(next.players[2].effects.control).toEqual({ type: 'hack', expiresAtTick: 2 + POWERUP_EFFECT_DURATION_TICKS.hack })
  })

  it('Overclock sets a speed effect on the OPPONENT, not the activator', () => {
    const state = activationState('overclock', { tick: 2 })
    const next = applyActivation(state, 1)
    expect(next.players[1].effects.speed).toBeNull()
    expect(next.players[2].effects.speed).toEqual({ type: 'overclock', multiplier: 2, expiresAtTick: 2 + POWERUP_EFFECT_DURATION_TICKS.overclock })
  })

  it("Prune trims BOTH trails, but only clears the activating player's own inventory slot", () => {
    const state = activationState('prune', { players: { 1: { ...activationState('prune').players[1], heldPowerup: 'prune' }, 2: { ...activationState('prune').players[2], heldPowerup: 'overdrive' } } })
    const next = applyActivation(state, 1)
    expect(next.players[1].trail).toHaveLength(20 - POWERUP_PRUNE_AMOUNT_CELLS)
    expect(next.players[2].trail).toHaveLength(20 - POWERUP_PRUNE_AMOUNT_CELLS)
    expect(next.players[1].heldPowerup).toBeNull()
    expect(next.players[2].heldPowerup).toBe('overdrive')
  })

  it('a same-axis activation replaces (does not stack with) an existing effect, with a fresh timer', () => {
    // Player 2 is already under a long-lived Overclock (as if just hit by player 1), and is now
    // holding a Stasis to counter it.
    const state = activationState('overdrive', {
      tick: 20,
      players: {
        1: { ...activationState('overdrive').players[1] },
        2: { ...activationState('overdrive').players[2], heldPowerup: 'stasis', effects: { speed: { type: 'overclock', multiplier: 2, expiresAtTick: 200 }, control: null, shield: null } }
      }
    })
    const next = applyActivation(state, 2)
    expect(next.players[2].effects.speed).toEqual({ type: 'stasis', multiplier: 0, expiresAtTick: 20 + POWERUP_EFFECT_DURATION_TICKS.stasis })
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
