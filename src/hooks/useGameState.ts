import { useCallback, useEffect, useRef, useState } from 'react'

import { GRID_CELL_PX, MAX_TICK_DT_MS, scaleMsForCellPx, SPEED_RAMP_DECREMENT_MS, SPEED_RAMP_MIN_INTERVAL_MS, SPEED_TIER_INTERVAL_MS, TRAIL_SPEED_RATE } from '@/constants/game'
import { Direction, GameSettings, OrientationMode, Player } from '@/types'
import { applyCpuActivation, applyCpuTurn } from '@/utils/cpuAi'
import { applyActivation, applyTurnIntent, buildOccupiedSet, buildTunnelCellSet, computeTickIntervalMs, createInitialGameState, startPlaying, tickGame } from '@/utils/gameEngine'

// orientationMode/p1OnRight are passed separately rather than read off `settings` — they're
// derived live from the device's own physical tilt (see useOrientationState), not a stored
// setting. safeAreaInsetsPx defaults to all-zero — see GameRound's own comment on GameRoundProps
// for why the caller is what decides whether it's actually the device's real insets or zeroed out.
export function useGameState(width: number, height: number, settings: GameSettings, colors: Record<Player, string>, orientationMode: OrientationMode, p1OnRight: boolean, safeAreaInsetsPx: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 }) {
  const cellPx = GRID_CELL_PX[settings.gridSizeTier]

  const [state, setState] = useState(() => createInitialGameState(width, height, orientationMode, colors, cellPx, p1OnRight, settings.arenaVariant, safeAreaInsetsPx))
  // The interval the *last* tick actually advanced by — exposed so the board can animate each
  // player's head gliding into its new cell over exactly that duration (see GameBoard.tsx) instead
  // of snapping, which is what made a low-ish tick rate read as choppy even though the underlying
  // step rate was unchanged. Seeded from the base tier (scaled to the active cell size) so the very
  // first tick has a sane duration to animate against before any real tick has happened yet.
  const [tickIntervalMs, setTickIntervalMs] = useState(() => scaleMsForCellPx(SPEED_TIER_INTERVAL_MS[settings.speedTier], cellPx))

  const turn = useCallback((player: Player, direction: Direction) => {
    setState((s) => applyTurnIntent(s, player, direction))
  }, [])

  const activate = useCallback((player: Player) => {
    setState((s) => applyActivation(s, player))
  }, [])

  const beginPlaying = useCallback(() => {
    setState((s) => startPlaying(s))
  }, [])

  const rematch = useCallback(() => {
    setState(createInitialGameState(width, height, orientationMode, colors, cellPx, p1OnRight, settings.arenaVariant, safeAreaInsetsPx))
  }, [width, height, orientationMode, colors, cellPx, p1OnRight, settings.arenaVariant, safeAreaInsetsPx])

  // ─── Tick loop ──────────────────────────────────────────────────────────
  // Runs only while 'playing' (the effect's own [state.phase] dependency tears it down the
  // instant tickGame transitions to 'roundOver', same shape as BoxHockey's useGameState physics
  // loop). elapsedRef tracks round time outside React state so the ramp's own interval math (see
  // computeTickIntervalMs) can run synchronously inside the rAF callback, ahead of whatever the
  // next setState batch resolves to.
  const rafRef = useRef<number | null>(null)
  const lastTickRef = useRef<number | null>(null)
  const elapsedRef = useRef(0)

  useEffect(() => {
    if (state.phase !== 'playing') return

    let active = true
    lastTickRef.current = null
    elapsedRef.current = 0
    const baseIntervalMs = scaleMsForCellPx(SPEED_TIER_INTERVAL_MS[settings.speedTier], cellPx)
    const decrementMs = scaleMsForCellPx(SPEED_RAMP_DECREMENT_MS, cellPx)
    const minIntervalMs = scaleMsForCellPx(SPEED_RAMP_MIN_INTERVAL_MS, cellPx)

    const loop = (timestamp: number) => {
      if (!active) return
      if (lastTickRef.current === null) lastTickRef.current = timestamp

      const dt = timestamp - lastTickRef.current
      const intervalMs = computeTickIntervalMs(baseIntervalMs, elapsedRef.current, settings.speedRampEnabled, decrementMs, minIntervalMs)

      if (dt >= intervalMs) {
        lastTickRef.current = timestamp
        // Capped before accumulating into round time — see MAX_TICK_DT_MS's own comment. The
        // *trigger* check above still uses the real dt (so a tick fires immediately once a stall
        // resumes); only how much of it counts toward the ramp is bounded.
        elapsedRef.current += Math.min(dt, MAX_TICK_DT_MS)
        setTickIntervalMs(intervalMs)
        const trailSpeedRate = TRAIL_SPEED_RATE[settings.trailSpeedTier]
        const enabledPowerups = settings.enabledPowerups
        setState((s) => {
          if (settings.gameMode !== 'vsCpu') return tickGame(s, undefined, trailSpeedRate, enabledPowerups, undefined, undefined, settings.wrapEdges)
          // Built once and reused for both — see buildOccupiedSet's own comment on why this is
          // always safe, not just an optimization that happens to hold today. The CPU decides its
          // turn for THIS tick immediately before it's applied, same cadence a human's queued
          // swipe would land at, so the bot's move and the tick that consumes it commit together.
          // Activation is decided first, ahead of the turn — a Prune activation can shrink a
          // trail, so `occupied` is rebuilt fresh afterward rather than reused stale from before
          // it. `obstacles`/`tunnels` never change mid-round (see GameState's own comment), so
          // every rebuild here threads the same `s`/`afterActivation` state's own fields through
          // unchanged — `tunnelCellSet` in particular is genuinely round-constant, not just
          // per-tick-constant, so it's computed once up front rather than per rebuild. Unlike
          // `occupied`, the tunnel hazard set is never built here at all — it's player-scoped (see
          // buildTunnelOccupiedSet's own `excludePlayer` comment), so tickGame/applyCpuTurn/
          // applyCpuActivation each derive their own view from `state.players` internally rather
          // than sharing one merged set the way `occupied` is shared. `portalLookup` is NOT
          // threaded explicitly the same way either — every callee below already defaults it from
          // `state.portals` on its own, and a portal pair costs nothing to rebuild (see
          // buildPortalLookup's own comment), so there's no benefit to doing it here that would
          // offset the extra positional-arg noise of passing it through explicitly.
          const tunnelCellSet = buildTunnelCellSet(s.tunnels)
          const preOccupied = buildOccupiedSet(s.players, s.obstacles, tunnelCellSet)
          const afterActivation = enabledPowerups.length > 0 ? applyCpuActivation(s, settings.cpuDifficulty, preOccupied, undefined, undefined, settings.wrapEdges) : s
          const occupied = buildOccupiedSet(afterActivation.players, afterActivation.obstacles, tunnelCellSet)
          return tickGame(applyCpuTurn(afterActivation, settings.cpuDifficulty, occupied, undefined, undefined, settings.wrapEdges), occupied, trailSpeedRate, enabledPowerups, undefined, undefined, settings.wrapEdges)
        })
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)

    return () => {
      active = false
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [state.phase, settings.speedTier, settings.speedRampEnabled, settings.gameMode, settings.cpuDifficulty, settings.trailSpeedTier, settings.enabledPowerups, settings.wrapEdges, cellPx])

  return { state, turn, activate, beginPlaying, rematch, tickIntervalMs, cellPx }
}
