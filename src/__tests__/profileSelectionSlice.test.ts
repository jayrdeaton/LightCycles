import reducer, { defaultProfileSelectionState, profileSelectionActions } from '@/redux/profileSelectionSlice'

describe('profileSelectionSlice', () => {
  it('defaults both seats to null', () => {
    expect(reducer(undefined, { type: '@@INIT' })).toEqual({ 1: null, 2: null })
  })

  describe('select', () => {
    it('sets seat 1 without touching seat 2', () => {
      const state = reducer(defaultProfileSelectionState, profileSelectionActions.select({ profileId: 'profile-1', seat: 1 }))
      expect(state).toEqual({ 1: 'profile-1', 2: null })
    })

    it('sets seat 2 without touching seat 1', () => {
      const state = reducer({ 1: 'profile-1', 2: null }, profileSelectionActions.select({ profileId: 'profile-2', seat: 2 }))
      expect(state).toEqual({ 1: 'profile-1', 2: 'profile-2' })
    })

    it('overwrites an existing selection for the same seat', () => {
      const state = reducer({ 1: 'profile-1', 2: null }, profileSelectionActions.select({ profileId: 'profile-3', seat: 1 }))
      expect(state[1]).toBe('profile-3')
    })

    it('clears a seat back to guest via profileId: null', () => {
      const state = reducer({ 1: 'profile-1', 2: null }, profileSelectionActions.select({ profileId: null, seat: 1 }))
      expect(state[1]).toBeNull()
    })
  })

  describe('clearProfile', () => {
    it('clears whichever seat points at the given id', () => {
      const state = reducer({ 1: 'profile-1', 2: null }, profileSelectionActions.clearProfile('profile-1'))
      expect(state).toEqual({ 1: null, 2: null })
    })

    it('clears both seats when they both point at the given id', () => {
      const state = reducer({ 1: 'profile-1', 2: 'profile-1' }, profileSelectionActions.clearProfile('profile-1'))
      expect(state).toEqual({ 1: null, 2: null })
    })

    it('leaves a seat pointing at a different id untouched', () => {
      const state = reducer({ 1: 'profile-1', 2: 'profile-2' }, profileSelectionActions.clearProfile('profile-1'))
      expect(state).toEqual({ 1: null, 2: 'profile-2' })
    })

    it('is a no-op when neither seat points at the given id', () => {
      const initial = { 1: 'profile-1', 2: 'profile-2' } as const
      const state = reducer(initial, profileSelectionActions.clearProfile('profile-does-not-exist'))
      expect(state).toEqual(initial)
    })
  })
})
