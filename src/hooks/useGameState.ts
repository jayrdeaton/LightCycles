import { useCallback, useEffect, useRef, useState } from 'react'

import { GRID_CELL_PX, MAX_TICK_DT_MS, scaleMsForCellPx, SPEED_RAMP_DECREMENT_MS, SPEED_RAMP_MIN_INTERVAL_MS, SPEED_TIER_INTERVAL_MS, TRAIL_GROWTH_RATE } from '@/constants/game'
import { Direction, GameSettings, OrientationMode, Player } from '@/types'
import { applyCpuTurn } from '@/utils/cpuAi'
import { applyTurnIntent, buildOccupiedSet, computeTickIntervalMs, createInitialGameState, startPlaying, tickGame } from '@/utils/gameEngine'

// orientationMode is passed separately rather than read off `settings` — it's derived live from
// the device's current physical shape (see useDeviceOrientation), not a stored setting.
export function useGameState(width: number, height: number, settings: GameSettings, colors: Record<Player, string>, orientationMode: OrientationMode) {
  const cellPx = GRID_CELL_PX[settings.gridSizeTier]

  const [state, setState] = useState(() => createInitialGameState(width, height, orientationMode, colors, cellPx))
  // The interval the *last* tick actually advanced by — exposed so the board can animate each
  // player's head gliding into its new cell over exactly that duration (see GameBoard.tsx) instead
  // of snapping, which is what made a low-ish tick rate read as choppy even though the underlying
  // step rate was unchanged. Seeded from the base tier (scaled to the active cell size) so the very
  // first tick has a sane duration to animate against before any real tick has happened yet.
  const [tickIntervalMs, setTickIntervalMs] = useState(() => scaleMsForCellPx(SPEED_TIER_INTERVAL_MS[settings.speedTier], cellPx))

  const turn = useCallback((player: Player, direction: Direction) => {
    setState((s) => applyTurnIntent(s, player, direction))
  }, [])

  const beginPlaying = useCallback(() => {
    setState((s) => startPlaying(s))
  }, [])

  const rematch = useCallback(() => {
    setState(createInitialGameState(width, height, orientationMode, colors, cellPx))
  }, [width, height, orientationMode, colors, cellPx])

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
        const trailGrowthRate = TRAIL_GROWTH_RATE[settings.trailGrowthTier]
        setState((s) => {
          if (settings.gameMode !== 'vsCpu') return tickGame(s, undefined, trailGrowthRate)
          // Built once and reused for both — see buildOccupiedSet's own comment on why this is
          // always safe, not just an optimization that happens to hold today. The CPU decides its
          // turn for THIS tick immediately before it's applied, same cadence a human's queued
          // swipe would land at, so the bot's move and the tick that consumes it commit together.
          const occupied = buildOccupiedSet(s.players)
          return tickGame(applyCpuTurn(s, settings.cpuDifficulty, occupied), occupied, trailGrowthRate)
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
  }, [state.phase, settings.speedTier, settings.speedRampEnabled, settings.gameMode, settings.cpuDifficulty, settings.trailGrowthTier, cellPx])

  return { state, turn, beginPlaying, rematch, tickIntervalMs, cellPx }
}
