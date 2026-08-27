import { GRID_CELL_PX, MIN_TRAIL_LENGTH_BEFORE_TRIM, POWERUP_ALL_TYPES, POWERUP_EFFECT_DURATION_TICKS, POWERUP_PRUNE_FRACTION, SPEED_RAMP_DECREMENT_MS, SPEED_RAMP_INTERVAL_MS, SPEED_RAMP_MIN_INTERVAL_MS } from '@/constants/game'
import { GameState, GridCell, PlayerEffects, PlayerState } from '@/types'
import { applyActivation, applyTurnIntent, buildOccupiedSet, buildPortalLookup, buildTunnelCellSet, buildTunnelOccupiedSet, computeTickIntervalMs, createInitialGameState, startPlaying, tickGame } from '@/utils/gameEngine'

// Fills in the fields every fixture needs regardless of what it's actually testing, so each call
// site only has to spell out what's relevant to it.
function ps(overrides: Partial<PlayerState> & Pick<PlayerState, 'trail' | 'direction'>): PlayerState {
  return { pendingDirection: null, alive: true, color: '#000', heldPowerup: null, effects: { speed: null, control: null, shield: null }, crashCell: null, ...overrides }
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
    pickups: [],
    obstacles: [],
    portals: [],
    tunnels: []
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

  it("defaults to no obstacles when arenaVariant is omitted, matching the 'open' variant explicitly", () => {
    const omitted = createInitialGameState(200, 200, 'faceToFace', { 1: '#3B82F6', 2: '#EF4444' }, GRID_CELL_PX.medium, true)
    const open = createInitialGameState(200, 200, 'faceToFace', { 1: '#3B82F6', 2: '#EF4444' }, GRID_CELL_PX.medium, true, 'open')
    expect(omitted.obstacles).toEqual([])
    expect(open.obstacles).toEqual([])
  })

  it("populates obstacles for 'pillars'/'gauntlet' on a board large enough to clear the arena minimums, never on either player's own starting head cell", () => {
    for (const arenaVariant of ['pillars', 'gauntlet'] as const) {
      const state = createInitialGameState(390, 844, 'faceToFace', { 1: '#3B82F6', 2: '#EF4444' }, GRID_CELL_PX.small, true, arenaVariant)
      expect(state.obstacles.length).toBeGreaterThan(0)
      const p1Head = state.players[1].trail[0]
      const p2Head = state.players[2].trail[0]
      for (const cell of state.obstacles) {
        expect(cell).not.toEqual(p1Head)
        expect(cell).not.toEqual(p2Head)
      }
    }
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

  it('sets crashCell to the off-grid destination on an out-of-bounds crash, even though trail itself is not extended there', () => {
    const state = makeState({
      players: {
        1: ps({ trail: [{ x: 0, y: 5 }], direction: 'left', color: '#3B82F6' }),
        2: ps({ trail: [{ x: 7, y: 5 }], direction: 'left', color: '#EF4444' })
      }
    })
    const next = tickGame(state)
    expect(next.players[1].crashCell).toEqual({ x: -1, y: 5 })
    expect(next.players[1].trail).toEqual([{ x: 0, y: 5 }])
    expect(next.players[2].crashCell).toBeNull()
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

  it('sets crashCell to the same collision cell trail is extended to on an in-bounds crash', () => {
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
    expect(next.players[1].crashCell).toEqual({ x: 5, y: 5 })
    expect(next.players[1].trail.at(-1)).toEqual({ x: 5, y: 5 })
    expect(next.players[2].crashCell).toBeNull()
  })

  it('crashes a player who drives into a static arena obstacle, the same collision shape as driving into a trail', () => {
    const state = makeState({
      players: {
        1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6' }),
        2: ps({ trail: [{ x: 7, y: 0 }], direction: 'left', color: '#EF4444' })
      },
      obstacles: [{ x: 3, y: 5 }]
    })
    // Explicit occupied, built the same way the app itself would (see gameEngine.ts's own
    // buildOccupiedSet), to isolate this from the default-parameter case tested right below.
    const next = tickGame(state, buildOccupiedSet(state.players, state.obstacles))
    expect(next.phase).toBe('roundOver')
    expect(next.outcome).toEqual({ type: 'win', winner: 2 })
    expect(next.players[1].alive).toBe(false)
    expect(next.players[2].alive).toBe(true)
  })

  it("crashes a player who drives into a static arena obstacle via tickGame's OWN default occupied parameter (no explicit occupied argument), proving the default reads state.obstacles", () => {
    const state = makeState({
      players: {
        1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6' }),
        2: ps({ trail: [{ x: 7, y: 0 }], direction: 'left', color: '#EF4444' })
      },
      obstacles: [{ x: 3, y: 5 }]
    })
    const next = tickGame(state)
    expect(next.phase).toBe('roundOver')
    expect(next.outcome).toEqual({ type: 'win', winner: 2 })
    expect(next.players[1].alive).toBe(false)
    expect(next.players[2].alive).toBe(true)
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

  it('increments tick every advancing call, defaulting trailSpeedRate to 1 (never trims)', () => {
    let state = makeParallelState()
    for (let i = 1; i <= 4; i++) {
      state = tickGame(state)
      expect(state.tick).toBe(i)
      expect(state.players[1].trail).toHaveLength(i + 1)
    }
  })

  it('trims the trail tail on ticks needed to hold a sub-1 trailSpeedRate, keeping length below tick count', () => {
    let state = makeParallelState()
    for (let i = 0; i < 8; i++) {
      state = tickGame(state, undefined, 0.5)
    }
    // 8 ticks at a 0.5 growth rate nominally trims on ticks 2, 4, 6, 8 — but the first two land
    // while the trail is still at/under MIN_TRAIL_LENGTH_BEFORE_TRIM (5) and get skipped (see the
    // grace-period test below), so only 2 of the 4 nominally-due trims actually apply: net length =
    // 1 (start) + 8 (appends) - 2 (trims actually applied) = 7.
    expect(state.players[1].trail).toHaveLength(7)
    expect(state.players[2].trail).toHaveLength(7)
  })

  it('never trims below MIN_TRAIL_LENGTH_BEFORE_TRIM, regardless of how low trailSpeedRate is', () => {
    let state = makeParallelState()
    // A rate this low would nominally trim on almost every tick — the trail should still just grow
    // like the untrimmed default (one cell per tick, no trims at all) until it clears the minimum.
    for (let i = 0; i < MIN_TRAIL_LENGTH_BEFORE_TRIM - 1; i++) {
      state = tickGame(state, undefined, 0.1)
      expect(state.players[1].trail).toHaveLength(i + 2)
    }
  })

  it('never trims on the tick a player crashes, even under a sub-1 trailSpeedRate', () => {
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

    it('Stasis fully skips movement for a tick, and leaves the queued direction pending (not yet resolved)', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', pendingDirection: 'up', color: '#3B82F6', effects: { speed: { type: 'stasis', multiplier: 0, expiresAtTick: 100 }, control: null, shield: null } }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        }
      })
      const next = tickGame(state)
      expect(next.players[1].trail).toEqual([{ x: 2, y: 5 }])
      // `direction` stays pinned to the pre-freeze value — the player hasn't actually moved 'up'
      // yet, so nothing has invalidated 'right' as the reference for the next opposite-turn check.
      expect(next.players[1].direction).toBe('right')
      expect(next.players[1].pendingDirection).toBe('up')
    })

    it('resolves the queued direction into `direction` on the tick a frozen player actually unfreezes and steps', () => {
      // expiresAtTick 1 means the Stasis effect is still the active speed effect for computing this
      // very tick's step count (0 steps, tick 0 -> 1) — it only actually clears via `expire()` at
      // the end of that same tick, so the player only starts moving normally on the tick after.
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', pendingDirection: 'up', color: '#3B82F6', effects: { speed: { type: 'stasis', multiplier: 0, expiresAtTick: 1 }, control: null, shield: null } }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        }
      })
      const frozenTick = tickGame(state)
      expect(frozenTick.players[1].trail).toEqual([{ x: 2, y: 5 }])
      expect(frozenTick.players[1].direction).toBe('right')
      expect(frozenTick.players[1].pendingDirection).toBe('up')
      expect(frozenTick.players[1].effects.speed).toBeNull()

      const next = tickGame(frozenTick)
      expect(next.players[1].trail).toEqual([
        { x: 2, y: 5 },
        { x: 2, y: 4 }
      ])
      expect(next.players[1].direction).toBe('up')
      expect(next.players[1].pendingDirection).toBeNull()
    })

    // Regression test for a reported bug: travelling left, frozen by Stasis, swipe up then swipe
    // right (each individually legal against the direction at the moment of the swipe) used to
    // compound into a full 180° once both swipes had each been resolved into `direction` on their
    // own frozen tick — so the player came out of Stasis still trailed to their right and
    // immediately died stepping back into their own trail. The second turn intent must be rejected
    // as an opposite-direction reversal instead, exactly as it would be if the player were never
    // frozen at all.
    it('never lets two turns queued across separate frozen ticks compound into an unnoticed 180°', () => {
      let state = makeState({
        players: {
          1: ps({
            trail: [
              { x: 4, y: 5 },
              { x: 3, y: 5 },
              { x: 2, y: 5 }
            ],
            direction: 'left',
            color: '#3B82F6',
            effects: { speed: { type: 'stasis', multiplier: 0, expiresAtTick: 100 }, control: null, shield: null }
          }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        }
      })

      // First swipe while frozen: 'up' is legal (not opposite of 'left').
      state = applyTurnIntent(state, 1, 'up')
      expect(state.players[1].pendingDirection).toBe('up')

      // A frozen tick passes — still no movement, and (with the fix) `direction` stays 'left'.
      state = tickGame(state)
      expect(state.players[1].direction).toBe('left')
      expect(state.players[1].pendingDirection).toBe('up')

      // Second swipe while still frozen: 'right' IS opposite of the player's real direction
      // ('left'), so it must be rejected — the earlier 'up' stays queued.
      state = applyTurnIntent(state, 1, 'right')
      expect(state.players[1].pendingDirection).toBe('up')
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

    it('wins a head-on outright when only one side is shielded, consuming that shield', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 4, y: 5 }], direction: 'right', color: '#3B82F6', effects: { speed: null, control: null, shield: { expiresAtTick: 100 } } }),
          2: ps({ trail: [{ x: 6, y: 5 }], direction: 'left', color: '#EF4444' })
        }
      })
      const next = tickGame(state)
      expect(next.outcome).toEqual({ type: 'win', winner: 1 })
      expect(next.players[1].alive).toBe(true)
      expect(next.players[1].effects.shield).toBeNull()
      expect(next.players[2].alive).toBe(false)
    })

    it('still calls a head-on a draw when both sides are shielded', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 4, y: 5 }], direction: 'right', color: '#3B82F6', effects: { speed: null, control: null, shield: { expiresAtTick: 100 } } }),
          2: ps({ trail: [{ x: 6, y: 5 }], direction: 'left', color: '#EF4444', effects: { speed: null, control: null, shield: { expiresAtTick: 100 } } })
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

      it('never spawns somewhere its own collection radius would overlap a trail, even on an otherwise-empty cell (edges are fine)', () => {
        // A 3-cell wall down the middle of a small grid. Both players are frozen (Stasis'd) and
        // contribute nothing to `occupied` themselves — it's passed in explicitly here, as exactly
        // this wall — so there's no interference from anyone's own move this tick. (1,*) and (3,*)
        // are individually empty but sit right beside the wall (within collection radius of it);
        // only the (0,*) column, a full cell away, has a genuinely clear collection footprint.
        const frozen: PlayerEffects = { speed: { type: 'stasis', multiplier: 0, expiresAtTick: 100 }, control: null, shield: null }
        const state = makeState({
          grid: { cols: 4, rows: 3 },
          pickups: [],
          players: {
            1: ps({ trail: [{ x: 0, y: 0 }], direction: 'right', effects: frozen }),
            2: ps({ trail: [{ x: 3, y: 2 }], direction: 'left', effects: frozen })
          }
        })
        const occupied = new Set(['2,0', '2,1', '2,2'])

        for (const random of [() => 0, () => 0.5, () => 0.99]) {
          const next = tickGame(state, occupied, 1, POWERUP_ALL_TYPES, random)
          expect(next.pickups).toHaveLength(1)
          expect(next.pickups[0].cell.x).toBe(0)
        }
      })

      it('never spawns a pickup directly on a portal cell, even when it would otherwise be the only clear candidate', () => {
        // A 12-cell strip: player 1's 5-cell trail and player 2's single cell leave exactly two
        // trail-clear gaps free of any collection-radius overlap — the two portal cells themselves
        // (x=0 and x=8) — so without the portal exclusion, one of THOSE is exactly where this would
        // spawn. Both frozen (Stasis) so `occupied` stays exactly this fixed layout all tick.
        const frozen: PlayerEffects = { speed: { type: 'stasis', multiplier: 0, expiresAtTick: 100 }, control: null, shield: null }
        const state = makeState({
          grid: { cols: 12, rows: 1 },
          pickups: [],
          players: {
            1: ps({
              trail: [
                { x: 2, y: 0 },
                { x: 3, y: 0 },
                { x: 4, y: 0 },
                { x: 5, y: 0 },
                { x: 6, y: 0 }
              ],
              direction: 'right',
              effects: frozen
            }),
            2: ps({ trail: [{ x: 10, y: 0 }], direction: 'right', effects: frozen })
          },
          portals: [{ a: { x: 0, y: 0 }, b: { x: 8, y: 0 } }]
        })
        const next = tickGame(state, undefined, 1, POWERUP_ALL_TYPES, () => 0)
        expect(next.pickups).toEqual([])
      })
    })
  })

  describe('wrap edges', () => {
    it('re-enters from the opposite edge instead of crashing when wrapEdges is on', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 9, y: 5 }], direction: 'right', color: '#3B82F6' }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        }
      })
      const next = tickGame(state, undefined, undefined, undefined, undefined, undefined, true)
      expect(next.phase).toBe('playing')
      expect(next.players[1].alive).toBe(true)
      expect(next.players[1].trail).toEqual([
        { x: 9, y: 5 },
        { x: 0, y: 5 }
      ])
    })

    it('wraps off the left/top edges to the opposite edge too', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 0, y: 5 }], direction: 'left', color: '#3B82F6' }),
          2: ps({ trail: [{ x: 5, y: 9 }], direction: 'down', color: '#EF4444' })
        }
      })
      const next = tickGame(state, undefined, undefined, undefined, undefined, undefined, true)
      expect(next.phase).toBe('playing')
      expect(next.players[1].trail.at(-1)).toEqual({ x: 9, y: 5 })
      expect(next.players[2].trail.at(-1)).toEqual({ x: 5, y: 0 })
    })

    it('still crashes into whatever occupies the wrapped-onto cell, same as any other blocked move', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 9, y: 5 }], direction: 'right', color: '#3B82F6' }),
          2: ps({
            trail: [
              { x: 1, y: 5 },
              { x: 0, y: 5 }
            ],
            direction: 'up',
            color: '#EF4444'
          })
        }
      })
      const next = tickGame(state, undefined, undefined, undefined, undefined, undefined, true)
      expect(next.outcome).toEqual({ type: 'win', winner: 2 })
      expect(next.players[1].alive).toBe(false)
    })

    it('chains into a portal when the wrapped-onto cell happens to be a portal entrance', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 9, y: 5 }], direction: 'right', color: '#3B82F6' }),
          2: ps({ trail: [{ x: 5, y: 0 }], direction: 'right', color: '#EF4444' })
        },
        portals: [{ a: { x: 0, y: 5 }, b: { x: 5, y: 8 } }]
      })
      const next = tickGame(state, undefined, undefined, undefined, undefined, undefined, true)
      expect(next.phase).toBe('playing')
      expect(next.players[1].trail).toEqual([
        { x: 9, y: 5 },
        { x: 5, y: 8 }
      ])
    })
  })

  describe('portals', () => {
    const PORTAL_A = { x: 3, y: 5 }
    const PORTAL_B = { x: 8, y: 2 }
    const PORTALS = [{ a: PORTAL_A, b: PORTAL_B }]

    it("redirects a step onto a portal cell to its paired exit, continuing in the player's own direction — the entrance itself never appears in the trail", () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6' }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        },
        portals: PORTALS
      })
      const next = tickGame(state)
      expect(next.phase).toBe('playing')
      expect(next.players[1].trail).toEqual([{ x: 2, y: 5 }, PORTAL_B])
    })

    it('crashes into an already-occupied exit cell, exactly like driving into any other blocked cell', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6' }),
          2: ps({ trail: [PORTAL_B, { x: 7, y: 2 }], direction: 'left', color: '#EF4444' })
        },
        portals: PORTALS
      })
      const next = tickGame(state)
      expect(next.outcome).toEqual({ type: 'win', winner: 2 })
      expect(next.players[1].alive).toBe(false)
    })

    it('calls it an ordinary head-on when both players step onto the same portal entrance in the same sub-step', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6' }), // steps onto PORTAL_A from the west
          2: ps({ trail: [{ x: 3, y: 6 }], direction: 'up', color: '#EF4444' }) // steps onto PORTAL_A from the south
        },
        portals: PORTALS
      })
      const next = tickGame(state)
      expect(next.outcome).toEqual({ type: 'draw' })
      expect(next.players[1].alive).toBe(false)
      expect(next.players[2].alive).toBe(false)
    })

    it('lets two players simultaneously enter opposite ends of the same portal without a head-on — they swap sides, not collide', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6' }), // -> PORTAL_A -> redirected to PORTAL_B
          2: ps({ trail: [{ x: 8, y: 1 }], direction: 'down', color: '#EF4444' }) // -> PORTAL_B -> redirected to PORTAL_A
        },
        portals: PORTALS
      })
      const next = tickGame(state)
      expect(next.phase).toBe('playing')
      expect(next.players[1].alive).toBe(true)
      expect(next.players[2].alive).toBe(true)
      expect(next.players[1].trail.at(-1)).toEqual(PORTAL_B)
      expect(next.players[2].trail.at(-1)).toEqual(PORTAL_A)
    })

    it('a shielded player breaks through a trail sitting on the exit cell, same as breaking through any other wall', () => {
      // Same shape as the plain (non-portal) Shield test above: the break point is deliberately
      // player 2's own CURRENT head (their trail's last/newest cell), so trimTrailAtCell's clamp
      // (never remove the head itself) keeps exactly that one cell, onto which player 2's own
      // unrelated 'right' step this tick then appends normally.
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6', effects: { speed: null, control: null, shield: { expiresAtTick: 100 } } }),
          2: ps({
            trail: [{ x: 6, y: 2 }, { x: 7, y: 2 }, PORTAL_B],
            direction: 'right',
            color: '#EF4444'
          })
        },
        portals: PORTALS
      })
      const next = tickGame(state)
      expect(next.phase).toBe('playing')
      expect(next.players[1].alive).toBe(true)
      expect(next.players[1].effects.shield).toBeNull()
      expect(next.players[1].trail).toEqual([{ x: 2, y: 5 }, PORTAL_B])
      expect(next.players[2].trail).toEqual([PORTAL_B, { x: 9, y: 2 }])
    })

    it('continues correctly on the second sub-step of a boosted player after a first-sub-step portal crossing', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6', effects: { speed: { type: 'overdrive', multiplier: 2, expiresAtTick: 100 }, control: null, shield: null } }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        },
        portals: PORTALS
      })
      const next = tickGame(state)
      expect(next.phase).toBe('playing')
      expect(next.players[1].trail).toEqual([{ x: 2, y: 5 }, PORTAL_B, { x: 9, y: 2 }])
    })
  })

  describe('tunnels', () => {
    // A 4-cell horizontal corridor along row y=5 — see arenas.ts's buildTunnel for the real
    // generator; this fixture is hand-placed so the tests below can target specific interior/mouth
    // cells precisely.
    const TUNNEL = {
      cells: [
        { x: 3, y: 5 },
        { x: 4, y: 5 },
        { x: 5, y: 5 },
        { x: 6, y: 5 }
      ]
    }
    const TUNNELS = [TUNNEL]

    it('traverses the corridor cell-by-cell like any open ground — entering it is never itself a crash', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6' }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        },
        tunnels: TUNNELS
      })
      const next = tickGame(state)
      expect(next.phase).toBe('playing')
      expect(next.players[1].trail).toEqual([
        { x: 2, y: 5 },
        { x: 3, y: 5 }
      ])
    })

    it('a freshly-derived buildOccupiedSet excludes a just-entered tunnel cell, while buildTunnelOccupiedSet includes it', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6' }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        },
        tunnels: TUNNELS
      })
      const next = tickGame(state)
      const tunnelCellSet = buildTunnelCellSet(next.tunnels)
      expect(buildOccupiedSet(next.players, next.obstacles, tunnelCellSet).has('3,5')).toBe(false)
      expect(buildTunnelOccupiedSet(next.players, tunnelCellSet).has('3,5')).toBe(true)
    })

    it('crashes into a tunnel cell already occupied by another tunnel-traveler, same as any other blocked cell', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6' }),
          2: ps({ trail: [{ x: 3, y: 5 }], direction: 'up', color: '#EF4444' })
        },
        tunnels: TUNNELS
      })
      const next = tickGame(state)
      expect(next.outcome).toEqual({ type: 'win', winner: 2 })
      expect(next.players[1].alive).toBe(false)
    })

    it('never crashes into its own earlier tunnel trail — looping back through a cell you yourself already crossed underground stays safe, unlike an opponent occupying that same cell', () => {
      const state = makeState({
        players: {
          // Already looped through the tunnel mouth (3,5) once (oldest trail cell), then up and
          // around back to (3,6) — now turning 'up' to re-enter (3,5) a second time, from a
          // different direction than the first pass. A player's own underground trail should never
          // trap them the way the previous test's opponent trail does (see types/index.ts's own
          // Tunnel comment on the corridor's whole promise).
          1: ps({
            trail: [
              { x: 3, y: 5 },
              { x: 3, y: 4 },
              { x: 2, y: 4 },
              { x: 2, y: 5 },
              { x: 2, y: 6 },
              { x: 3, y: 6 }
            ],
            direction: 'up',
            color: '#3B82F6'
          }),
          2: ps({ trail: [{ x: 0, y: 0 }], direction: 'down', color: '#EF4444' })
        },
        tunnels: TUNNELS
      })
      const next = tickGame(state)
      expect(next.phase).toBe('playing')
      expect(next.players[1].alive).toBe(true)
      expect(next.players[1].trail.at(-1)).toEqual({ x: 3, y: 5 })
    })

    it('checks side (perpendicular) entry into an interior tunnel cell against the SAME underground occupancy — not exempt just because the approach angle is unusual', () => {
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 4, y: 4 }], direction: 'down', color: '#3B82F6' }), // approaches the tunnel from directly above, not through a mouth
          2: ps({ trail: [{ x: 4, y: 5 }], direction: 'left', color: '#EF4444' })
        },
        tunnels: TUNNELS
      })
      const next = tickGame(state)
      expect(next.outcome).toEqual({ type: 'win', winner: 2 })
      expect(next.players[1].alive).toBe(false)
    })

    it('resurfaces immediately on a mid-tunnel turn — the very next step off tunnel geometry is checked against ordinary SURFACE occupancy', () => {
      const state = makeState({
        players: {
          // Already one step into the corridor (head at (4,5)); turns 'up' this tick, off tunnel
          // geometry entirely, onto (4,4) — a plain surface cell player 2's own trail already
          // occupies. A buggy implementation that kept checking tunnel occupancy after leaving the
          // corridor would miss this collision entirely (tunnelOccupied never contains (4,4)).
          1: ps({
            trail: [
              { x: 3, y: 5 },
              { x: 4, y: 5 }
            ],
            direction: 'right',
            pendingDirection: 'up',
            color: '#3B82F6'
          }),
          2: ps({ trail: [{ x: 4, y: 4 }], direction: 'left', color: '#EF4444' })
        },
        tunnels: TUNNELS
      })
      const next = tickGame(state)
      expect(next.outcome).toEqual({ type: 'win', winner: 2 })
      expect(next.players[1].alive).toBe(false)
    })

    it('a shielded player breaks through a tunnel-traveler occupying the entrance, same shape as any other wall break', () => {
      // Mirrors the portal Shield test above: the break point is deliberately player 2's own
      // CURRENT head (their trail's last/newest cell), so trimTrailAtCell's clamp keeps exactly
      // that one cell, onto which player 2's own unrelated 'up' step this tick then appends.
      const state = makeState({
        players: {
          1: ps({ trail: [{ x: 2, y: 5 }], direction: 'right', color: '#3B82F6', effects: { speed: null, control: null, shield: { expiresAtTick: 100 } } }),
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
        },
        tunnels: TUNNELS
      })
      const next = tickGame(state)
      expect(next.phase).toBe('playing')
      expect(next.players[1].alive).toBe(true)
      expect(next.players[1].effects.shield).toBeNull()
      expect(next.players[1].trail).toEqual([
        { x: 2, y: 5 },
        { x: 3, y: 5 }
      ])
      expect(next.players[2].trail).toEqual([
        { x: 3, y: 5 },
        { x: 3, y: 4 }
      ])
    })
  })
})

describe('buildPortalLookup', () => {
  it('maps each portal cell to its paired partner, symmetrically', () => {
    const lookup = buildPortalLookup([{ a: { x: 3, y: 5 }, b: { x: 8, y: 2 } }])
    expect(lookup.size).toBe(2)
    expect(lookup.get('3,5')).toEqual({ x: 8, y: 2 })
    expect(lookup.get('8,2')).toEqual({ x: 3, y: 5 })
  })

  it('is empty with no portals', () => {
    expect(buildPortalLookup([]).size).toBe(0)
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

  it('Stasis sets a speed effect with a 0 multiplier on the OPPONENT, not the activator', () => {
    const state = activationState('stasis')
    const next = applyActivation(state, 1)
    expect(next.players[1].effects.speed).toBeNull()
    expect(next.players[2].effects.speed?.multiplier).toBe(0)
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

  it("Prune trims the OPPONENT's trail proportionally to its own length, leaving the activator's own trail untouched", () => {
    const state = activationState('prune', { players: { 1: { ...activationState('prune').players[1], heldPowerup: 'prune' }, 2: { ...activationState('prune').players[2], heldPowerup: 'overdrive' } } })
    const next = applyActivation(state, 1)
    expect(next.players[1].trail).toHaveLength(20)
    expect(next.players[2].trail).toHaveLength(20 - Math.floor(20 * POWERUP_PRUNE_FRACTION))
    expect(next.players[1].heldPowerup).toBeNull()
    expect(next.players[2].heldPowerup).toBe('overdrive')
  })

  it('a same-axis activation replaces (does not stack with) an existing effect on the target, with a fresh timer', () => {
    // Player 2 is already under a long-lived Overclock (as if just hit earlier), and player 1 now
    // lands a Stasis on them — both are opponent-targeted speed effects, so the fresh one wins.
    const state = activationState('stasis', {
      tick: 20,
      players: {
        1: { ...activationState('stasis').players[1] },
        2: { ...activationState('stasis').players[2], effects: { speed: { type: 'overclock', multiplier: 2, expiresAtTick: 200 }, control: null, shield: null } }
      }
    })
    const next = applyActivation(state, 1)
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

describe('buildOccupiedSet', () => {
  it('includes both players trails plus every obstacle cell', () => {
    const state = makeState({
      obstacles: [
        { x: 0, y: 0 },
        { x: 9, y: 9 }
      ]
    })
    const occupied = buildOccupiedSet(state.players, state.obstacles)
    expect(occupied.has('0,0')).toBe(true)
    expect(occupied.has('9,9')).toBe(true)
    expect(occupied.has('2,5')).toBe(true) // player 1's head
    expect(occupied.has('7,5')).toBe(true) // player 2's head
  })

  it('defaults obstacles to none, matching every pre-existing call site that only ever passed players', () => {
    const state = makeState()
    const occupied = buildOccupiedSet(state.players)
    expect(occupied).toEqual(new Set(['2,5', '7,5']))
  })

  it('excludes a trail cell that is itself a tunnel member, even though it is still part of the trail array', () => {
    const state = makeState({
      players: {
        1: ps({
          trail: [
            { x: 2, y: 5 },
            { x: 3, y: 5 }
          ],
          direction: 'right',
          color: '#3B82F6'
        }),
        2: ps({ trail: [{ x: 7, y: 5 }], direction: 'left', color: '#EF4444' })
      }
    })
    const tunnelCellSet = new Set(['3,5'])
    const occupied = buildOccupiedSet(state.players, state.obstacles, tunnelCellSet)
    expect(occupied.has('2,5')).toBe(true)
    expect(occupied.has('3,5')).toBe(false)
    expect(occupied.has('7,5')).toBe(true)
  })
})

describe('buildTunnelCellSet', () => {
  it('flattens every cell across every tunnel into one membership set', () => {
    const cellSet = buildTunnelCellSet([
      {
        cells: [
          { x: 3, y: 5 },
          { x: 4, y: 5 }
        ]
      }
    ])
    expect(cellSet).toEqual(new Set(['3,5', '4,5']))
  })

  it('is empty with no tunnels', () => {
    expect(buildTunnelCellSet([]).size).toBe(0)
  })
})

describe('buildTunnelOccupiedSet', () => {
  it('includes only the trail cells that are tunnel members — the exact complement of buildOccupiedSet’s own exclusion', () => {
    const players = {
      1: ps({
        trail: [
          { x: 2, y: 5 },
          { x: 3, y: 5 }
        ],
        direction: 'right',
        color: '#3B82F6'
      }),
      2: ps({ trail: [{ x: 7, y: 5 }], direction: 'left', color: '#EF4444' })
    }
    const tunnelCellSet = new Set(['3,5'])
    const tunnelOccupied = buildTunnelOccupiedSet(players, tunnelCellSet)
    expect(tunnelOccupied).toEqual(new Set(['3,5']))
  })

  it('is empty when no trail cell is a tunnel member', () => {
    const state = makeState()
    expect(buildTunnelOccupiedSet(state.players, new Set()).size).toBe(0)
  })
})
