import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR } from '@/constants/game'
import { Player } from '@/types'

// lobby.tsx's own last-picked color per human seat, remembered only for whichever round that seat
// was a guest (no profile selected) — a profile-selected seat's color always comes live from the
// profile itself instead (see lobby.tsx's own mount/reapply effect), never from here. Same shape/
// semantics as Snake's redux/gameSlice.ts lastGuestColor/lastCpuColor, and as this app's own
// previous hooks/useSeatColors.ts (now deleted) already provided via AsyncStorage — this slice is
// just that same dedicated "remember this for next time" memory, now Redux-backed like every other
// persisted preference in the fleet. Independent of the `theme` slice (store.ts/Theme.tsx), which is
// now just a harmless, redundant boot-seed of whatever the live theme last was.
export type SeatColorsState = {
  lastGuestColor: Record<Player, string>
  // Same idea as lastGuestColor, but for seat 2's CPU slot in vs-CPU mode — kept separate so a CPU
  // opponent's last color and a human guest's last color don't fight over one remembered value
  // (seat 1 is never CPU — see lobby.tsx's own p2IsHuman).
  lastCpuColor: string
}

export const defaultSeatColorsState: SeatColorsState = {
  lastGuestColor: { 1: DEFAULT_P1_COLOR, 2: DEFAULT_P2_COLOR },
  lastCpuColor: DEFAULT_P2_COLOR
}

const slice = createSlice({
  name: 'seatColors',
  initialState: defaultSeatColorsState,
  reducers: {
    setLastGuestColor: (state, action: PayloadAction<{ seat: Player; color: string }>) => ({
      ...state,
      lastGuestColor: { ...state.lastGuestColor, [action.payload.seat]: action.payload.color }
    }),
    setLastCpuColor: (state, action: PayloadAction<string>) => ({ ...state, lastCpuColor: action.payload })
  }
})

export const seatColorsActions = slice.actions
export default slice.reducer
