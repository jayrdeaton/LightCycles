import { createProfileRecord, Profile as BaseProfile, profilesActions, resolveInitialProfiles, useSharedProfilesSync } from '@tastic/profile'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { profileExtensionsActions } from '@/redux/profileExtensionsSlice'
import { profileSelectionActions } from '@/redux/profileSelectionSlice'
import { type AppDispatch, type RootState } from '@/redux/store'
import { KeyScheme, Player, Profile } from '@/types'

// Same group id LightCycles and BoxHockey both declare in app.json's ios.entitlements (and any
// future @tastic game that wants into the same shared roster) — see @tastic/profile's own README
// for why only the BASE identity fields travel through this, never keyScheme.
const SHARED_GROUP_ID = 'group.com.infinitetoken.tastic'
// Matches DEFAULT_SETTINGS.keyScheme's own neutral default (see gameSettingsValidation.ts and
// app/profiles.tsx's own NEW_PROFILE_KEY_SCHEME) — what a profile that's never had one set locally
// on THIS app falls back to. That's exactly the state of any profile created on another @tastic app
// (BoxHockey has no concept of keyScheme at all) the very first time it's selected here.
const DEFAULT_KEY_SCHEME: KeyScheme = 'wasd'

interface CreateProfileInput {
  name: string
  color: string
  tag: string
  keyScheme: KeyScheme
}

interface ProfilesContextValue {
  profiles: Profile[]
  lastSelected: Record<Player, string | null>
  // True once the one-time initial reconciliation below (redux-persist's own already-rehydrated
  // `profiles` against the shared App Group store) has completed — see ProfilesProvider's own doc.
  // _layout.tsx's own ProfilesGate reads this to hold its children back (see splashGate.ts's
  // 'profiles' gate) until real profile data exists, rather than the empty starting state.
  loaded: boolean
  createProfile: (input: CreateProfileInput) => Profile
  updateProfile: (id: string, patch: Partial<CreateProfileInput>) => void
  // Also clears lastSelected for any seat currently pointing at this id, so the lobby immediately
  // reflects Player (no profile) for that seat rather than a dangling id until next reload.
  deleteProfile: (id: string) => void
  selectProfile: (seat: Player, profileId: string | null) => void
}

const ProfilesContext = createContext<ProfilesContextValue | null>(null)

interface Props {
  children: ReactNode
}

// Single source of truth for saved player profiles, mounted once in _layout.tsx — same
// single-Provider rationale as useGameSettings.tsx/useGameStats.tsx (expo-router keeps prior
// screens mounted, so a per-screen copy could go stale or clobber a concurrent update).
//
// Base identity fields (name/color/tag) now live in Redux (redux/store.ts's `profiles` key,
// @tastic/profile's own profilesReducer) — persisted locally the same way every other slice is
// (redux-persist), which is what gives it local-fallback behavior for platforms/builds where the
// shared App Group store isn't available, with no separate hand-rolled AsyncStorage path needed for
// that case anymore (see resolveInitialProfiles/useSharedProfilesSync below). keyScheme
// (LightCycles-specific — BoxHockey's analogous field is controlScheme) deliberately stays OUT of
// that shared slice — @tastic/profile's own Profile type is base-fields-only by design, host apps
// extend it on their own side — so it lives in its own small local-only redux/
// profileExtensionsSlice.ts, keyed by profile id, and is merged onto the shared base roster in the
// `profiles` value below, falling back to DEFAULT_KEY_SCHEME the first time a profile created on
// another app (or before this app has ever set one) shows up here. lastSelected is likewise its own
// small local-only redux/profileSelectionSlice.ts — which profile P1/P2 last picked is naturally a
// per-app thing, never a cross-app one.
export function ProfilesProvider({ children }: Props) {
  const profiles = useSelector((state: RootState) => state.profiles)
  const extensions = useSelector((state: RootState) => state.profileExtensions)
  const lastSelected = useSelector((state: RootState) => state.profileSelection)
  const dispatch = useDispatch<AppDispatch>()
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    // PersistGate (an ancestor — see components/Providers.tsx) already blocks this component from
    // mounting until redux-persist has rehydrated, so `profiles` here is already whatever this
    // device last had locally — resolveInitialProfiles reconciles that against the shared App
    // Group store (if available), seeding the shared store from it on a first sync, or preferring
    // the shared roster once anything has been shared. A one-time reconciliation against the
    // mount-time snapshot, deliberately not a resync whenever `profiles` changes afterward (the
    // empty deps array below is intentional, not a missed dependency — resolveInitialProfiles' own
    // setAll dispatch would otherwise re-trigger this effect).
    resolveInitialProfiles(SHARED_GROUP_ID, profiles).then((resolved) => {
      if (cancelled) return
      dispatch(profilesActions.setAll(resolved))
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mirrors local writes out to the shared store (syncToShared, called from each CRUD function
  // below) and picks up remote writes a sibling @tastic app made while this one was backgrounded
  // (onRemoteChange) — see @tastic/profile's own doc for both. keyScheme lives entirely in
  // profileExtensions (untouched here), so this only ever needs to replace the base roster.
  const { syncToShared } = useSharedProfilesSync({
    groupId: SHARED_GROUP_ID,
    onRemoteChange: useCallback((remote: BaseProfile[]) => dispatch(profilesActions.setAll(remote)), [dispatch])
  })

  const createProfile = useCallback(
    (input: CreateProfileInput) => {
      const record = createProfileRecord(input)
      dispatch(profilesActions.add(record))
      dispatch(profileExtensionsActions.set({ extension: { keyScheme: input.keyScheme }, id: record.id }))
      syncToShared([...profiles, record])
      return { ...record, keyScheme: input.keyScheme }
    },
    [profiles, dispatch, syncToShared]
  )

  const updateProfile = useCallback(
    (id: string, patch: Partial<CreateProfileInput>) => {
      // Routed to whichever slice actually owns each field — name/color/tag to the (possibly
      // shared) base roster, keyScheme to this app's own local extension slice. A single call can
      // touch both (see ProfilesManager's onSave, which always patches all three base fields at
      // once) or just one (lobby.tsx's own handleP1KeySchemeChange sync-back, patch-of-one). The two
      // dispatches below are independent — no stale-closure risk once each lives in its own Redux
      // slice, unlike the old useState version's single combined local-state write.
      const { keyScheme, ...baseChanges } = patch
      if (Object.keys(baseChanges).length > 0) {
        dispatch(profilesActions.update({ id, patch: baseChanges }))
        syncToShared(profiles.map((p) => (p.id === id ? { ...p, ...baseChanges, updatedAt: Date.now() } : p)))
      }
      if (keyScheme !== undefined) {
        dispatch(profileExtensionsActions.set({ extension: { keyScheme }, id }))
      }
    },
    [profiles, dispatch, syncToShared]
  )

  const deleteProfile = useCallback(
    (id: string) => {
      dispatch(profilesActions.remove(id))
      syncToShared(profiles.filter((p) => p.id !== id))
      dispatch(profileExtensionsActions.remove(id))
      dispatch(profileSelectionActions.clearProfile(id))
    },
    [profiles, dispatch, syncToShared]
  )

  const selectProfile = useCallback(
    (seat: Player, profileId: string | null) => {
      dispatch(profileSelectionActions.select({ profileId, seat }))
    },
    [dispatch]
  )

  const mergedProfiles: Profile[] = profiles.map((p) => ({ ...p, keyScheme: extensions[p.id]?.keyScheme ?? DEFAULT_KEY_SCHEME }))

  return <ProfilesContext.Provider value={{ profiles: mergedProfiles, lastSelected, loaded, createProfile, updateProfile, deleteProfile, selectProfile }}>{children}</ProfilesContext.Provider>
}

export function useProfiles() {
  const ctx = useContext(ProfilesContext)
  if (!ctx) throw new Error('useProfiles must be used within a ProfilesProvider')
  return ctx
}
