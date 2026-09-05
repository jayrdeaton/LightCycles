import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { ReactNode } from 'react'

import { ProfilesProvider, useProfiles } from '@/hooks/useProfiles'
import { Profile } from '@/types'

// isSharedProfileStoreAvailable (see @tastic/profile's sharedProfileStore.ts) resolves to false
// under Jest — no TasticProfile native module is ever registered here — so every case below
// exercises the plain AsyncStorage-backed local path (`local.localBase`/`local.lastSelected`),
// same as a real Android/web install or a non-prebuilt iOS one. That's the actual regression this
// file guards: a seat's selected profile surviving a cold app relaunch.

const NEW_PROFILE = { name: 'Ada', color: '#3B82F6', tag: 'AD', keyScheme: 'wasd' as const }

function wrapper({ children }: { children: ReactNode }) {
  return <ProfilesProvider>{children}</ProfilesProvider>
}

// A fresh renderHook + wrapper pair is a fresh ProfilesProvider mount reading from scratch — the
// same cold-start path a real app relaunch takes — while AsyncStorage's own mock store (not reset
// between calls within a test) plays the part of the disk surviving that relaunch.
async function mountProfiles() {
  const rendered = await renderHook(() => useProfiles(), { wrapper })
  await waitFor(() => expect(rendered.result.current.profiles).toBeDefined())
  return rendered
}

describe('useProfiles persisted selection', () => {
  beforeEach(async () => {
    await AsyncStorage.clear()
  })

  it('keeps a seat’s selected profile after the provider remounts', async () => {
    const first = await mountProfiles()

    let created!: Profile
    await act(async () => {
      created = first.result.current.createProfile(NEW_PROFILE)
    })
    await act(async () => {
      first.result.current.selectProfile(1, created.id)
    })
    expect(first.result.current.lastSelected[1]).toBe(created.id)

    // Simulate an app relaunch: a brand-new provider instance, backed by whatever the first one
    // actually wrote to AsyncStorage rather than any in-memory state carried over from it.
    const second = await mountProfiles()

    expect(second.result.current.lastSelected[1]).toBe(created.id)
    expect(second.result.current.profiles.map((p) => p.id)).toContain(created.id)
  })

  it('persists each seat’s selection independently', async () => {
    const first = await mountProfiles()

    let p1!: Profile
    let p2!: Profile
    await act(async () => {
      p1 = first.result.current.createProfile(NEW_PROFILE)
    })
    await act(async () => {
      p2 = first.result.current.createProfile({ ...NEW_PROFILE, name: 'Grace', tag: 'GH' })
    })
    await act(async () => {
      first.result.current.selectProfile(1, p1.id)
    })
    await act(async () => {
      first.result.current.selectProfile(2, p2.id)
    })

    const second = await mountProfiles()
    expect(second.result.current.lastSelected).toEqual({ 1: p1.id, 2: p2.id })
  })

  it('persists clearing a seat back to no profile (guest)', async () => {
    const first = await mountProfiles()

    let created!: Profile
    await act(async () => {
      created = first.result.current.createProfile(NEW_PROFILE)
    })
    await act(async () => {
      first.result.current.selectProfile(1, created.id)
    })
    await act(async () => {
      first.result.current.selectProfile(1, null)
    })
    expect(first.result.current.lastSelected[1]).toBeNull()

    const second = await mountProfiles()
    expect(second.result.current.lastSelected[1]).toBeNull()
  })

  it('persists a seat reverting to guest when its selected profile is deleted', async () => {
    // Seeded directly into storage rather than via createProfile, so this test exercises only
    // deleteProfile's own persistence — not entangled with createProfile's own write path.
    const seeded: Profile = { id: 'profile-seed', name: 'Ada', color: '#3B82F6', tag: 'AD', createdAt: 1, updatedAt: 1, keyScheme: 'wasd' }
    await AsyncStorage.setItem(
      // Must match useProfiles.tsx's own (unexported) STORAGE_KEY.
      'lightcycles.profiles',
      JSON.stringify({ localBase: [{ id: seeded.id, name: seeded.name, color: seeded.color, tag: seeded.tag, createdAt: seeded.createdAt, updatedAt: seeded.updatedAt }], extensions: {}, lastSelected: { 1: null, 2: seeded.id } })
    )

    const first = await mountProfiles()
    expect(first.result.current.lastSelected[2]).toBe(seeded.id)

    await act(async () => {
      first.result.current.deleteProfile(seeded.id)
    })
    expect(first.result.current.lastSelected[2]).toBeNull()

    // Regression coverage for the stale-`local`-closure bug this file's own diff just fixed:
    // deleteProfile used to persist its localBase removal and its lastSelected/extensions cleanup
    // as two separate AsyncStorage writes built from the same pre-update `local`, so the second
    // write's stale localBase silently resurrected the just-deleted profile on reload.
    const second = await mountProfiles()
    expect(second.result.current.lastSelected[2]).toBeNull()
    expect(second.result.current.profiles.map((p) => p.id)).not.toContain(seeded.id)
  })
})
