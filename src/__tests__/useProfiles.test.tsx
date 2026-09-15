import { profilesActions } from '@tastic/profile'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { ReactNode } from 'react'
import { Provider as ReduxProvider } from 'react-redux'

import { ProfilesProvider, useProfiles } from '@/hooks/useProfiles'
import { profileSelectionActions } from '@/redux/profileSelectionSlice'
import { store } from '@/redux/store'
import { Profile } from '@/types'

// `profiles`/`profileSelection`/`profileExtensions` all live in the real Redux `store` now (see
// redux/store.ts) rather than per-component useState, so a real <ReduxProvider> is required — same
// reasoning as _layout.test.tsx elsewhere in the fleet (see Snake's own version). Because `store` is
// a module-level singleton, it does NOT reset itself between renderHook mounts the way the old
// useState-backed provider did, so each test below resets the slices it depends on in beforeEach
// instead of the old pattern of mounting a second provider to simulate an app relaunch — genuine
// cross-relaunch persistence is now redux-persist's own well-tested responsibility (see store.ts's
// persistReducer, no blacklist), not something this file re-verifies.
//
// isSharedProfileStoreAvailable (see @tastic/profile's sharedProfileStore.ts) resolves to false
// under Jest — no TasticProfile native module is ever registered here — so every case below
// exercises the local-fallback path through resolveInitialProfiles/useSharedProfilesSync.

const NEW_PROFILE = { name: 'Ada', color: '#3B82F6', tag: 'AD', keyScheme: 'wasd' as const }

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ReduxProvider store={store}>
      <ProfilesProvider>{children}</ProfilesProvider>
    </ReduxProvider>
  )
}

// Waits out ProfilesProvider's own one-time mount effect (resolveInitialProfiles, see
// useProfiles.tsx) before a test starts dispatching — otherwise that effect's own
// setAll(<mount-time snapshot>) could resolve later and clobber a write the test made in between.
async function mountProfiles() {
  const rendered = await renderHook(() => useProfiles(), { wrapper })
  await waitFor(() => expect(rendered.result.current.profiles).toBeDefined())
  return rendered
}

describe('useProfiles', () => {
  beforeEach(() => {
    store.dispatch(profilesActions.setAll([]))
    store.dispatch(profileSelectionActions.select({ profileId: null, seat: 1 }))
    store.dispatch(profileSelectionActions.select({ profileId: null, seat: 2 }))
  })

  it('creates a profile with the given keyScheme and makes it selectable', async () => {
    const { result } = await mountProfiles()

    let created!: Profile
    await act(async () => {
      created = result.current.createProfile(NEW_PROFILE)
    })
    expect(created.keyScheme).toBe('wasd')
    expect(result.current.profiles.find((p) => p.id === created.id)?.keyScheme).toBe('wasd')

    await act(async () => {
      result.current.selectProfile(1, created.id)
    })
    expect(result.current.lastSelected[1]).toBe(created.id)
  })

  it('tracks each seat’s selection independently', async () => {
    const { result } = await mountProfiles()

    let p1!: Profile
    let p2!: Profile
    await act(async () => {
      p1 = result.current.createProfile(NEW_PROFILE)
    })
    await act(async () => {
      p2 = result.current.createProfile({ ...NEW_PROFILE, name: 'Grace', tag: 'GH' })
    })
    await act(async () => {
      result.current.selectProfile(1, p1.id)
    })
    await act(async () => {
      result.current.selectProfile(2, p2.id)
    })

    expect(result.current.lastSelected).toEqual({ 1: p1.id, 2: p2.id })
  })

  it('clears a seat back to guest', async () => {
    const { result } = await mountProfiles()

    let created!: Profile
    await act(async () => {
      created = result.current.createProfile(NEW_PROFILE)
    })
    await act(async () => {
      result.current.selectProfile(1, created.id)
    })
    await act(async () => {
      result.current.selectProfile(1, null)
    })
    expect(result.current.lastSelected[1]).toBeNull()
  })

  it('updates base fields without touching keyScheme', async () => {
    const { result } = await mountProfiles()

    let created!: Profile
    await act(async () => {
      created = result.current.createProfile(NEW_PROFILE)
    })
    await act(async () => {
      result.current.updateProfile(created.id, { name: 'Ada Lovelace' })
    })

    const updated = result.current.profiles.find((p) => p.id === created.id)
    expect(updated?.name).toBe('Ada Lovelace')
    expect(updated?.keyScheme).toBe('wasd')
  })

  it('updates keyScheme via a patch-of-one without touching base fields or leaking into the shared roster', async () => {
    const { result } = await mountProfiles()

    let created!: Profile
    await act(async () => {
      created = result.current.createProfile(NEW_PROFILE)
    })
    await act(async () => {
      result.current.updateProfile(created.id, { keyScheme: 'arrows' })
    })

    const updated = result.current.profiles.find((p) => p.id === created.id)
    expect(updated?.keyScheme).toBe('arrows')
    expect(updated?.name).toBe('Ada')
    // keyScheme is local-only — @tastic/profile's own `profiles` slice (the shared/base roster)
    // must never see it.
    expect(store.getState().profiles.find((p) => p.id === created.id)).not.toHaveProperty('keyScheme')
  })

  it('reverts a seat to guest and removes the keyScheme extension when its profile is deleted', async () => {
    const { result } = await mountProfiles()

    let created!: Profile
    await act(async () => {
      created = result.current.createProfile(NEW_PROFILE)
    })
    await act(async () => {
      result.current.selectProfile(2, created.id)
    })
    expect(result.current.lastSelected[2]).toBe(created.id)

    await act(async () => {
      result.current.deleteProfile(created.id)
    })

    expect(result.current.lastSelected[2]).toBeNull()
    expect(result.current.profiles.map((p) => p.id)).not.toContain(created.id)
    // Regression coverage for the stale-closure bug class separate Redux slices rule out (see
    // profileExtensionsSlice's own doc): deleting a profile must clean up its keyScheme extension
    // too, not just the base roster entry — otherwise a future profile reusing the same id would
    // silently resurrect a deleted keyScheme.
    expect(store.getState().profileExtensions[created.id]).toBeUndefined()
  })

  it('falls back to the default keyScheme for a profile with no local extension entry', async () => {
    // Simulates a profile that arrived via the shared App Group roster — from a sibling app, or
    // another install of this one — that has never had a keyScheme set locally on THIS device.
    // profilesActions.setAll bypasses createProfile entirely, so no profileExtensions entry exists.
    const seeded = { color: '#10B981', createdAt: 1, id: 'shared-only-profile', name: 'Grace', tag: 'GH', updatedAt: 1 }
    store.dispatch(profilesActions.setAll([seeded]))

    const { result } = await mountProfiles()

    expect(result.current.profiles.find((p) => p.id === seeded.id)?.keyScheme).toBe('wasd')
  })
})
