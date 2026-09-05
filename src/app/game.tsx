import { getBlendedColor, useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton, useVibration } from '@rific/feedback-press'
import { useToast } from '@rific/toaster'
import { computeContentBounds } from '@tastic/core'
import { getFixedZoneRotation, needsSharedNeutralZone, useAccelerometerOrientation } from '@tastic/split-screen'
import { router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import GameBoardHost from '@/components/GameBoardHost'
import MatchOverDialog from '@/components/MatchOverDialog'
import OnboardingOverlay from '@/components/OnboardingOverlay'
import { PowerupHud } from '@/components/PowerupHud'
import RoundHistoryPips from '@/components/RoundHistoryPips'
import RoundOverDialog from '@/components/RoundOverDialog'
import { SettingsDialog } from '@/components/SettingsDialog'
import TouchInputLayer from '@/components/TouchInputLayer'
import { ACHIEVEMENT_TIER_COLORS } from '@/constants/achievements'
import { deathAnimationDurationMs, MAX_BOARD_CONTENT_WIDTH, ROUND_OVER_DIALOG_HOLD_MS, TRAIL_SPEED_RATE } from '@/constants/game'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useGameSound } from '@/hooks/useGameSound'
import { useGameState } from '@/hooks/useGameState'
import { useGameStats } from '@/hooks/useGameStats'
import { useProfiles } from '@/hooks/useProfiles'
import { AchievementDefinition, Direction, GameMode, GamePhase, GameSettings, OrientationMode, Player, RoundOutcome } from '@/types'
import { humanPlayersFor } from '@/utils/gameParams'
import { safeBack } from '@/utils/navigation'

interface GameRoundProps {
  // The board's one-time DESIGN measurement (see GameScreen's boardSize.design) — read once, at
  // mount, via GameRound's own lazy useState below, same treatment as orientationMode/p1OnRight
  // right below. This is what the grid itself is built from (see useGameState) and never changes
  // again for the life of the match: the actual cols/rows a round plays out on can't change without
  // invalidating every trail cell already laid down in that coordinate space, so a side shouldn't
  // swap out from under a player mid-round just because the phone got bumped or picked up — freezing
  // at mount is a gameplay-fairness guard, not a workaround for OS rotation (the app is
  // portrait-locked at the OS level, so there's no real rotation to fight in the first place). The
  // floating dialogs (OnboardingOverlay, RoundOverDialog, ...) are a different story — see
  // MatchOverlays, rendered as this component's own sibling specifically so their live rotation
  // tracking can never cascade a re-render into the board/touch subtree below.
  width: number
  height: number
  // The SAME container's current LIVE measurement (see GameScreen's boardSize.live) — unlike
  // width/height above, these are deliberately NOT frozen into local state: they flow straight
  // through on every render so the live transform:scale below (see this component's own comment
  // next to it) can track the window resizing/gutter changing in real time, without the frozen grid
  // above ever finding out anything changed.
  liveWidth: number
  liveHeight: number
  settings: GameSettings
  colors: Record<Player, string>
  // Seat -> saved profile name, only for seats that had one selected at lobby handoff — see
  // GameScreen's own profileSnapshot comment for why this is frozen once, not read live.
  profileNames: Partial<Record<Player, string>>
  // Seat -> saved profile tag (the same short color+tag identity ProfileChip shows elsewhere) —
  // threaded alongside profileNames purely so MatchOverDialog can badge each achievement row with
  // whichever seat actually earned it, once both seats can unlock in the same match (two-player).
  profileTags: Partial<Record<Player, string>>
  // Seat -> whatever newly unlocked on the MOST RECENT round recorded, for that seat's own rotated
  // card — that seat's own profile's unlocks, plus any device-wide achievement broadcast into BOTH
  // seats (a device-wide unlock has no single owner, but each seat still needs to see it facing
  // them the same as a profile-scoped one — see GameScreen's own handleRoundOutcome). Overwritten
  // every round, even to {}, so a quiet round always clears out the previous one's badge before
  // RoundOverDialog/MatchOverDialog next reads it. Two-player mode only — vsCpu routes every unlock
  // (device or profile) through its own single toast instead, via @rific/toaster.
  profileUnlockToast: Partial<Record<Player, AchievementDefinition[]>>
  // Always 'faceToFace' — see GameScreen's own comment on why the board never uses 'sideBySide'.
  orientationMode: OrientationMode
  // Meaningless alongside a permanently-'faceToFace' orientationMode — see GameScreen's own comment.
  p1OnRight: boolean
  // Owned by GameScreen, not this component, so it survives whatever GameRound itself does across
  // rotations — see onRoundOutcome.
  roundHistory: RoundOutcome[]
  // Reports a just-finished round upward instead of GameRound tracking its own roundHistory.
  onRoundOutcome: (outcome: RoundOutcome) => void
}

// Split out from GameScreen so useGameState's lazy initial state (see useGameState.ts) is always
// built from a real, already-measured board size — mounting it before the board area's onLayout
// ever fires would lock the grid to a throwaway placeholder size forever, since that initializer
// only ever runs once per mount. Mounted exactly once for the life of a match (see GameScreen,
// which measures the board area once and never revisits it) — width/height/orientationMode/
// p1OnRight below are all frozen at that single mount via lazy useState (redundant with
// GameScreen's own freeze of the values it passes down, but cheap insurance against this
// component ever receiving something other than a stable value), so a later rotation never tears
// the round down, rebuilds the grid, or touches the board/touch layer at all.
function GameRound({ width: widthAtMount, height: heightAtMount, liveWidth, liveHeight, settings, colors, profileNames, profileTags, profileUnlockToast, orientationMode: orientationModeAtMount, p1OnRight: p1OnRightAtMount, roundHistory, onRoundOutcome }: GameRoundProps) {
  const [width] = useState(widthAtMount)
  const [height] = useState(heightAtMount)
  const [orientationMode] = useState(orientationModeAtMount)
  const [p1OnRight] = useState(p1OnRightAtMount)
  const { state, turn, activate, beginPlaying, rematch, tickIntervalMs, cellPx } = useGameState(width, height, settings, colors, orientationMode, p1OnRight)

  // Live, not frozen (see liveWidth/liveHeight's own doc on GameRoundProps) — recomputed every
  // render as the window resizes/gutter changes, so the board+touch subtree below visibly tracks
  // it. Math.min, not independent X/Y scale, so a live aspect ratio that's drifted from the design
  // one (a much shorter or narrower window than the round actually started in) still scales the
  // whole board uniformly and leaves the extra room on one axis as margin, instead of stretching
  // cycles/trails into ovals. Applying this as a transform on the board+touch subtree as one rigid
  // unit, rather than re-deriving cols/rows/cellPx from the live size, is what actually makes this
  // safe: TouchInputLayer's own zones are already percentage-of-parent/pan-translation based, not
  // absolute-pixel (see that file's own doc), so scaling both the canvas and the touch zones
  // together by the exact same factor can never let them disagree about where anything is — unlike
  // the "freeze only the grid, leave the container live" approach width/height's own comment above
  // describes as tried and rejected, which let the two resize independently instead.
  const boardScale = Math.min(liveWidth / width, liveHeight / height)

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

  // The board itself reacts to state.phase immediately — each crashed player's own PlayerTrail
  // (see GameBoard.tsx) starts its explosion-then-wipe death sequence the instant it sees its own
  // `alive` flip false — only the dialog waits, so there's a beat to actually watch that sequence
  // play out before it's covered up. Resets whenever a fresh round leaves 'roundOver' (rematch),
  // not just on mount.
  const [showResultDialog, setShowResultDialog] = useState(false)
  // Which humans have pressed Rematch on the round-over dialog this round (see RoundOverDialog) —
  // reset alongside showResultDialog below, so a fresh round-over never opens with a stale
  // "already ready" state left over from the last one.
  const [rematchReady, setRematchReady] = useState<Record<Player, boolean>>({ 1: false, 2: false })
  useEffect(() => {
    if (state.phase !== 'roundOver') return
    // Whoever actually crashed this round (both, on a draw) — the dialog waits for the SLOWER of
    // their death sequences to finish, not the first, so it can never cover up a still-wiping
    // trail. Reads state.players once here, at the instant phase became 'roundOver'; that's safe
    // (not stale) because a dead player's own trail never changes again for the rest of the round —
    // see deathAnimationDurationMs's own comment on why both this effect and GameBoard.tsx can each
    // independently compute this same number with no risk of disagreeing.
    const deadPlayers = ([1, 2] as Player[]).filter((p) => !state.players[p].alive)
    const animMs = deadPlayers.length > 0 ? Math.max(...deadPlayers.map((p) => deathAnimationDurationMs(state.players[p].trail.length).totalMs)) : 0
    const timer = setTimeout(() => setShowResultDialog(true), animMs + ROUND_OVER_DIALOG_HOLD_MS)
    // Runs when phase next changes away from 'roundOver' (rematch) or on unmount — resetting here,
    // not synchronously in the effect body above, is what a fresh 'roundOver' next round needs to
    // find false again instead of skipping straight past its own delay.
    return () => {
      clearTimeout(timer)
      setShowResultDialog(false)
      setRematchReady({ 1: false, 2: false })
    }
    // Deliberately still keyed only on [state.phase], same as before this change — see this
    // effect's own comment above on why re-running on every state.players update would be
    // redundant, not more correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase])

  // The victory/draw jingle, timed to land with the dialog reveal rather than the crash itself —
  // the crash sound (above) already covers that earlier beat.
  useEffect(() => {
    if (!showResultDialog || !state.outcome) return
    if (state.outcome.type === 'win') soundRef.current.playWin()
    else soundRef.current.playDraw()
  }, [showResultDialog, state.outcome])

  // True once a Quit has been pressed by either player on the round-over dialog — terminal for
  // this match (see MatchOverDialog): unlike Rematch, a single Quit ends it regardless of what the
  // other player wants, so this never gets reset back to false the way rematchReady does above.
  const [matchOver, setMatchOver] = useState(false)
  const handleQuit = useCallback(() => setMatchOver(true), [])
  const handleRequestRematch = useCallback((player: Player) => setRematchReady((ready) => ({ ...ready, [player]: true })), [])

  // Fires the actual rematch once every human in this round has pressed Rematch — for vsCpu that's
  // just player 1 (see humanPlayers), so pressing it rematches immediately, matching the CPU always
  // "agreeing" instantly. Guarded on !matchOver so a Quit that lands the same tick a rematch was
  // already agreed to can't still sneak a rematch through underneath it.
  useEffect(() => {
    if (state.phase !== 'roundOver' || matchOver) return
    if (humanPlayers.every((p) => rematchReady[p])) rematch()
  }, [state.phase, matchOver, humanPlayers, rematchReady, rematch])

  const { colors: themeColors } = useAutoPaperTheme()
  // themeColors.outline on its own is already blended 45% toward player 1's own primary color (see
  // auto-paper's useComputedTheme.ts), which reads as "belongs to player 1" rather than a neutral
  // board marker — per explicit user feedback. Blending it further with tertiary (the same neutral,
  // belongs-to-neither-player role pickups already render in) pulls obstacle/portal/tunnel geometry
  // back toward "inert board structure" instead.
  const obstacleColor = getBlendedColor(themeColors.tertiary, themeColors.outline, 0.5)

  const outcome = state.outcome

  return (
    <>
      {/* Fixed at the frozen design width/height (not liveWidth/liveHeight) and scaled as one rigid
      unit via boardScale above — see that comment for why this, not resizing the pieces
      independently, is what keeps the canvas and the touch zones from ever disagreeing. transform's
      default origin (center) is exactly what keeps this centered inside boardArea's own live,
      already-centered bounds (see styles.boardArea's alignItems/justifyContent) as boardScale
      changes, with no separate positioning math needed here. */}
      <View style={{ width, height, transform: [{ scale: boardScale }] }}>
        <GameBoardHost players={state.players} phase={state.phase} tickIntervalMs={tickIntervalMs} cellPx={cellPx} grid={state.grid} orientationMode={orientationMode} p1OnRight={p1OnRight} tick={state.tick} pickups={state.pickups} pickupColor={themeColors.tertiary} obstacles={state.obstacles} obstacleColor={obstacleColor} portals={state.portals} tunnels={state.tunnels} trailSpeedRate={TRAIL_SPEED_RATE[settings.trailSpeedTier]} wrapEdges={settings.wrapEdges} />
        <TouchInputLayer orientationMode={orientationMode} p1OnRight={p1OnRight} humanPlayers={humanPlayers} enabled={state.phase === 'playing'} onTurn={turn} onActivate={activate} controlInverted={controlInverted} currentDirections={currentDirections} keyScheme={settings.keyScheme} />
      </View>

      {/* Deliberately OUTSIDE the scaled View above, unlike GameBoardHost/TouchInputLayer — a held
      powerup's badge is UI chrome, not part of the rendered world, and needs to stay a legible,
      comfortably-tappable fixed size (see PowerupHud's own 12px corner insets) regardless of
      whatever size the board itself is currently scaled to. */}
      {state.phase === 'playing' && settings.enabledPowerups.length > 0 && <PowerupHud players={state.players} orientationMode={orientationMode} p1OnRight={p1OnRight} />}

      {/* Every floating dialog lives in MatchOverlays instead of inline here, specifically so its
      own live rotation tracking (see that component's own doc) can never cascade a re-render into
      the board/touch subtree above — a real, on-device jitter bug when this used to live-render
      inline: rotating the phone re-rendered this whole component tree, board included, on every
      committed rotation change, even though nothing about the board's own frozen orientationMode/
      p1OnRight/state had actually changed. Also deliberately outside the scaled View above, same
      reason as PowerupHud just above — a dialog shouldn't shrink just because the board did. */}
      {/* The leftSlot/rightSlot chip buttons (back, settings) render inside MatchOverlays now,
      not here — same reason as every other floating overlay: they need the live `rotation`
      signal, and a hook call here (GameRound itself) would cascade a re-render into the board/
      touch subtree above on every tilt. See MatchOverlays' own doc for the full reasoning; the
      slot positioning/styling comments that used to live here now live there alongside the JSX. */}
      <MatchOverlays phase={state.phase} orientationMode={orientationMode} p1OnRight={p1OnRight} settingsOpen={settingsOpen} onSettingsDismiss={() => setSettingsOpen(false)} onSettingsOpen={() => setSettingsOpen(true)} userSettings={userSettings} setUserSettings={setUserSettings} confirmBackVisible={confirmBackVisible} onCancelConfirmBack={() => setConfirmBackVisible(false)} humanPlayers={humanPlayers} colors={colors} profileNames={profileNames} profileTags={profileTags} profileUnlockToast={profileUnlockToast} roundHistory={roundHistory} onOnboardingComplete={beginPlaying} showResultDialog={showResultDialog} matchOver={matchOver} outcome={outcome ?? null} gameMode={settings.gameMode} rematchReady={rematchReady} onRequestRematch={handleRequestRematch} onQuit={handleQuit} onExit={() => router.dismissAll()} onBackPress={onBackPress} />
    </>
  )
}

interface MatchOverlaysProps {
  phase: GamePhase
  // The board's own FROZEN orientationMode/p1OnRight (see GameRound) — used for these dialogs' OWN
  // internal zone-split logic, so a dialog's structural layout always matches the board's, never
  // the live physical tilt (which only drives each dialog's own `rotation` prop below).
  orientationMode: OrientationMode
  p1OnRight: boolean
  settingsOpen: boolean
  onSettingsDismiss: () => void
  // Opens the settings dialog — this lives here (not just onSettingsDismiss) because the chip
  // button that triggers it is now rendered here too, see the leftSlot/rightSlot chips below.
  onSettingsOpen: () => void
  userSettings: GameSettings
  setUserSettings: (update: Partial<GameSettings>) => void
  confirmBackVisible: boolean
  onCancelConfirmBack: () => void
  humanPlayers: Player[]
  colors: Record<Player, string>
  profileNames: Partial<Record<Player, string>>
  profileTags: Partial<Record<Player, string>>
  profileUnlockToast: Partial<Record<Player, AchievementDefinition[]>>
  roundHistory: RoundOutcome[]
  onOnboardingComplete: () => void
  showResultDialog: boolean
  matchOver: boolean
  outcome: RoundOutcome | null
  gameMode: GameMode
  rematchReady: Record<Player, boolean>
  onRequestRematch: (player: Player) => void
  onQuit: () => void
  onExit: () => void
  // Only meaningful during the 'onboarding' phase — see the leftSlot chip below, which is this
  // component's own copy of GameRound's identical back button (moved here for the same reason as
  // everything else: it needs the same live rotation the countdown next to it already gets).
  onBackPress: () => void
}

// Every floating in-match dialog, as GameRound's own sibling rather than something it renders
// inline — see GameRound's own comment on why: this is the one piece that needs LIVE rotation
// tracking (nothing else in a match does), and calling useAccelerometerOrientation() from a
// genuinely separate component is what actually keeps that live tracking from cascading a
// re-render into the board/touch subtree next to it. A parent re-rendering always re-renders its
// own children too, board included, regardless of whether the board's own props actually changed —
// sibling components don't share that fate, so isolating the live hook to its own subtree is a
// structural fix, not just a memoization optimization that could regress if some future prop here
// stopped being stable.
//
// Each dialog rotates its OWN content in place (a plain `rotation` prop, computed from the live
// signal below) rather than being wrapped in a width/height-swapping FakeLandscapeView the way the
// lobby's whole-screen layout is — these dialogs' own zones must stay exactly the shape
// TouchInputLayer's matching (unrotated) hit zones already are, and swapping dimensions around the
// whole overlay distorted a full-width/half-height zone into a narrow, tall sliver that no longer
// lined up with where a player could actually touch. FakeLandscapeView is still the right tool for
// genuinely-whole-screen content with no fixed shape to match — just not this.
function MatchOverlays({ phase, orientationMode, p1OnRight, settingsOpen, onSettingsDismiss, onSettingsOpen, userSettings, setUserSettings, confirmBackVisible, onCancelConfirmBack, humanPlayers, colors, profileNames, profileTags, profileUnlockToast, roundHistory, onOnboardingComplete, showResultDialog, matchOver, outcome, gameMode, rematchReady, onRequestRematch, onQuit, onExit, onBackPress }: MatchOverlaysProps) {
  const liveOrientation = useAccelerometerOrientation()
  // getFixedZoneRotation, not getViewRotation directly — this board's own zones are frozen forever
  // at 'faceToFace'/true (see GameRound), never reflowing no matter which way the device is spun
  // while flat, which is exactly the layout getFixedZoneRotation is for (see its own doc): a genuine
  // landscape hold still rotates everything, but a portrait "upside down" reading is ignored rather
  // than adding a spurious 180° flip on top of P2's own fixed one below (getOpposingZoneRotation).
  const rotation = getFixedZoneRotation(liveOrientation.orientationMode, liveOrientation.p1OnRight, liveOrientation.upsideDown)
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const cardBg = dark ? '#111111' : '#F2F2F2'
  const cardBorder = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'
  // Same chip colors as GameRound's own board-level fg/bg — duplicated here rather than passed as
  // props since this component already computes dark/themeColors for the cards above, and these
  // chips need the identical rotation-in-place treatment as everything else in this component.
  const chipBg = dark ? '#000000' : '#FFFFFF'
  const chipFg = dark ? '#FFFFFF' : '#000000'
  const chipRotation = rotation % 360 !== 0 ? { transform: [{ rotate: `${rotation}deg` }] } : undefined

  // The inverse of @tastic/split-screen's needsSharedNeutralZone — see its own doc for the full
  // reasoning (and why it deliberately isn't keyed on Platform.OS). CornerActionButtons-style fixed
  // top corners are the right reachability answer everywhere EXCEPT the one case that function
  // flags: two-plus players held face-to-face, where the top of the screen always reads upside-down
  // to whichever player is on the far side (see RoundOverDialog's own getOpposingZoneRotation), so
  // the shared vertical midline (leftSlot/rightSlot below) is the only neutral spot for both.
  const useCornerLayout = !needsSharedNeutralZone(liveOrientation.orientationMode, humanPlayers.length)

  return (
    <>
      {/* Unmounted (rather than merely hidden) while settings or the quit confirmation is open:
      OnboardingOverlay's countdown timers are scheduled once on mount with no pause hook of their
      own, so unmounting is what stops them ticking underneath either dialog, and remounting on
      close is what restarts the count from '3' instead of resuming mid-count with stale timers. */}
      {phase === 'onboarding' && !settingsOpen && !confirmBackVisible && <OnboardingOverlay orientationMode={orientationMode} p1OnRight={p1OnRight} rotation={rotation} humanPlayers={humanPlayers} p1Color={colors[1]} p2Color={colors[2]} roundHistory={roundHistory} onComplete={onOnboardingComplete} />}

      {phase === 'roundOver' && showResultDialog && !matchOver && outcome && <RoundOverDialog orientationMode={orientationMode} p1OnRight={p1OnRight} rotation={rotation} humanPlayers={humanPlayers} gameMode={gameMode} outcome={outcome} colors={colors} profileUnlocked={profileUnlockToast} rematchReady={rematchReady} onRequestRematch={onRequestRematch} onQuit={onQuit} />}

      {/* Terminal — either player quitting from the dialog above ends the match outright, so this
      replaces it rather than layering on top, and tallies every round played this streak (see
      roundHistory) rather than just the one that just finished. */}
      {matchOver && <MatchOverDialog roundHistory={roundHistory} colors={colors} profileNames={profileNames} profileTags={profileTags} profileUnlocked={profileUnlockToast} gameMode={gameMode} onExit={onExit} rotation={rotation} />}

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
          <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }, rotation % 360 !== 0 && { transform: [{ rotate: `${rotation}deg` }] }]}>
            <Icon source='alert-circle-outline' size={64} color={themeColors.secondary} />
            <Text variant='headlineLarge' style={[styles.overlayTitle, { color: themeColors.secondary }]}>
              Quit Match?
            </Text>
            <RoundHistoryPips roundHistory={roundHistory} p1Color={colors[1]} p2Color={colors[2]} />
            <Button mode='contained' onPress={onCancelConfirmBack} style={styles.overlayButton} buttonColor={themeColors.primary} textColor={themeColors.onPrimary}>
              Cancel
            </Button>
            <Button mode='contained' onPress={safeBack} style={styles.overlayButton} buttonColor={themeColors.secondary} textColor={themeColors.onSecondary}>
              Quit
            </Button>
          </View>
        </View>
      )}

      {/* Back (onboarding only) + Settings chip buttons — moved here from GameRound for the
      identical reason as every other floating overlay in this component: they need the live
      `rotation` signal above, and computing that from a hook called directly in GameRound (rather
      than this, its sibling) would cascade a re-render into the board/touch subtree on every tilt.
      Square glyphs in square chips, so rotating the whole button (not just its icon) never distorts
      a hit box the way a non-square zone would — see this component's own doc on why dialogs rotate
      only their inner content instead. Positioned per useCornerLayout above — see its own doc for
      which modes want the fixed top corners vs. the shared vertical midline. */}
      {(phase === 'onboarding' || (phase === 'roundOver' && showResultDialog && !matchOver)) && (
        <>
          <View style={useCornerLayout ? styles.cornerLeftSlot : styles.leftSlot}>
            <IconButton icon='arrow-left' iconColor={chipFg} containerColor={chipBg} style={[styles.chipButton, chipRotation]} size={22} onPress={onBackPress} accessibilityLabel='Back' />
          </View>
          <View style={useCornerLayout ? styles.cornerRightSlot : styles.rightSlot}>
            <IconButton icon='cog' iconColor={chipFg} containerColor={chipBg} style={[styles.chipButton, chipRotation]} size={22} onPress={onSettingsOpen} accessibilityLabel='Settings' />
          </View>
        </>
      )}

      <SettingsDialog visible={settingsOpen} onDismiss={onSettingsDismiss} settings={userSettings} setSettings={setUserSettings} rotation={rotation} />
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

  // The board itself always uses the SAME split, regardless of how the phone is physically being
  // held — 'faceToFace' (P1 near/bottom, P2 far/top, moving toward each other along the tall axis),
  // never 'sideBySide'. This isn't a frozen live reading, it's a fixed constant: the render surface
  // is permanently portrait-shaped (the app is portrait-locked at the OS level, and unlike the
  // lobby, the board/touch layer is deliberately never wrapped in FakeLandscapeView — see
  // MatchOverlays' own comment on why that'd risk breaking swipe-to-turn), so it can never actually
  // become wide enough for a genuine left/right split to make sense — that would just carve the
  // same tall, narrow canvas into two unplayably thin vertical strips. p1OnRight is meaningless
  // alongside a permanently-'faceToFace' mode (nothing reads it when orientationMode is
  // 'faceToFace' — see wallPath, TouchInputLayer's zone split, PowerupHud's corner pick), so it's
  // just a fixed placeholder. The floating dialogs/countdown still visually rotate to match
  // whichever way the phone is actually held — see MatchOverlays, which reads that live signal
  // independently and applies it on top of this same fixed 'faceToFace' zone split.
  const [orientationMode] = useState<OrientationMode>('faceToFace')
  const [p1OnRight] = useState(true)

  const insets = useSafeAreaInsets()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const { gutterWidth } = computeContentBounds(windowWidth, MAX_BOARD_CONTENT_WIDTH)
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const colors = useMemo<Record<Player, string>>(() => ({ 1: themeColors.primary, 2: themeColors.secondary }), [themeColors.primary, themeColors.secondary])

  // Resolved once at mount from whichever profile each seat had selected at lobby handoff, exactly
  // like `settings` above (activeRoundSettings) — a mid-round profile change (there's no UI for one
  // during a match, but a saved profile could still be edited/deleted from another still-mounted
  // screen under expo-router) shouldn't retroactively alter a round already underway.
  const { profiles: savedProfiles, lastSelected } = useProfiles()
  // Seat 2's own lastSelected is deliberately ignored in vsCpu mode below — it's a single piece of
  // state persisted across mode switches (useProfiles.tsx), so a profile picked for local two-player
  // seat 2 in an earlier session can otherwise still be sitting there once the player switches to
  // vsCpu, where seat 2 is the CPU and has no profile-selection UI at all (LobbyPlayerPanel never
  // renders a ProfilePicker for a non-human seat). Without this gate that stale id would flow
  // straight into statsEngine.ts's profile-bump loop and MatchOverDialog's title, silently
  // attributing the CPU's own wins/losses to a human profile.
  const [profileIds] = useState<Partial<Record<Player, string>>>(() => {
    const ids: Partial<Record<Player, string>> = {}
    if (savedProfiles.some((p) => p.id === lastSelected[1])) ids[1] = lastSelected[1] as string
    if (settings?.gameMode !== 'vsCpu' && savedProfiles.some((p) => p.id === lastSelected[2])) ids[2] = lastSelected[2] as string
    return ids
  })
  const [profileNames] = useState<Partial<Record<Player, string>>>(() => {
    const names: Partial<Record<Player, string>> = {}
    const p1 = savedProfiles.find((p) => p.id === lastSelected[1])
    const p2 = settings?.gameMode !== 'vsCpu' ? savedProfiles.find((p) => p.id === lastSelected[2]) : undefined
    if (p1) names[1] = p1.name
    if (p2) names[2] = p2.name
    return names
  })
  // Same frozen-at-mount treatment as profileNames above, just the tag half of each seat's identity
  // — see MatchOverDialog's own achievementAvatar, the one place that needs both halves at once.
  const [profileTags] = useState<Partial<Record<Player, string>>>(() => {
    const tags: Partial<Record<Player, string>> = {}
    const p1 = savedProfiles.find((p) => p.id === lastSelected[1])
    const p2 = settings?.gameMode !== 'vsCpu' ? savedProfiles.find((p) => p.id === lastSelected[2]) : undefined
    if (p1) tags[1] = p1.tag
    if (p2) tags[2] = p2.tag
    return tags
  })

  // Chronological record of each round's outcome this match, oldest first — lives here rather than
  // inside GameRound purely as the existing home for it; GameRound itself stays mounted for the
  // whole match regardless of rotation (see its own comment), so nothing here is actually at risk
  // of a mid-match reset.
  const [roundHistory, setRoundHistory] = useState<RoundOutcome[]>([])
  const { recordRoundOutcome } = useGameStats()
  // vsCpu-only: each unlocked achievement gets its own tier-colored, tier-iconed toast (see
  // @rific/toaster's per-toast icon/color override) — there's only ever one human perspective to
  // address in that mode, so it never needs its own facing UI the way the two-player case does
  // (see profileUnlockToast just below).
  const { success: showAchievementToast } = useToast()
  // Two-player only — seat -> that seat's own profile's newly-unlocked achievements this round,
  // read by RoundOverDialog/MatchOverDialog to show a badge facing that player (see GameRoundProps'
  // own comment). Always overwritten every round, even to {}, since those dialogs stay on screen
  // far longer than a timer-based toast and can't rely on auto-dismiss to clear a stale badge.
  const [profileUnlockToast, setProfileUnlockToast] = useState<Partial<Record<Player, AchievementDefinition[]>>>({})
  const handleRoundOutcome = useCallback(
    (outcome: RoundOutcome) => {
      setRoundHistory((history) => [...history, outcome])
      // settings is only null before the initial-mount redirect below (see the effect above) — by
      // the time a round can actually finish and report an outcome here, GameRound (which requires
      // non-null settings as a prop) is already what's rendering it.
      if (!settings) return
      const result = recordRoundOutcome(outcome, { gameMode: settings.gameMode, cpuDifficulty: settings.cpuDifficulty, colors, profileIds })

      if (settings.gameMode === 'vsCpu') {
        // Only seat 1 is ever human here, so its own profile-scoped unlocks (if any) join the same
        // toasts the device-wide ones already use, rather than needing a separate facing UI —
        // there's no "other side" to distinguish it from.
        const merged = [...result.device, ...(result.profiles[1] ?? [])]
        const caption = profileNames[1] ? `${profileNames[1]} unlocked` : 'Achievement unlocked'
        merged.forEach((achievement) => showAchievementToast(achievement.title, caption, undefined, { color: ACHIEVEMENT_TIER_COLORS[achievement.tier], icon: achievement.icon }))
        setProfileUnlockToast({})
      } else {
        // Device-wide achievements have no per-seat owner, but both seats are human here and each
        // already gets its own rotated card (see RoundOverDialog/MatchOverDialog) — broadcasting
        // into both seats' own profileUnlockToast entries is what actually faces P2 correctly,
        // rather than the shared, unrotated toast neither seat's zone actually belongs to.
        const broadcast = { ...result.profiles }
        if (result.device.length > 0) {
          broadcast[1] = [...(broadcast[1] ?? []), ...result.device]
          broadcast[2] = [...(broadcast[2] ?? []), ...result.device]
        }
        setProfileUnlockToast(broadcast)
      }
    },
    [recordRoundOutcome, settings, colors, profileIds, profileNames, showAchievementToast]
  )

  // The board area's edge IS the wall — running off it is a crash like any trail, and GameBoard
  // draws a thin two-color outline at the grid's actual pixel bounds to mark exactly where that
  // edge is. Bounded to exactly the safe area by default (the insets below) plus a @tastic/core
  // gutter (gutterWidth above) on anything wider than MAX_BOARD_CONTENT_WIDTH, so that outline
  // always sits somewhere a player can actually see and reach AND the arena never stretches into an
  // unplayably wide, short rectangle on a maximized desktop-web window; extendIntoSafeArea (a
  // per-round lobby setting — see GameSettings' own comment) opts into bleeding the board all the
  // way to the physical screen edge instead, ignoring both the safe area and the gutter and trading
  // that margin for more play space.
  // This container's own bounds (the style below) are fully live, same as insets/gutterWidth
  // themselves — they track the window on every render, no freezing at all at this level.
  // designSize below captures a frozen ONE-TIME measurement instead — what GameRound's actual
  // grid/game state gets built from (see GameRoundProps' own comment on why THAT can never change
  // mid-round). GameRound also gets this container's current LIVE size (liveWidth/liveHeight,
  // computed further below, past the `if (!settings)` guard) and does the live-scaling itself (see
  // its own boardScale comment) — resizing the window after a round has already started grows/
  // shrinks the board in place instead of doing nothing, without the frozen grid underneath ever
  // finding out anything changed. A previous version of this froze the CONTAINER too (matching the
  // grid), on the theory that only a device rotation — already prevented by the orientation lock
  // above — could ever invalidate a one-time measurement; that reasoning quietly stopped covering
  // the real world the moment gutterWidth made plain window resizing (always possible on web, no
  // rotation involved at all) something worth reacting to.
  const [designSize, setDesignSize] = useState<{ width: number; height: number } | null>(null)
  const onBoardLayout = useCallback((e: LayoutChangeEvent) => {
    // Captured eagerly, not read off `e` inside the updater below — React can invoke a functional
    // setState updater more than once (e.g. StrictMode's double-invoke), and by a second call
    // React Native's synthetic LayoutChangeEvent may already be pooled/recycled, leaving
    // e.nativeEvent null and crashing this on "Cannot read property 'layout' of null".
    const { width, height } = e.nativeEvent.layout
    setDesignSize((prev) => prev ?? { width, height })
  }, [])

  const bg = dark ? '#000000' : '#FFFFFF'

  if (!settings) return null

  // The container's LIVE content box, as plain numbers — the exact same arithmetic boardArea's own
  // style just below already expresses (insets+gutterWidth when not full-bleed, the raw window
  // otherwise), just computed directly from useWindowDimensions()/useSafeAreaInsets() rather than
  // measured via a second onBoardLayout firing. A second-measurement version (mirroring designSize
  // above but never freezing) was tried first and doesn't hold up: onLayout — RN-Web's
  // ResizeObserver under the hood — doesn't reliably re-fire on a bare window resize when
  // boardArea's own style is the referentially-stable styles.boardAreaFullBleed constant, confirmed
  // directly by comparing the two side by side: windowWidth/gutterWidth above tracked every resize
  // correctly the whole time, while that version's live measurement stayed stuck at whatever it had
  // last fired with — reliably reproducible specifically in extendIntoSafeArea's full-bleed branch,
  // where boardArea's own style object never changes, so nothing about its inline style ever gives
  // RN-Web a reason to re-measure. Computing it directly here sidesteps that reliability gap
  // entirely, at the cost of duplicating this one arithmetic expression rather than measuring it
  // once.
  const liveWidth = settings.extendIntoSafeArea ? windowWidth : windowWidth - insets.left - insets.right - 2 * gutterWidth
  const liveHeight = settings.extendIntoSafeArea ? windowHeight : windowHeight - insets.top - insets.bottom

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Per-screen override, not a global default — reverts to whatever _layout.tsx's own
      RotationAwareStatusBar says the instant this screen unmounts (navigating back to /lobby,
      which never renders its own StatusBar). Only hidden here when the board is actually bleeding
      under it (extendIntoSafeArea); otherwise the board stays within the safe area and the status
      bar has nothing to clash with, so there's nothing to add on top of the rotation-driven default. */}
      {settings.extendIntoSafeArea && <StatusBar hidden />}
      <View style={[styles.boardArea, settings.extendIntoSafeArea ? styles.boardAreaFullBleed : { top: insets.top, bottom: insets.bottom, left: insets.left + gutterWidth, right: insets.right + gutterWidth }]} onLayout={onBoardLayout}>
        {designSize && <GameRound width={designSize.width} height={designSize.height} liveWidth={liveWidth} liveHeight={liveHeight} settings={settings} colors={colors} profileNames={profileNames} profileTags={profileTags} profileUnlockToast={profileUnlockToast} orientationMode={orientationMode} p1OnRight={p1OnRight} roundHistory={roundHistory} onRoundOutcome={handleRoundOutcome} />}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // alignItems/justifyContent center the design-resolution board (see GameRound's own boardScale
  // comment) inside these live bounds — MatchOverlays/PowerupHud's own children are all
  // position:'absolute' internally (see their own styles), so centering this container has no
  // effect on them; only the board's normal-flow scaled View is actually being centered.
  boardArea: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'absolute' },
  boardAreaFullBleed: { bottom: 0, left: 0, right: 0, top: 0 },
  // Cancels IconButton's own built-in 6px margin (react-native-paper's default Surface spacing),
  // same reasoning as BoxHockey's identical chipButton style — otherwise a visible gap opens up
  // between the solid chip and its slot now that there's a background to see the edge of.
  chipButton: { margin: 0 },
  // The useCornerLayout counterpart to leftSlot/rightSlot below — a fixed distance from the top
  // instead of centered on the board's vertical midline, for whichever modes don't need a neutral
  // shared position (see useCornerLayout's own doc for which).
  cornerLeftSlot: { left: 4, position: 'absolute', top: 8 },
  cornerRightSlot: { position: 'absolute', right: 4, top: 8 },
  // top: 0 + bottom: 0 + justifyContent: 'center' centers the button on the board's vertical
  // midline regardless of its height, instead of pinning it a fixed distance from the top the way
  // cornerLeftSlot/cornerRightSlot above do for the other layout mode. A bare View here doesn't
  // claim any touch of its own, so it can span the full board height without stealing swipes from
  // TouchInputLayer underneath — only the IconButton it wraps is actually touchable.
  leftSlot: { bottom: 0, justifyContent: 'center', left: 4, position: 'absolute', top: 0 },
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
    maxWidth: 360,
    padding: 32
  },
  // headlineLarge's own line-height leaves slack under the glyphs that the flex `gap` above stacks
  // on top of, reading as extra room below the title specifically (most visible once the pip row
  // sits right after it, next to a button with no such slack) — this claws it back.
  overlayTitle: { fontWeight: 'bold', marginBottom: -8 },
  rightSlot: { bottom: 0, justifyContent: 'center', position: 'absolute', right: 4, top: 0 },
  root: { flex: 1 }
})
