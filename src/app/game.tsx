import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton, useVibration } from '@rific/feedback-press'
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import GameBoardHost from '@/components/GameBoardHost'
import OnboardingOverlay from '@/components/OnboardingOverlay'
import { SettingsDialog } from '@/components/SettingsDialog'
import TouchInputLayer from '@/components/TouchInputLayer'
import { BOARD_RESIZE_THRESHOLD_PX, ROUND_OVER_DIALOG_DELAY_MS } from '@/constants/game'
import { useDeviceOrientation } from '@/hooks/useDeviceOrientation'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useGameSound } from '@/hooks/useGameSound'
import { useGameState } from '@/hooks/useGameState'
import { useOrientationLock } from '@/hooks/useOrientationLock'
import { useP1OnRight } from '@/hooks/useP1OnRight'
import { GameSettings, OrientationMode, Player, RoundOutcome } from '@/types'
import { humanPlayersFor } from '@/utils/gameParams'
import { safeBack } from '@/utils/navigation'

interface GameRoundProps {
  width: number
  height: number
  settings: GameSettings
  colors: Record<Player, string>
  orientationMode: OrientationMode
  // Only meaningful when orientationMode === 'sideBySide' — see useP1OnRight. Read once, at mount,
  // via GameRound's own lazy useState below rather than as a live value: unlike a portrait<->
  // landscape change, a LANDSCAPE_LEFT<->LANDSCAPE_RIGHT flip doesn't change the board's measured
  // size, so it wouldn't trip the resize-remount below — without freezing it, the sides could swap
  // out from under the players mid-round on a 180° turn, exactly what the unconditional
  // useOrientationLock below is otherwise trying to prevent.
  p1OnRight: boolean
}

// Split out from GameScreen so useGameState's lazy initial state (see useGameState.ts) is always
// built from a real, already-measured board size — mounting it before the board area's onLayout
// ever fires would lock the grid to a throwaway placeholder size forever, since that initializer
// only ever runs once per mount. Keyed by its own size so a genuine resize (in practice only
// possible on web, since native orientation is locked — see useOrientationLock) remounts a fresh
// round at the new size instead of rendering a stale grid against a differently-sized container.
function GameRound({ width, height, settings, colors, orientationMode, p1OnRight: p1OnRightAtMount }: GameRoundProps) {
  const { state, turn, beginPlaying, rematch, tickIntervalMs, cellPx } = useGameState(width, height, settings, colors, orientationMode)
  const humanPlayers = useMemo(() => humanPlayersFor(settings), [settings])
  const [p1OnRight] = useState(p1OnRightAtMount)

  // The persisted, cross-round defaults (not this round's already-locked-in `settings` prop above)
  // — matches every other screen's settings button, which always edits "next time," never the
  // round already underway.
  const { settings: userSettings, setSettings: setUserSettings } = useGameSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const vibration = useVibration()
  const vibrationRef = useRef(vibration)
  useEffect(() => {
    vibrationRef.current = vibration
  }, [vibration])

  // Crash fires the instant the round ends (matching the board freezing on that same frame);
  // win/draw fire later, alongside the result dialog itself — see the two effects below.
  const playCrash = useGameSound(require('../../assets/sounds/crash.wav'))
  const playWin = useGameSound(require('../../assets/sounds/win.wav'))
  const playDraw = useGameSound(require('../../assets/sounds/draw.wav'))
  const soundRef = useRef({ playCrash, playWin, playDraw })
  useEffect(() => {
    soundRef.current = { playCrash, playWin, playDraw }
  }, [playCrash, playWin, playDraw])

  // Chronological record of each round's outcome, oldest first — survives 'rematch' resetting
  // `state` (rematch only touches useGameState's own state, not this) so the next round's
  // countdown can show a pip per round already played. Empty until the first round ends, which is
  // what keeps pips off the very first onboarding countdown and only showing from a rematch on.
  // Adjusted during render (React's own pattern for deriving state from a prop/state transition)
  // rather than in an effect, since it's pure state derivation with no external system involved —
  // unlike the vibration call below, which does belong in an effect.
  const [roundHistory, setRoundHistory] = useState<RoundOutcome[]>([])
  const [prevRoundPhase, setPrevRoundPhase] = useState(state.phase)
  if (prevRoundPhase !== state.phase) {
    setPrevRoundPhase(state.phase)
    if (prevRoundPhase !== 'roundOver' && state.phase === 'roundOver' && state.outcome) {
      setRoundHistory((history) => [...history, state.outcome as RoundOutcome])
    }
  }

  const prevPhaseRef = useRef(state.phase)
  useEffect(() => {
    if (prevPhaseRef.current !== 'roundOver' && state.phase === 'roundOver') {
      vibrationRef.current.notification()
      soundRef.current.playCrash()
    }
    prevPhaseRef.current = state.phase
  }, [state.phase])

  // The board itself reacts to state.phase immediately (freezing on the crash's final frame) —
  // only the dialog waits, so there's a beat to actually see what just happened before it's
  // covered up. Resets whenever a fresh round leaves 'roundOver' (rematch), not just on mount.
  const [showResultDialog, setShowResultDialog] = useState(false)
  // Lets a player pull the dialog (and its backdrop) out of the way to actually look at the final
  // board — the delay above only covers the moment right after the crash, not "whenever you want
  // another look" — without losing the result, which is still one more tap away via the same
  // button. Reset alongside showResultDialog below, in the same cleanup, so a fresh round's dialog
  // never opens pre-peeked from where the last one left off.
  const [resultPeeked, setResultPeeked] = useState(false)
  useEffect(() => {
    if (state.phase !== 'roundOver') return
    const timer = setTimeout(() => setShowResultDialog(true), ROUND_OVER_DIALOG_DELAY_MS)
    // Runs when phase next changes away from 'roundOver' (rematch) or on unmount — resetting here,
    // not synchronously in the effect body above, is what a fresh 'roundOver' next round needs to
    // find false again instead of skipping straight past its own delay.
    return () => {
      clearTimeout(timer)
      setShowResultDialog(false)
      setResultPeeked(false)
    }
  }, [state.phase])

  // The victory/draw jingle, timed to land with the dialog reveal rather than the crash itself —
  // the crash sound (above) already covers that earlier beat.
  useEffect(() => {
    if (!showResultDialog || !state.outcome) return
    if (state.outcome.type === 'win') soundRef.current.playWin()
    else soundRef.current.playDraw()
  }, [showResultDialog, state.outcome])

  const { colors: themeColors, dark } = useAutoPaperTheme()
  const cardBg = dark ? '#111111' : '#F2F2F2'
  const cardBorder = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'
  const fgMuted = dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'

  const outcome = state.outcome
  const outcomeColor = outcome?.type === 'win' ? colors[outcome.winner] : fgMuted
  const outcomeText = outcome === null ? '' : outcome.type === 'draw' ? 'DRAW' : settings.gameMode === 'vsCpu' ? (outcome.winner === 1 ? 'YOU WIN!' : 'CPU WINS!') : `P${outcome.winner} WINS!`
  // A robot specifically for the CPU beating you (matching its own avatar icon elsewhere, e.g.
  // LobbyPlayerPanel) rather than a generic trophy, which would read like *you'd* won.
  const outcomeIcon = outcome === null ? '' : outcome.type === 'draw' ? 'handshake-outline' : settings.gameMode === 'vsCpu' && outcome.winner === 2 ? 'robot' : 'trophy'

  // Rematch takes the loser's color (the one most likely to want a redo) and Menu takes the
  // winner's — a draw has neither, so both fall back to the app's own neutral primary/secondary
  // roles rather than favoring either player's trail color.
  const winner = outcome?.type === 'win' ? outcome.winner : null
  const loser = winner === 1 ? 2 : winner === 2 ? 1 : null
  const onColors: Record<Player, string> = { 1: themeColors.onPrimary, 2: themeColors.onSecondary }
  const rematchColor = loser !== null ? colors[loser] : themeColors.primary
  const rematchTextColor = loser !== null ? onColors[loser] : themeColors.onPrimary
  const menuColor = winner !== null ? colors[winner] : themeColors.secondary
  const menuTextColor = winner !== null ? onColors[winner] : themeColors.onSecondary

  return (
    <>
      <GameBoardHost players={state.players} phase={state.phase} tickIntervalMs={tickIntervalMs} cellPx={cellPx} grid={state.grid} orientationMode={orientationMode} p1OnRight={p1OnRight} tick={state.tick} />
      <TouchInputLayer orientationMode={orientationMode} p1OnRight={p1OnRight} humanPlayers={humanPlayers} enabled={state.phase === 'playing'} onTurn={turn} keyScheme={settings.keyScheme} />

      {/* Unmounted (rather than merely hidden) while settings is open: OnboardingOverlay's countdown
      timers are scheduled once on mount with no pause hook of their own, so unmounting is what
      stops them ticking underneath the dialog, and remounting on close is what restarts the count
      from '3' instead of resuming mid-count with stale timers. */}
      {state.phase === 'onboarding' && !settingsOpen && <OnboardingOverlay orientationMode={orientationMode} p1OnRight={p1OnRight} humanPlayers={humanPlayers} p1Color={colors[1]} p2Color={colors[2]} roundHistory={roundHistory} onComplete={beginPlaying} />}

      {state.phase === 'roundOver' && showResultDialog && !resultPeeked && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Icon source={outcomeIcon} size={64} color={outcomeColor} />
            <Text variant='headlineLarge' style={[styles.overlayTitle, { color: outcomeColor }]}>
              {outcomeText}
            </Text>
            <Button mode='contained' onPress={rematch} style={styles.overlayButton} buttonColor={rematchColor} textColor={rematchTextColor}>
              Rematch
            </Button>
            <Button mode='contained' onPress={() => router.dismissAll()} style={styles.overlayButton} buttonColor={menuColor} textColor={menuTextColor}>
              Menu
            </Button>
          </View>
        </View>
      )}

      {/* Left corner — opposite the settings cog below, which claims the top-right in every phase
      that shows it. Sits over the dark backdrop when the dialog is up (a fixed light tint, since
      that backdrop is always dark regardless of theme) and over the bare board when peeked
      (theme-aware fgMuted, matching every other icon that sits directly on the board). */}
      {state.phase === 'roundOver' && showResultDialog && <IconButton icon={resultPeeked ? 'eye-off-outline' : 'eye-outline'} iconColor={resultPeeked ? fgMuted : 'rgba(255,255,255,0.9)'} size={22} style={styles.peekButton} onPress={() => setResultPeeked((peeked) => !peeked)} accessibilityLabel={resultPeeked ? 'Show results' : 'Peek at board'} />}

      {/* fgMuted (not themeColors.onSurface) — matches the muted gray every other screen's own
      corner chrome uses (index.tsx, lobby.tsx), rather than the theme's full-strength text color. */}
      {state.phase === 'onboarding' && <IconButton icon='arrow-left' iconColor={fgMuted} size={22} style={styles.backButton} onPress={safeBack} />}
      {/* Same top-right slot as every other screen's cog (index.tsx, lobby.tsx) — reachable during
      the countdown and again once the round-over dialog is up, so it's always in the same place
      regardless of which of the two overlays is on screen. Recolors the same way the peek button
      (above) does during round-over, since it sits over the same backdrop/board there. */}
      {(state.phase === 'onboarding' || (state.phase === 'roundOver' && showResultDialog)) && (
        <IconButton icon='cog' iconColor={state.phase === 'roundOver' && !resultPeeked ? 'rgba(255,255,255,0.9)' : fgMuted} size={22} style={styles.settingsButton} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />
      )}

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} settings={userSettings} setSettings={setUserSettings} />
    </>
  )
}

export default function GameScreen() {
  // Locked in once at mount from /lobby's own handoff (see useGameSettings.tsx's
  // commitRoundSettings) — not read reactively off context, so a settings-dialog edit made mid-
  // round (which only ever touches the *editable* settings, not this snapshot) can't change a
  // round already underway out from under it.
  const { activeRoundSettings } = useGameSettings()
  const [settings] = useState(activeRoundSettings)

  useEffect(() => {
    // Reached directly — a refreshed page (web) or a deep link — rather than via /lobby's own
    // "Ready" handoff, so there's no committed round to play. Same fallback safeBack uses for its
    // own no-history case.
    if (!settings) router.replace('/')
  }, [settings])

  // orientationMode follows the device's current physical shape (see useDeviceOrientation), but
  // once a round is on screen it's always pinned to whatever that was at mount — unconditionally,
  // regardless of the Lock Orientation setting below. A genuine mid-round rotation changes the
  // board area's measured size, which trips BOARD_RESIZE_THRESHOLD_PX's remount logic and would
  // otherwise blow away the round in progress; Lock Orientation (an app-wide preference, see
  // SettingsDialog) only governs free rotation on every *other* screen.
  const orientationMode = useDeviceOrientation()
  useOrientationLock(true, orientationMode)
  const { p1OnRight } = useP1OnRight()

  const insets = useSafeAreaInsets()
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const colors = useMemo<Record<Player, string>>(() => ({ 1: themeColors.primary, 2: themeColors.secondary }), [themeColors.primary, themeColors.secondary])

  // The safe area's edge IS the wall (see PLAN.md) — the board area is bounded to exactly the safe
  // area, and running off that edge is a crash like any trail. GameBoard draws a thin two-color
  // outline at the grid's actual pixel bounds to mark exactly where that edge is.
  const [boardSize, setBoardSize] = useState<{ width: number; height: number } | null>(null)
  const onBoardLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setBoardSize((prev) => {
      if (!prev) return { width, height }
      // Ignores sub-threshold wobble (a transient inset change, not a real resize — see
      // BOARD_RESIZE_THRESHOLD_PX) rather than remounting GameRound (below) and discarding
      // whatever round is in progress.
      const changed = Math.abs(prev.width - width) > BOARD_RESIZE_THRESHOLD_PX || Math.abs(prev.height - height) > BOARD_RESIZE_THRESHOLD_PX
      return changed ? { width, height } : prev
    })
  }, [])

  const bg = dark ? '#000000' : '#FFFFFF'

  if (!settings) return null

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <View style={[styles.boardArea, { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right }]} onLayout={onBoardLayout}>
        {boardSize && <GameRound key={`${boardSize.width}x${boardSize.height}`} width={boardSize.width} height={boardSize.height} settings={settings} colors={colors} orientationMode={orientationMode} p1OnRight={p1OnRight} />}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  backButton: { left: 4, position: 'absolute', top: 4 },
  boardArea: { overflow: 'hidden', position: 'absolute' },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  overlayButton: { width: 160 },
  overlayCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    padding: 32
  },
  overlayTitle: { fontWeight: 'bold' },
  peekButton: { left: 4, position: 'absolute', top: 4 },
  root: { flex: 1 },
  settingsButton: { position: 'absolute', right: 4, top: 4 }
})
