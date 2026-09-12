import { POWERUP_CPU_OFFENSIVE_SPACE_THRESHOLD, POWERUP_CPU_OVERDRIVE_MIN_SPACE } from '@/constants/game'
import { GameState, PlayerState } from '@/types'
import { applyCpuActivation, applyCpuTurn, chooseCpuDirection, shouldCpuActivate } from '@/utils/cpuAi'

function ps(overrides: Partial<PlayerState> & Pick<PlayerState, 'trail' | 'direction'>): PlayerState {
  return { pendingDirection: null, alive: true, color: '#000', heldPowerup: null, effects: { speed: null, control: null, shield: null }, crashCell: null, ...overrides }
}

describe('chooseCpuDirection', () => {
  it('avoids a dead end and picks the direction with strictly more open space', () => {
    // 1-row strip: 'up' is immediately out of bounds, 'left' dead-ends after one cell, 'right'
    // opens onto 4 free cells — an unambiguous, hand-countable comparison.
    const grid = { cols: 8, rows: 1 }
    const player = ps({ trail: [{ x: 3, y: 0 }], direction: 'up' })
    const occupied = new Set(['3,0', '1,0'])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard' })).toBe('right')
  })

  it('prefers continuing straight over an equally-good turn', () => {
    // 5x5 grid; 'left' is a sealed 1-cell pocket, 'up' and 'right' both open onto the same large
    // connected region (tied). Heading 'up' already, so the tie should resolve to 'up'.
    const grid = { cols: 5, rows: 5 }
    const player = ps({ trail: [{ x: 2, y: 2 }], direction: 'up' })
    const occupied = new Set(['2,2', '0,2', '1,1', '1,3'])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard' })).toBe('up')
  })

  it('returns the only safe option when the rest are fatal', () => {
    const grid = { cols: 3, rows: 1 }
    const player = ps({ trail: [{ x: 1, y: 0 }], direction: 'up' })
    const occupied = new Set(['1,0', '2,0'])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard' })).toBe('left')
  })

  it('never returns a 180° reversal of the current heading', () => {
    const grid = { cols: 8, rows: 1 }
    const player = ps({ trail: [{ x: 3, y: 0 }], direction: 'right' })
    const occupied = new Set(['3,0'])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard' })).not.toBe('left')
  })

  it('treats a direction that only crashes on its SECOND step (ownSteps=2) as unsafe', () => {
    // 8x5 grid, heading 'down' (so 'up' is the filtered-out 180°): 'left' and 'down' both dead-end
    // into 1-cell pockets, while 'right' opens onto the rest of the mostly-empty board — going
    // around the single obstacle at (4,2) costs nothing when only stepping there once, but is a
    // direct hit when actually forced to step onto it.
    const grid = { cols: 8, rows: 5 }
    const player = ps({ trail: [{ x: 2, y: 2 }], direction: 'down' })
    const occupied = new Set(['2,2', '0,2', '1,1', '1,3', '2,4', '3,3', '4,2'])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard', ownSteps: 1 })).toBe('right')
    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard', ownSteps: 2 })).not.toBe('right')
  })

  describe('normal difficulty', () => {
    const grid = { cols: 8, rows: 1 }
    const player = ps({ trail: [{ x: 3, y: 0 }], direction: 'up' })
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
    const player = ps({ trail: [{ x: 3, y: 0 }], direction: 'up' })
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

    it('never seeks pickups — easy has seekPickups disabled', () => {
      // 'up'/'down' tie for the largest open region; a pickup sits only reachable via 'down'.
      // Easy should ignore it entirely and fall back to the straight-continuation tiebreak.
      const grid5 = { cols: 5, rows: 5 }
      const p = ps({ trail: [{ x: 2, y: 2 }], direction: 'up' })
      const occ = new Set(['2,2'])
      const pickups = [{ id: 'pu-1', type: 'overdrive' as const, cell: { x: 2, y: 4 } }]
      expect(chooseCpuDirection({ player: p, grid: grid5, occupied: occ, difficulty: 'easy', random: () => 0.99, pickups })).toBe('up')
    })
  })

  it('breaks a tie toward a reachable pickup when the difficulty is powerup-aware', () => {
    // 5x5 grid, heading 'up' from center ('down' is the filtered-out 180°): 'up'/'left'/'right' all
    // tie for the same, nearly-whole-board open space, since a single center obstacle doesn't
    // disconnect anything here — a pickup two cells to the right (a direct 1-step hop from
    // 'right's own landing cell, vs. a multi-step detour around the center from 'up'/'left') should
    // break the tie toward 'right'.
    const grid = { cols: 5, rows: 5 }
    const player = ps({ trail: [{ x: 2, y: 2 }], direction: 'up' })
    const occupied = new Set(['2,2'])
    const pickups = [{ id: 'pu-1', type: 'overdrive' as const, cell: { x: 4, y: 2 } }]

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard', pickups })).toBe('right')
  })

  it('never seeks a pickup while already holding one', () => {
    const grid = { cols: 5, rows: 5 }
    const player = ps({ trail: [{ x: 2, y: 2 }], direction: 'up' })
    const occupied = new Set(['2,2'])
    const pickups = [{ id: 'pu-1', type: 'overdrive' as const, cell: { x: 2, y: 4 } }]

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard', pickups, heldPowerup: 'shield' })).toBe('up')
  })

  it('correctly scores a portal shortcut instead of misjudging it as ordinary open space', () => {
    // Without portal awareness, 'left' looks like a 1-cell dead end (same shape as the very first
    // test above) and 'right' a slightly-better 3-cell pocket, so 'right' wins. A portal actually
    // linking 'left's landing cell to a huge open region far down the strip flips that: with it,
    // 'left' is really the much safer choice — this is the exact blind spot that gets a portal-
    // unaware CPU killed by a hazard it can't see, not just a suboptimal pick.
    const grid = { cols: 60, rows: 1 }
    const player = ps({ trail: [{ x: 3, y: 0 }], direction: 'up' })
    const occupied = new Set(['3,0', '1,0', '7,0'])
    const portals = new Map([
      ['2,0', { x: 50, y: 0 }],
      ['50,0', { x: 2, y: 0 }]
    ])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard' })).toBe('right')
    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard', portals })).toBe('left')
  })

  it('correctly avoids a tunnel-occupied hazard invisible to the surface occupied set, instead of misjudging it as open ground', () => {
    // 'left's very landing cell (29,0) is a tunnel member with a live tunnel-traveler on it — a
    // hazard the plain `occupied` set (which only has the player's own cell and a wall 4 cells to
    // the right) has zero visibility into. Without tunnel awareness that cell reads as ordinary open
    // ground, and the wide-open strip beyond it (30 cells) dwarfs 'right's cramped 3-cell pocket, so
    // 'left' wins. With it, 'left' is correctly seen as an immediate crash and 'right' — the only
    // real survivor — wins instead. This is the exact blind spot that gets a tunnel-unaware CPU
    // killed by a hazard it can't see, not just a suboptimal pick.
    const grid = { cols: 60, rows: 1 }
    const player = ps({ trail: [{ x: 30, y: 0 }], direction: 'up' })
    const occupied = new Set(['30,0', '34,0'])
    const tunnelCellSet = new Set(['29,0'])
    const tunnelOccupied = new Set(['29,0'])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard' })).toBe('left')
    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard', tunnelCellSet, tunnelOccupied })).toBe('right')
  })

  it("treats the grid edge as connecting to the opposite side once wrapEdges is on for 'hard', instead of misjudging it as a wall", () => {
    // Mirrors the portal-shortcut test above: without wrap, 'right' opens onto a small 2-cell
    // pocket (bounded by the CPU's own head on one side and a wall at x=4 on the other) while
    // 'left' dead-ends immediately off the west edge — so 'right' wins. Once wrap is on, 'left's
    // landing cell (0,0) actually re-enters from the east edge (x=59) and floods across virtually
    // the entire rest of the strip, flipping the winner.
    const grid = { cols: 60, rows: 1 }
    const player = ps({ trail: [{ x: 1, y: 0 }], direction: 'up' })
    const occupied = new Set(['1,0', '4,0'])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard' })).toBe('right')
    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'hard', wrapEdges: true })).toBe('left')
  })

  it("keeps treating the edge as a wall below 'hard', even when wrapEdges is on — wrap-awareness is gated to hard only", () => {
    const grid = { cols: 60, rows: 1 }
    const player = ps({ trail: [{ x: 1, y: 0 }], direction: 'up' })
    const occupied = new Set(['1,0', '4,0'])

    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'normal', random: () => 0.99, wrapEdges: true })).toBe('right')
    expect(chooseCpuDirection({ player, grid, occupied, difficulty: 'easy', random: () => 0.99, wrapEdges: true })).toBe('right')
  })
})

describe('applyCpuTurn', () => {
  function baseState(): GameState {
    return {
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
      tunnels: [],
      unsafeCells: []
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

  it("steers around a static arena obstacle via applyCpuTurn's OWN default occupied parameter (no explicit occupied argument), exactly as it would steer around an equivalent trail cell", () => {
    // Same 1-row-strip shape as chooseCpuDirection's very first test above (grid 8x1, CPU at
    // x=3 heading 'up' — immediately out of bounds on a 1-row grid, so only 'left'/'right' are
    // real candidates): there, an obstacle-shaped block was passed directly as `occupied`. Here
    // it's a real GameState.obstacles cell instead, and applyCpuTurn is called with NO explicit
    // occupied argument at all — proving its own default (buildOccupiedSet(state.players,
    // state.obstacles)) is what reads the obstacle, not a synthetic occupied set built by the test.
    const state: GameState = {
      phase: 'playing',
      grid: { cols: 8, rows: 1 },
      players: {
        1: ps({ trail: [{ x: 0, y: 0 }], direction: 'right', color: '#3B82F6' }),
        2: ps({ trail: [{ x: 3, y: 0 }], direction: 'up', color: '#EF4444' })
      },
      outcome: null,
      tick: 0,
      pickups: [],
      obstacles: [{ x: 1, y: 0 }],
      portals: [],
      tunnels: [],
      unsafeCells: []
    }
    const next = applyCpuTurn(state, 'hard')
    expect(next.players[2].pendingDirection).toBe('right')
    expect(next.players[2].pendingDirection).not.toBe('left')
  })

  it("steers toward a portal shortcut via applyCpuTurn's OWN default portals parameter (no explicit portals argument), proving the default reads state.portals", () => {
    // Same shape as chooseCpuDirection's own portal-shortcut test above, as a real GameState with
    // the CPU (player 2) facing the choice — applyCpuTurn is called with no explicit occupied OR
    // portals argument at all, so this proves both defaults (buildOccupiedSet(state.players,
    // state.obstacles) and buildPortalLookup(state.portals)) are what's actually read, not a
    // synthetic set/map built by the test.
    const state: GameState = {
      phase: 'playing',
      grid: { cols: 60, rows: 1 },
      players: {
        1: ps({ trail: [{ x: 59, y: 0 }], direction: 'left', color: '#3B82F6' }),
        2: ps({ trail: [{ x: 3, y: 0 }], direction: 'up', color: '#EF4444' })
      },
      outcome: null,
      tick: 0,
      pickups: [],
      obstacles: [
        { x: 1, y: 0 },
        { x: 7, y: 0 }
      ],
      portals: [{ a: { x: 2, y: 0 }, b: { x: 50, y: 0 } }],
      tunnels: [],
      unsafeCells: []
    }
    const next = applyCpuTurn(state, 'hard')
    expect(next.players[2].pendingDirection).toBe('left')
  })

  it("steers away from a tunnel-occupied hazard via applyCpuTurn's OWN default occupied/tunnelOccupied parameters (no explicit arguments at all), proving both defaults read state.obstacles/state.tunnels/state.players correctly", () => {
    // Player 1's own trail sits AT the tunnel's one cell (29,0) — the real, only way tunnelOccupied
    // is ever populated in actual gameplay (see buildTunnelOccupiedSet). applyCpuTurn is called with
    // no explicit occupied OR tunnelOccupied argument, so this proves the defaults
    // (buildOccupiedSet(..., buildTunnelCellSet(state.tunnels)) and
    // buildTunnelOccupiedSet(state.players, buildTunnelCellSet(state.tunnels))) both correctly read
    // live state rather than a synthetic set built by the test.
    const state: GameState = {
      phase: 'playing',
      grid: { cols: 60, rows: 1 },
      players: {
        1: ps({ trail: [{ x: 29, y: 0 }], direction: 'left', color: '#3B82F6' }),
        2: ps({ trail: [{ x: 30, y: 0 }], direction: 'up', color: '#EF4444' })
      },
      outcome: null,
      tick: 0,
      pickups: [],
      obstacles: [{ x: 34, y: 0 }],
      portals: [],
      tunnels: [{ cells: [{ x: 29, y: 0 }] }],
      unsafeCells: []
    }
    const next = applyCpuTurn(state, 'hard')
    expect(next.players[2].pendingDirection).toBe('right')
  })

  describe('Hack compensation', () => {
    // Same fixture as the very first chooseCpuDirection test in every case below: uninverted, the
    // CPU (as player 2) would choose 'right'.
    function hackedState(): { state: GameState; occupied: Set<string> } {
      const state = baseState()
      state.players[2] = { ...state.players[2], trail: [{ x: 3, y: 0 }], direction: 'up', effects: { speed: null, control: { type: 'hack', expiresAtTick: 100 }, shield: null } }
      return { state: { ...state, grid: { cols: 8, rows: 1 } }, occupied: new Set(['3,0', '1,0']) }
    }

    it('never compensates at easy difficulty — still inverts its own chosen direction', () => {
      const { state, occupied } = hackedState()
      // random() >= CPU_EASY_RANDOM_CHANCE keeps chooseCpuDirection's own easy-tier randomness
      // from picking something other than its score-based best ('right'), so this stays a direct
      // test of the hack-inversion path, not easy's separate weak-play randomness.
      const next = applyCpuTurn(state, 'easy', occupied, () => 0.99)
      expect(next.players[2].pendingDirection).toBe('left')
    })

    it('always compensates at hard difficulty, queuing the true best direction despite being Hacked', () => {
      const { state, occupied } = hackedState()
      const next = applyCpuTurn(state, 'hard', occupied)
      expect(next.players[2].pendingDirection).toBe('right')
    })

    it('at normal difficulty, compensates only when the random roll succeeds', () => {
      const { state, occupied } = hackedState()
      // Both values stay under CPU_NORMAL_SUBOPTIMAL_CHANCE's own roll inside chooseCpuDirection
      // (so it still picks the score-based best, 'right') while landing on opposite sides of
      // CPU_HACK_COMPENSATION_CHANCE.normal's 0.6 threshold for the separate compensation roll.
      const compensates = applyCpuTurn(state, 'normal', occupied, () => 0.3)
      expect(compensates.players[2].pendingDirection).toBe('right')

      const doesNotCompensate = applyCpuTurn(state, 'normal', occupied, () => 0.9)
      expect(doesNotCompensate.players[2].pendingDirection).toBe('left')
    })
  })
})

describe('shouldCpuActivate', () => {
  function baseState(): GameState {
    return {
      phase: 'playing',
      grid: { cols: 20, rows: 20 },
      players: {
        1: ps({ trail: [{ x: 2, y: 2 }], direction: 'right', color: '#3B82F6' }),
        2: ps({ trail: [{ x: 10, y: 10 }], direction: 'right', color: '#EF4444' })
      },
      outcome: null,
      tick: 0,
      pickups: [],
      obstacles: [],
      portals: [],
      tunnels: [],
      unsafeCells: []
    }
  }

  it('returns false with nothing held', () => {
    const state = baseState()
    expect(shouldCpuActivate(state, 'hard', new Set())).toBe(false)
  })

  it('pops a held Shield when every direction is unsafe', () => {
    const state = baseState()
    state.players[2] = { ...state.players[2], trail: [{ x: 10, y: 10 }], direction: 'right', heldPowerup: 'shield' }
    const occupied = new Set(['11,10', '9,10', '10,9', '10,11'])
    expect(shouldCpuActivate(state, 'hard', occupied)).toBe(true)
  })

  it('does not pop Shield when a safe direction still exists', () => {
    const state = baseState()
    state.players[2] = { ...state.players[2], heldPowerup: 'shield' }
    expect(shouldCpuActivate(state, 'hard', new Set())).toBe(false)
  })

  it('uses Overdrive opportunistically once the board is open', () => {
    const state = baseState()
    state.players[2] = { ...state.players[2], heldPowerup: 'overdrive' }
    expect(shouldCpuActivate(state, 'hard', new Set())).toBe(true)
  })

  it('uses Hack/Overclock/Stasis offensively once the opponent is boxed in', () => {
    for (const heldPowerup of ['hack', 'overclock', 'stasis'] as const) {
      const state = baseState()
      state.players[1] = { ...state.players[1], trail: [{ x: 1, y: 1 }], direction: 'right' }
      state.players[2] = { ...state.players[2], heldPowerup }
      // Seals player 1 into a small 3x3 pocket (9 free cells, bounded by the grid edge on two sides
      // and a wall on the other two) — comfortably under the offensive-use space threshold.
      const occupied = new Set<string>()
      for (let y = 0; y <= 2; y++) occupied.add(`3,${y}`)
      for (let x = 0; x <= 2; x++) occupied.add(`${x},3`)
      expect(shouldCpuActivate(state, 'hard', occupied)).toBe(true)
    }
  })

  it("does not pop a held Shield near the grid edge once wrap-aware — 'hard' correctly sees the wrapped escape instead of misjudging it as cornered", () => {
    // CPU at the west edge (x=0) heading 'up' ('down' is the excluded 180°, leaving up/left/right
    // as candidates): up and right are blocked outright, and left runs straight off the edge. With
    // no wrap, all three are unsafe — cornered. With wrap, left re-enters at the wide-open east
    // edge (x=19), so it isn't cornered after all.
    const state = baseState()
    state.players[2] = { ...state.players[2], trail: [{ x: 0, y: 5 }], direction: 'up', heldPowerup: 'shield' }
    const occupied = new Set(['0,4', '1,5'])

    expect(shouldCpuActivate(state, 'hard', occupied)).toBe(true)
    expect(shouldCpuActivate(state, 'hard', occupied, undefined, undefined, true)).toBe(false)
  })

  it("still pops the Shield below 'hard' even when wrapEdges is on — wrap-awareness is gated to hard only", () => {
    const state = baseState()
    state.players[2] = { ...state.players[2], trail: [{ x: 0, y: 5 }], direction: 'up', heldPowerup: 'shield' }
    const occupied = new Set(['0,4', '1,5'])

    expect(shouldCpuActivate(state, 'normal', occupied, undefined, undefined, true)).toBe(true)
    expect(shouldCpuActivate(state, 'easy', occupied, undefined, undefined, true)).toBe(true)
  })

  it('respects per-difficulty awareness — easy never uses Overdrive opportunistically', () => {
    const state = baseState()
    state.players[2] = { ...state.players[2], heldPowerup: 'overdrive' }
    expect(shouldCpuActivate(state, 'easy', new Set())).toBe(false)
  })

  it('is a no-op via applyCpuActivation outside the playing phase', () => {
    const state = { ...baseState(), phase: 'onboarding' as const }
    state.players[2] = { ...state.players[2], heldPowerup: 'overdrive' }
    expect(applyCpuActivation(state, 'hard')).toBe(state)
  })

  it('applyCpuActivation actually activates when shouldCpuActivate is true', () => {
    const state = baseState()
    state.players[2] = { ...state.players[2], heldPowerup: 'overdrive' }
    expect(shouldCpuActivate(state, 'hard', new Set())).toBe(true)
    const next = applyCpuActivation(state, 'hard', new Set())
    expect(next.players[2].heldPowerup).toBeNull()
    expect(next.players[2].effects.speed?.type).toBe('overdrive')
  })
})

// Sanity check that the threshold constants used above are what the test math assumes.
describe('powerup CPU awareness thresholds', () => {
  it('are positive, sane bounds', () => {
    expect(POWERUP_CPU_OFFENSIVE_SPACE_THRESHOLD).toBeGreaterThan(0)
    expect(POWERUP_CPU_OVERDRIVE_MIN_SPACE).toBeGreaterThan(POWERUP_CPU_OFFENSIVE_SPACE_THRESHOLD)
  })
})
