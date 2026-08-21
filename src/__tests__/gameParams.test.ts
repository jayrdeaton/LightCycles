import { humanPlayersFor, parseGameMode } from '@/utils/gameParams'

describe('parseGameMode', () => {
  it('parses "vsCpu" as vsCpu', () => {
    expect(parseGameMode('vsCpu')).toBe('vsCpu')
  })

  it('falls back to twoPlayer for anything else', () => {
    expect(parseGameMode('twoPlayer')).toBe('twoPlayer')
    expect(parseGameMode('coop')).toBe('twoPlayer')
    expect(parseGameMode(undefined)).toBe('twoPlayer')
  })
})

describe('humanPlayersFor', () => {
  it('gives both players input in twoPlayer mode', () => {
    expect(humanPlayersFor({ gameMode: 'twoPlayer' })).toEqual([1, 2])
  })

  it('gives only player 1 input in vsCpu mode', () => {
    expect(humanPlayersFor({ gameMode: 'vsCpu' })).toEqual([1])
  })
})
