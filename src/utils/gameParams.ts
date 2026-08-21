import { GameMode, GameSettings, Player } from '@/types'

// Extracted so /lobby can parse its own gameMode route param the same way, without duplicating
// this ternary.
export function parseGameMode(value: string | undefined): GameMode {
  return value === 'vsCpu' ? 'vsCpu' : 'twoPlayer'
}

// CPU always plays player 2 (see cpuAi.ts) — the human is player 1 whenever gameMode is 'vsCpu',
// getting the whole board as their input area (see TouchInputLayer's solo branch) instead of
// splitting it with a zone that has no one swiping on the other side of it. Takes just the
// gameMode field (not the full GameSettings) so /lobby can call this before it has assembled a
// complete settings object of its own.
export function humanPlayersFor(settings: Pick<GameSettings, 'gameMode'>): Player[] {
  return settings.gameMode === 'vsCpu' ? [1] : [1, 2]
}
