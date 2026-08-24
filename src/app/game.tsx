import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton, useVibration } from '@rific/feedback-press'
import { useDeviceOrientation, useOrientationLock, useP1OnRight } from '@tastic/split-screen'
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import GameBoardHost from '@/components/GameBoardHost'
import OnboardingOverlay from '@/components/OnboardingOverlay'
import { PowerupHud } from '@/components/PowerupHud'
import RoundHistoryPips from '@/components/RoundHistoryPips'
import { SettingsDialog } from '@/components/SettingsDialog'
import TouchInputLayer from '@/components/TouchInputLayer'
import { BOARD_REORIENT_SETTLE_MS, BOARD_RESIZE_THRESHOLD_PX, ROUND_OVER_DIALOG_DELAY_MS, TRAIL_SPEED_RATE } from '@/constants/game'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useGameSound } from '@/hooks/useGameSound'
import { useGameState } from '@/hooks/useGameState'
import { Direction, GameSettings, OrientationMode, Player, RoundOutcome } from '@/types'
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
  // out from under the players mid-round on a 180° turn, which a fresh round (see GameScreen's own
  // reorient-settle handling) should only ever do at its own start, not mid-play.
  p1OnRight: boolean
  // Owned by GameScreen, not this component, so it survives a genuine resize remounting a fresh
  // GameRound below — see onRoundOutcome.
  roundHistory: RoundOutcome[]
  // Reports a just-finished round upward instead of GameRound tracking its own roundHistory, so a
  // mid-round reorientation (GameScreen unmounts this component while the device settles, then
  // mounts a fresh one — see BOARD_REORIENT_SETTLE_MS) only ever loses the round that got
  // interrupted, never the streak already recorded before it.
  onRoundOutcome: (outcome: RoundOutcome) => void
}

// Split out from GameScreen so useGameState's lazy initial state (see useGameState.ts) is always
// built from a real, already-measured board size — mounting it before the board area's onLayout
// ever fires would lock the grid to a throwaway placeholder size forever, since that initializer
// only ever runs once per mount. Keyed by its own size so a genuine, settled resize (see
// GameScreen's onBoardLayout) remounts a fresh round at the new size instead of rendering a stale
// grid against a differently-sized container.
function GameRound({ width, height, settings, colors, orientationMode, p1OnRight: p1OnRightAtMount, roundHistory, onRoundOutcome }: GameRoundProps) {
  const [p1OnRight] = useState(p1OnRightAtMount)
  const { state, turn, activate, beginPlaying, rematch, tickIntervalMs, cellPx } = useGameState(width, height, settings, colors, orientationMode, p1OnRight)
  const humanPlayers = useMemo(() => humanPlayersFor(settings), [settings])
  const controlInverted = useMemo<Record<Player, boolean>>(() => ({ 1: state.players[1].effects.control !== null, 2: state.players[2].effects.control !== null }), [state.players])
  // Fed to TouchInputLayer so it can gate turn feedback (sound/haptic) on a swipe that would
  // actually turn the player — see isEffectiveTurn.
  const currentDirections = useMemo<Record<Player, Direction>>(() => ({ 1: state.players[1].direction, 2: state.players[2].direction }), [state.players])

  // The persisted, cross-round defaults (not this round's already-locked-in `settings` prop above)
  // — matches every other screen's settings button, which always edits "next time," never the
  // round already underway.
  const { settings: userSettings, setSettings: setUserSettings } = useGameSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Only asked once there's an actual score to lose (the pip row itself uses the same gate, see
  // OnboardingOverlay) — the very first round's back button still exits immediately, since there's
  // nothing yet for a confirmation to protect.
  const [confirmBackVisible, setConfirmBackVisible] = useState(false)
  const onBackPress = useCallback(() => {
    if (roundHistory.length > 0) setConfirmBackVisible(true)
    else safeBack()
  }, [roundHistory.length])

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

  // roundHistory itself lives in GameScreen now (see GameRoundProps) — this just reports a
  // just-finished round upward, once, on the same phase transition the vibration/sound below
  // already watches for.
  const prevPhaseRef = useRef(state.phase)
  useEffect(() => {
    if (prevPhaseRef.current !== 'roundOver' && state.phase === 'roundOver') {
      vibrationRef.current.notification()
      soundRef.current.playCrash()
      if (state.outcome) onRoundOutcome(state.outcome)
    }
    prevPhaseRef.current = state.phase
  }, [state.phase, state.outcome, onRoundOutcome])

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
  const fg = dark ? '#FFFFFF' : '#000000'
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
      <GameBoardHost players={state.players} phase={state.phase} tickIntervalMs={tickIntervalMs} cellPx={cellPx} grid={state.grid} orientationMode={orientationMode} p1OnRight={p1OnRight} tick={state.tick} pickups={state.pickups} pickupColor={themeColors.tertiary} trailSpeedRate={TRAIL_SPEED_RATE[settings.trailSpeedTier]} />
      <TouchInputLayer orientationMode={orientationMode} p1OnRight={p1OnRight} humanPlayers={humanPlayers} enabled={state.phase === 'playing'} onTurn={turn} onActivate={activate} controlInverted={controlInverted} currentDirections={currentDirections} keyScheme={settings.keyScheme} />
      {state.phase === 'playing' && settings.enabledPowerups.length > 0 && <PowerupHud players={state.players} />}

      {/* Unmounted (rather than merely hidden) while settings or the quit confirmation is open:
      OnboardingOverlay's countdown timers are scheduled once on mount with no pause hook of their
      own, so unmounting is what stops them ticking underneath either dialog, and remounting on
      close is what restarts the count from '3' instead of resuming mid-count with stale timers. */}
      {state.phase === 'onboarding' && !settingsOpen && !confirmBackVisible && <OnboardingOverlay orientationMode={orientationMode} p1OnRight={p1OnRight} humanPlayers={humanPlayers} p1Color={colors[1]} p2Color={colors[2]} roundHistory={roundHistory} onComplete={beginPlaying} />}

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

      {/* Same overlay+card shell as the round-over dialog above (right down to the shared
      styles.overlay/overlayCard/overlayButton) so a mid-onboarding confirmation reads as the same
      kind of dialog, not a one-off. The pip row (same component OnboardingOverlay itself uses)
      shows exactly what's at stake instead of a sentence restating the round count. Cancel/Quit
      reuse the app's own primary/secondary pairing (same two colors as index.tsx's One
      Player/Two Player) rather than the theme's MD3 error role, which read as washed-out pastel
      against this app's normal saturated palette — Cancel (the "stay" option, mirroring
      Rematch's slot above) keeps primary, Quit takes secondary. */}
      {confirmBackVisible && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Icon source='alert-circle-outline' size={64} color={themeColors.secondary} />
            <Text variant='headlineLarge' style={[styles.overlayTitle, { color: themeColors.secondary }]}>
              Quit Match?
            </Text>
            <RoundHistoryPips roundHistory={roundHistory} p1Color={colors[1]} p2Color={colors[2]} />
            <Button mode='contained' onPress={() => setConfirmBackVisible(false)} style={styles.overlayButton} buttonColor={themeColors.primary} textColor={themeColors.onPrimary}>
              Cancel
            </Button>
            <Button mode='contained' onPress={safeBack} style={styles.overlayButton} buttonColor={themeColors.secondary} textColor={themeColors.onSecondary}>
              Quit
            </Button>
          </View>
        </View>
      )}

      {/* Left corner — opposite the settings cog below, which claims the top-right in every phase
      that shows it. Sits over the dark backdrop when either dialog is up (a fixed light tint, since
      that backdrop is always dark regardless of theme) and over the bare board when peeked
      (theme-aware fg, matching every other icon that sits directly on the board). */}
      {state.phase === 'roundOver' && showResultDialog && <IconButton icon={resultPeeked ? 'eye-off-outline' : 'eye-outline'} iconColor={resultPeeked ? fg : 'rgba(255,255,255,0.9)'} size={22} style={styles.peekButton} onPress={() => setResultPeeked((peeked) => !peeked)} accessibilityLabel={resultPeeked ? 'Show results' : 'Peek at board'} />}

      {/* Full-strength theme-aware fg over the bare board, same as every other screen's own
      back/settings corner chrome (index.tsx, lobby.tsx, achievements.tsx) — recolors to the fixed
      light tint the moment the quit confirmation's own backdrop goes up over it, same as the cog
      below. */}
      {state.phase === 'onboarding' && <IconButton icon='arrow-left' iconColor={confirmBackVisible ? 'rgba(255,255,255,0.9)' : fg} size={22} style={styles.backButton} onPress={onBackPress} />}
      {/* Same top-right slot as every other screen's cog (index.tsx, lobby.tsx) — reachable during
      the countdown, again once the round-over dialog is up, and again over the quit confirmation,
      so it's always in the same place regardless of which overlay is on screen. Recolors the same
      way the peek button (above) does whenever it's sitting over one of those dark backdrops. */}
      {(state.phase === 'onboarding' || (state.phase === 'roundOver' && showResultDialog)) && <IconButton icon='cog' iconColor={(state.phase === 'roundOver' && !resultPeeked) || confirmBackVisible ? 'rgba(255,255,255,0.9)' : fg} size={22} style={styles.settingsButton} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />}

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

  // orientationMode follows the device's current physical shape (see useDeviceOrientation), same
  // Lock Orientation preference (see SettingsDialog) as every other screen — a genuine mid-round
  // rotation no longer blows away the round in progress (see the reorient-settle handling below),
  // so there's no reason left to override a player's own opt-in preference here specifically.
  const orientationMode = useDeviceOrientation()
  useOrientationLock(settings?.lockOrientation ?? false, orientationMode)
  const { p1OnRight } = useP1OnRight()

  const insets = useSafeAreaInsets()
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const colors = useMemo<Record<Player, string>>(() => ({ 1: themeColors.primary, 2: themeColors.secondary }), [themeColors.primary, themeColors.secondary])

  // Chronological record of each round's outcome this match, oldest first — lives here rather than
  // inside GameRound so it survives a reorientation remounting a fresh one below (only the round
  // that got interrupted is lost, never the streak already recorded before it).
  const [roundHistory, setRoundHistory] = useState<RoundOutcome[]>([])
  const handleRoundOutcome = useCallback((outcome: RoundOutcome) => {
    setRoundHistory((history) => [...history, outcome])
  }, [])

  // The safe area's edge IS the wall (see PLAN.md) — the board area is bounded to exactly the safe
  // area, and running off that edge is a crash like any trail. GameBoard draws a thin two-color
  // outline at the grid's actual pixel bounds to mark exactly where that edge is.
  const [boardSize, setBoardSize] = useState<{ width: number; height: number } | null>(null)
  // True from the moment a genuine resize is first detected until layout settles at its final size
  // (see BOARD_REORIENT_SETTLE_MS) — GameRound is unmounted for this whole window (see the render
  // below) rather than kept mounted at its old, now-stale size, which is what actually "pauses" the
  // round: no tick loop runs while nothing is mounted to run it.
  const [reorienting, setReorienting] = useState(false)
  const pendingSizeRef = useRef<{ width: number; height: number } | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    },
    []
  )

  const onBoardLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setBoardSize((prev) => {
      if (!prev) return { width, height }
      // Ignores sub-threshold wobble (a transient inset change, not a real resize — see
      // BOARD_RESIZE_THRESHOLD_PX) — prev itself is left untouched, whether or not a settle window
      // is currently in progress (in which case this is just one more intermediate frame of the
      // same rotation, and doesn't need its own wobble check).
      const changed = Math.abs(prev.width - width) > BOARD_RESIZE_THRESHOLD_PX || Math.abs(prev.height - height) > BOARD_RESIZE_THRESHOLD_PX
      if (!changed) return prev

      pendingSizeRef.current = { width, height }
      setReorienting(true)
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      settleTimerRef.current = setTimeout(() => {
        setBoardSize(pendingSizeRef.current)
        setReorienting(false)
      }, BOARD_REORIENT_SETTLE_MS)
      return prev
    })
  }, [])

  const bg = dark ? '#000000' : '#FFFFFF'
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

  if (!settings) return null

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <View style={[styles.boardArea, { top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right }]} onLayout={onBoardLayout}>
        {reorienting ? (
          <View style={styles.reorientingZone}>
            <Icon source='screen-rotation' size={40} color={fgMuted} />
            <Text style={[styles.reorientingText, { color: fgMuted }]}>Reorienting…</Text>
          </View>
        ) : (
          boardSize && <GameRound key={`${boardSize.width}x${boardSize.height}`} width={boardSize.width} height={boardSize.height} settings={settings} colors={colors} orientationMode={orientationMode} p1OnRight={p1OnRight} roundHistory={roundHistory} onRoundOutcome={handleRoundOutcome} />
        )}
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
  // headlineLarge's own line-height leaves slack under the glyphs that the flex `gap` above stacks
  // on top of, reading as extra room below the title specifically (most visible once the pip row
  // sits right after it, next to a button with no such slack) — this claws it back.
  overlayTitle: { fontWeight: 'bold', marginBottom: -8 },
  peekButton: { left: 4, position: 'absolute', top: 4 },
  reorientingText: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  reorientingZone: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  root: { flex: 1 },
  settingsButton: { position: 'absolute', right: 4, top: 4 }
})
