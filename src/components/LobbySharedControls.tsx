import { MenuOption, PopoverHost, SectionedDropdown, usePopoverHost } from '@tastic/hud'
import { StyleSheet, View } from 'react-native'

import { ArenaVariant, GridSizeTier, PowerupType, SpeedTier, TrailSpeedTier } from '@/types'

interface Props {
  // Shared popover host — see LobbyPlayerPanel's identical `host` prop. Passed in vs-CPU mode so
  // grid size/speed/etc. are mutually exclusive with the player panels' own color/control pickers
  // too (there's only one human driving the whole screen there, so simultaneity across every
  // picker just adds clutter). Omit to fall back to this component's own independent host.
  host?: PopoverHost
  gridSizeTier: GridSizeTier
  gridSizeOptions: MenuOption<GridSizeTier>[]
  onGridSizeChange: (value: GridSizeTier) => void
  speedTier: SpeedTier
  speedOptions: MenuOption<SpeedTier>[]
  onSpeedChange: (value: SpeedTier) => void
  trailSpeedTier: TrailSpeedTier
  trailSpeedOptions: MenuOption<TrailSpeedTier>[]
  onTrailSpeedChange: (value: TrailSpeedTier) => void
  // Static obstacle layout for the round's board — see utils/arenas.ts's buildArenaObstacles.
  arenaVariant: ArenaVariant
  arenaOptions: MenuOption<ArenaVariant>[]
  onArenaChange: (value: ArenaVariant) => void
  // Bundled into the same popover as arenaVariant/arenaOptions above (see this component's own
  // 'arena' SectionedDropdown) rather than getting its own trigger — a single-item multi-select
  // section riding alongside the arena single-select, converted to/from a plain boolean at this
  // prop boundary. See GameSettings.extendIntoSafeArea's own comment for what it does.
  extendIntoSafeArea: boolean
  extendIntoSafeAreaOption: MenuOption<'on'>
  onExtendIntoSafeAreaChange: (value: boolean) => void
  // Same bundled-multi-select technique as extendIntoSafeArea above, riding in the same 'arena'
  // popover as a third section. See GameSettings.wrapEdges' own comment for what it does.
  wrapEdges: boolean
  wrapEdgesOption: MenuOption<'on'>
  onWrapEdgesChange: (value: boolean) => void
  // Which powerup types can spawn this round — "off" is simply an empty array (see GameSettings'
  // own comment), so this one multi-select control covers both at once rather than needing a
  // separate on/off toggle alongside it.
  enabledPowerups: PowerupType[]
  powerupOptions: MenuOption<PowerupType>[]
  onPowerupsChange: (value: PowerupType[]) => void
  // Both one-shot actions on the settings above as a whole, not a value this row itself tracks —
  // see MATCH_ACTION_OPTIONS' own comment for how that's rendered without a persistent "selected"
  // row despite reusing SectionedDropdown's single-select machinery.
  onRandomize: () => void
  onReset: () => void
  accentColor: string
  mutedColor: string
  // Foreground for a selected row's icon/text — see SectionedDropdown's identical prop. This layer
  // always has a real theme onTertiary to hand over (accentColor is themeColors.tertiary), so it's
  // required here rather than left to SectionedDropdown's own per-player-color fallback.
  onAccentColor: string
  dark: boolean
}

// Always-upright band of shared (not per-player) settings, sitting between the two rotated/split
// player zones in the two-player lobby. Owns its own popover host, independent from either
// player's own panel (so it never blocks and is never blocked by a player's own pickers), unless a
// `host` is passed in to share with the player panels instead (vs-CPU mode).
// This component's own popover ids — used to check membership below, not just "is anything open on
// the host", since a shared host (vs-CPU) also carries the player panels' own popover ids.
const OWN_IDS = ['gridSize', 'arena', 'speed', 'trailSpeed', 'powerups', 'matchActions']

// Not a real setting — 'none' only exists so this section's `value` can point at something no
// option ever matches, keeping every row permanently unselected (no accent highlight, no lit
// TriggerGaugeHost segment) despite riding SectionedDropdown's single-select section, which
// otherwise assumes there's always a "current" value to show selected. Tapping either real option
// still auto-dismisses the popover exactly like any other single-select (see SectionedDropdown's
// own onSelect), which a multi-select section (this row's other bundled-toggle technique — see
// extendIntoSafeArea/wrapEdges above) wouldn't give us for what are one-shot actions, not toggles.
type MatchAction = 'randomize' | 'reset' | 'none'
const MATCH_ACTION_OPTIONS: MenuOption<MatchAction>[] = [
  { value: 'randomize', label: 'Randomize', icon: 'dice-multiple' },
  { value: 'reset', label: 'Reset to Defaults', icon: 'restore' }
]

export function LobbySharedControls({ host: sharedHost, gridSizeTier, gridSizeOptions, onGridSizeChange, speedTier, speedOptions, onSpeedChange, trailSpeedTier, trailSpeedOptions, onTrailSpeedChange, arenaVariant, arenaOptions, onArenaChange, extendIntoSafeArea, extendIntoSafeAreaOption, onExtendIntoSafeAreaChange, wrapEdges, wrapEdgesOption, onWrapEdgesChange, enabledPowerups, powerupOptions, onPowerupsChange, onRandomize, onReset, accentColor, mutedColor, onAccentColor, dark }: Props) {
  const ownHost = usePopoverHost()
  const host = sharedHost ?? ownHost
  // See LobbyPlayerPanel's identical ownPopoverOpen comment — elevating this row for *any* open
  // popover on a shared host (rather than only its own) would tie it with whichever sibling panel
  // actually has the open popover, letting DOM order wrongly decide which one paints on top.
  const ownPopoverOpen = host.openId !== null && OWN_IDS.includes(host.openId)

  return (
    <View style={[styles.row, ownPopoverOpen && styles.rowOpen]}>
      <SectionedDropdown id='gridSize' host={host} icon='grid' accessibilityLabel='Grid size' sections={[{ kind: 'single', id: 'gridSize', options: gridSizeOptions, value: gridSizeTier, onChange: onGridSizeChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

      {/* Bundled popover: a single-select section for the arena layout itself, plus two one-item
      multi-select sections riding along for the unrelated (but similarly board-shape-ish)
      extend-into-safe-area and wrap-edges toggles — same technique the powerups row below uses for
      its own array<->boolean semantics, just with only one possible member instead of six. */}
      <SectionedDropdown
        id='arena'
        host={host}
        icon='crop-square'
        accessibilityLabel='Arena'
        sections={[
          { kind: 'single', id: 'arenaVariant', options: arenaOptions, value: arenaVariant, onChange: onArenaChange },
          { kind: 'multi', id: 'extendIntoSafeArea', options: [extendIntoSafeAreaOption], value: extendIntoSafeArea ? ['on'] : [], onChange: (value) => onExtendIntoSafeAreaChange(value.length > 0) },
          { kind: 'multi', id: 'wrapEdges', options: [wrapEdgesOption], value: wrapEdges ? ['on'] : [], onChange: (value) => onWrapEdgesChange(value.length > 0) }
        ]}
        accentColor={accentColor}
        mutedColor={mutedColor}
        onAccentColor={onAccentColor}
        dark={dark}
      />

      <SectionedDropdown id='speed' host={host} icon='speedometer' accessibilityLabel='Speed' sections={[{ kind: 'single', id: 'speed', options: speedOptions, value: speedTier, onChange: onSpeedChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

      {/* Speed ramp toggle hidden for now — settings.speedRampEnabled stays wired through
      gameEngine/validation/useGameState and defaults to false, so this is a pure UI hide, not a
      feature removal. Re-add the toggle here (and its props above) to bring it back. */}

      <SectionedDropdown id='trailSpeed' host={host} icon='chart-line' accessibilityLabel='Trail speed' sections={[{ kind: 'single', id: 'trailSpeed', options: trailSpeedOptions, value: trailSpeedTier, onChange: onTrailSpeedChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

      <SectionedDropdown id='powerups' host={host} icon='flash' accessibilityLabel={`Powerups ${enabledPowerups.length > 0 ? 'on' : 'off'}`} sections={[{ kind: 'multi', id: 'powerups', options: powerupOptions, value: enabledPowerups, onChange: onPowerupsChange, allClear: true }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

      <SectionedDropdown
        id='matchActions'
        host={host}
        icon='dice-multiple'
        accessibilityLabel='Randomize or reset match settings'
        sections={[
          {
            kind: 'single',
            id: 'matchActions',
            options: MATCH_ACTION_OPTIONS,
            value: 'none',
            onChange: (value: MatchAction) => {
              if (value === 'randomize') onRandomize()
              else if (value === 'reset') onReset()
            }
          }
        ]}
        accentColor={accentColor}
        mutedColor={mutedColor}
        onAccentColor={onAccentColor}
        dark={dark}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    // Safety net against a narrow device: a row of fixed-size triggers with no wrap just runs off
    // the screen edge with nothing to catch it, taking the last trigger or two with it —
    // untappable, not just clipped. Wrap turns that into "drops to a second centered line" instead.
    // See BoxHockey's LoadoutSharedControls (its own row style) for the sibling fix and the actual
    // measurement that prompted it.
    flexWrap: 'wrap',
    // Wider than a plain icon row would need, to give each trigger's TriggerGauge arc — pulled in
    // close around the icon itself (see TriggerGauge's own ARC_GAP) — room to breathe against its
    // neighbors instead of the two arcs crowding each other.
    gap: 20,
    justifyContent: 'center'
  },
  // See SectionedDropdown's anchorOpen comment — this row is itself a sibling of the player panels in
  // lobby.tsx, and React Native Web's per-view stacking contexts mean a popover escaping this row's
  // bounds needs the row itself elevated, not just the popover content, to paint above a later
  // sibling panel.
  rowOpen: {
    zIndex: 100
  }
})
