import { IconButton } from '@rific/feedback-press'
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
  // 'arena' SectionedDropdown) rather than getting its own trigger — riding alongside the arena
  // single-select as a second, multi-select section shared with wrapEdges below (one section, two
  // rows, no divider between them — they're both simple board-shape toggles, not settings that need
  // separating from each other the way they're separated from the layout picker above). Converted
  // to/from a plain boolean at this prop boundary. See GameSettings.extendIntoSafeArea's own comment
  // for what it does.
  extendIntoSafeArea: boolean
  extendIntoSafeAreaOption: MenuOption<'extendIntoSafeArea'>
  onExtendIntoSafeAreaChange: (value: boolean) => void
  // Same bundled-multi-select section as extendIntoSafeArea directly above (not a separate section
  // of its own — see that prop's comment for why). See GameSettings.wrapEdges' own comment for what
  // this one does.
  wrapEdges: boolean
  wrapEdgesOption: MenuOption<'wrapEdges'>
  onWrapEdgesChange: (value: boolean) => void
  // Which powerup types can spawn this round — "off" is simply an empty array (see GameSettings'
  // own comment), so this one multi-select control covers both at once rather than needing a
  // separate on/off toggle alongside it.
  enabledPowerups: PowerupType[]
  powerupOptions: MenuOption<PowerupType>[]
  onPowerupsChange: (value: PowerupType[]) => void
  // Both one-shot actions on the settings above as a whole, not a value with a "current state" to
  // show — rendered as plain IconButtons in their own row right below the trigger gauges (not a
  // TriggerGauge/SectionedDropdown trigger itself, which would misleadingly suggest a selected
  // value to land on). Optional (and always passed as a pair) — lobby.tsx's own showMetaInSharedBand
  // case renders these itself, inline in its merged back/dice/reset/settings header row, so this
  // component leaves its own row out entirely rather than showing the same two actions twice.
  onRandomize?: () => void
  onReset?: () => void
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
// the host", since a shared host (vs-CPU) also carries the player panels' own popover ids. Exported
// so lobby.tsx's own showMetaInSharedBand wrapper (sharedColumn) can run this same membership check
// on itself — see that wrapper's own comment for why it needs to.
export const LOBBY_SHARED_CONTROLS_IDS = ['gridSize', 'arena', 'speed', 'trailSpeed', 'powerups']

export function LobbySharedControls({ host: sharedHost, gridSizeTier, gridSizeOptions, onGridSizeChange, speedTier, speedOptions, onSpeedChange, trailSpeedTier, trailSpeedOptions, onTrailSpeedChange, arenaVariant, arenaOptions, onArenaChange, extendIntoSafeArea, extendIntoSafeAreaOption, onExtendIntoSafeAreaChange, wrapEdges, wrapEdgesOption, onWrapEdgesChange, enabledPowerups, powerupOptions, onPowerupsChange, onRandomize, onReset, accentColor, mutedColor, onAccentColor, dark }: Props) {
  const ownHost = usePopoverHost()
  const host = sharedHost ?? ownHost
  // See LobbyPlayerPanel's identical ownPopoverOpen comment — elevating this row for *any* open
  // popover on a shared host (rather than only its own) would tie it with whichever sibling panel
  // actually has the open popover, letting DOM order wrongly decide which one paints on top.
  const ownPopoverOpen = host.openId !== null && LOBBY_SHARED_CONTROLS_IDS.includes(host.openId)
  // Same fg convention as every other component keying off a `dark` prop (LabeledDropdown,
  // SettingsDialog, etc.) — full-contrast, unlike mutedColor/accentColor above, which are tuned for
  // a TriggerGauge's own unselected/selected states rather than a plain icon button.
  const fg = dark ? '#FFFFFF' : '#000000'

  return (
    <View style={[styles.container, ownPopoverOpen && styles.containerOpen]}>
      {onRandomize && onReset && (
        <View style={styles.actionsRow}>
          <IconButton icon='dice-multiple' iconColor={fg} size={18} onPress={onRandomize} accessibilityLabel='Randomize match settings' />
          <IconButton icon='restore' iconColor={fg} size={18} onPress={onReset} accessibilityLabel='Reset match settings to defaults' />
        </View>
      )}

      <View style={styles.row}>
        {/* Board/map settings first, size second — matches BoxHockey's LoadoutSharedControls,
      whose own board+rink dropdown leads its row the same way, ahead of anything that just tunes
      an already-chosen board. Bundled popover: a single-select section for the arena layout
      itself, plus one multi-select section (two rows, one toggle each) for the unrelated (but
      similarly board-shape-ish) extend-into-safe-area and wrap-edges toggles — same technique the
      powerups row below uses for its own array<->boolean semantics, just two possible members
      instead of six. */}
        <SectionedDropdown
          id='arena'
          host={host}
          icon='crop-square'
          accessibilityLabel='Arena'
          sections={[
            { kind: 'single', id: 'arenaVariant', options: arenaOptions, value: arenaVariant, onChange: onArenaChange },
            {
              kind: 'multi',
              id: 'boardToggles',
              options: [extendIntoSafeAreaOption, wrapEdgesOption],
              value: [...(extendIntoSafeArea ? [extendIntoSafeAreaOption.value] : []), ...(wrapEdges ? [wrapEdgesOption.value] : [])],
              onChange: (value) => {
                onExtendIntoSafeAreaChange(value.includes(extendIntoSafeAreaOption.value))
                onWrapEdgesChange(value.includes(wrapEdgesOption.value))
              }
            }
          ]}
          accentColor={accentColor}
          mutedColor={mutedColor}
          onAccentColor={onAccentColor}
          dark={dark}
        />

        <SectionedDropdown id='gridSize' host={host} icon='grid' accessibilityLabel='Grid size' sections={[{ kind: 'single', id: 'gridSize', options: gridSizeOptions, value: gridSizeTier, onChange: onGridSizeChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

        <SectionedDropdown id='speed' host={host} icon='speedometer' accessibilityLabel='Speed' sections={[{ kind: 'single', id: 'speed', options: speedOptions, value: speedTier, onChange: onSpeedChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

        {/* Speed ramp toggle hidden for now — settings.speedRampEnabled stays wired through
      gameEngine/validation/useGameState and defaults to false, so this is a pure UI hide, not a
      feature removal. Re-add the toggle here (and its props above) to bring it back. */}

        <SectionedDropdown id='trailSpeed' host={host} icon='chart-line' accessibilityLabel='Trail speed' sections={[{ kind: 'single', id: 'trailSpeed', options: trailSpeedOptions, value: trailSpeedTier, onChange: onTrailSpeedChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

        <SectionedDropdown id='powerups' host={host} icon='flash' accessibilityLabel={`Powerups ${enabledPowerups.length > 0 ? 'on' : 'off'}`} sections={[{ kind: 'multi', id: 'powerups', options: powerupOptions, value: enabledPowerups, onChange: onPowerupsChange, allClear: true }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // Above the trigger row — small, secondary-weight (size 18 vs. the triggers' own icon size) so
  // Randomize/Reset read as quick actions on the settings below rather than a seventh setting of
  // equal standing. On top (not below) to match lobby.tsx's own showMetaInSharedBand header row,
  // which folds these same two actions in with back/settings above the triggers there too.
  actionsRow: {
    flexDirection: 'row',
    gap: 12
  },
  container: {
    alignItems: 'center',
    gap: 4
  },
  // See SectionedDropdown's anchorOpen comment — this whole column is itself a sibling of the player
  // panels in lobby.tsx, and React Native Web's per-view stacking contexts mean a popover escaping
  // the row below needs this wrapper elevated, not just the popover content, to paint above a later
  // sibling panel.
  containerOpen: {
    zIndex: 100
  },
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
  }
})
