import { getBlendedColor } from '@rific/auto-paper'
import { IconButton, TouchableRipple } from '@rific/feedback-press'
import { StyleSheet, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'

import { PopoverBody } from '@/components/PopoverBody'
import { MONO_FONT } from '@/constants/fonts'
import { PopoverHost } from '@/hooks/usePopoverHost'
import { PowerupType } from '@/types'

const MENU_BORDER_WIDTH = 1
// Matches IconDropdown's own TRIGGER_SIZE — keeps this trigger's hit area and row alignment
// consistent with its sibling triggers in the shared-controls row.
const TRIGGER_SIZE = 44
const MENU_MIN_WIDTH = 200
const MENU_ITEM_ICON_SIZE = 18
const MENU_CHECK_ICON_SIZE = 20

export interface PowerupPickerOption {
  value: PowerupType
  label: string
  icon: string
}

interface Props {
  id: string
  host: PopoverHost
  options: PowerupPickerOption[]
  value: PowerupType[]
  onChange: (value: PowerupType[]) => void
  accentColor: string
  mutedColor: string
  dark: boolean
  // See PopoverBody's align prop — pass 'right' for a trigger that sits near the screen's right
  // edge, so its popover grows leftward instead of overflowing off-screen.
  align?: 'left' | 'right' | 'center'
}

// Multi-select sibling of IconDropdown, same trigger+popover shell — but tapping a row TOGGLES its
// membership in `value` instead of selecting-and-closing, so several types can be turned on/off in
// one open session. There's no separate "powerups on/off" concept here: an empty `value` already
// means "off" (see GameSettings' own comment and gameEngine.ts's maybeSpawnPickup, which only ever
// spawns from this list), so the trigger just reflects whether that list is non-empty.
export function PowerupPicker({ id, host, options, value, onChange, accentColor, mutedColor, dark, align }: Props) {
  const menuBg = dark ? '#000000' : '#FFFFFF'
  // See IconDropdown's identical comment — flattened once against this menu's own solid background
  // so the box border and caret ring paint identically, rather than double-blending a translucent
  // mutedColor into a visibly lighter patch where the caret overlaps the box's own top border.
  const menuBorderColor = getBlendedColor(mutedColor, menuBg, 0.5)

  const open = host.openId === id
  const anyEnabled = value.length > 0

  const toggle = (v: PowerupType) => {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  }

  return (
    <View style={[styles.anchor, open && styles.anchorOpen]}>
      <View style={styles.triggerBox}>
        <IconButton icon='flash' iconColor={anyEnabled ? accentColor : mutedColor} size={22} accessibilityLabel={`Powerups ${anyEnabled ? 'on' : 'off'}`} onPress={() => host.toggle(id)} />
      </View>

      <PopoverBody visible={open} align={align} caretColor={menuBg} caretBorderColor={menuBorderColor} caretBorderWidth={MENU_BORDER_WIDTH} triggerSize={TRIGGER_SIZE}>
        <View style={[styles.menu, { backgroundColor: menuBg, borderColor: menuBorderColor }]}>
          {options.map((option) => {
            const selected = value.includes(option.value)
            const rowColor = selected ? '#000000' : mutedColor
            return (
              <TouchableRipple key={option.value} onPress={() => toggle(option.value)} style={[styles.item, selected && { backgroundColor: accentColor }]}>
                <View style={styles.itemRow}>
                  <Icon source={option.icon} size={MENU_ITEM_ICON_SIZE} color={rowColor} />
                  <Text variant='labelLarge' style={[styles.itemLabel, { fontFamily: MONO_FONT }, { color: rowColor, fontWeight: selected ? 'bold' : 'normal' }]}>
                    {option.label}
                  </Text>
                  <Icon source={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} size={MENU_CHECK_ICON_SIZE} color={rowColor} />
                </View>
              </TouchableRipple>
            )
          })}
        </View>
      </PopoverBody>
    </View>
  )
}

const styles = StyleSheet.create({
  anchor: {
    position: 'relative'
  },
  // See IconDropdown's identical comment — React Native Web gives every position:'relative' view
  // its own stacking context, so the elevation has to live on the anchor itself, not just the
  // popover content nested inside it, to correctly paint above this anchor's own later siblings.
  anchorOpen: {
    zIndex: 100
  },
  item: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  itemLabel: {
    flex: 1
  },
  itemRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  menu: {
    borderRadius: 12,
    borderWidth: MENU_BORDER_WIDTH,
    elevation: 8,
    gap: 4,
    minWidth: MENU_MIN_WIDTH,
    padding: 6,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8
  },
  // Matches IconDropdown's own triggerBox — fixed hit-area, consistent with its sibling triggers.
  triggerBox: {
    alignItems: 'center',
    height: TRIGGER_SIZE,
    justifyContent: 'center',
    width: TRIGGER_SIZE
  }
})
