import { createSeatColorsSlice, type SeatColorsState as SeatColorsStateGeneric } from '@tastic/profile'

import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR } from '@/constants/game'
import { Player } from '@/types'

// Thin binding over @tastic/profile's createSeatColorsSlice factory — this app's own hand-rolled
// seatColorsSlice.ts (lastGuestColor/lastCpuColor/profileOverride, one-for-one identical to
// AirHockey's/BoxHockey's/Pong's own copies apart from the seat type and default-color constants)
// was folded into that factory; see the factory's own doc for the full history, including why
// Snake's own copy — folded into its catch-all gameSlice.ts instead of a standalone slice — was
// intentionally left out of this generalization. This app was the one sibling that never actually
// made the switch when the factory landed; also picks up the factory's own REHYDRATE fix for free
// (a device with a persisted blob from before `profileOverride` existed used to rehydrate with
// `state.profileOverride === undefined`, crashing lobby.tsx's own `profileOverride[seat]` reads).
export type SeatColorsState = SeatColorsStateGeneric<Player>

export const defaultSeatColorsState: SeatColorsState = {
  lastGuestColor: { 1: DEFAULT_P1_COLOR, 2: DEFAULT_P2_COLOR },
  lastCpuColor: DEFAULT_P2_COLOR,
  profileOverride: { 1: null, 2: null }
}

const { actions, reducer } = createSeatColorsSlice<Player>('lightcycles', defaultSeatColorsState)

export const seatColorsActions = actions
export default reducer
