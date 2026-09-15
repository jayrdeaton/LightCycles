import { createProfileExtensionSlice } from '@tastic/profile'

import { KeyScheme } from '@/types'

// This app's one genuine per-profile extension field — BoxHockey's analogous field is
// controlScheme. @tastic/profile's own Profile type is deliberately base-fields-only (id/name/
// color/tag/createdAt/updatedAt) and documents that a host app extends it on its own side, in its
// own storage — keyScheme has no meaning to any sibling @tastic game and never travels through the
// shared App Group roster (see resolveInitialProfiles/useSharedProfilesSync in useProfiles.tsx). So
// it gets its own small LOCAL-ONLY slice here, keyed by profile id, kept genuinely separate from
// the `profiles` slice (@tastic/profile's own profilesReducer, see store.ts) and merged onto that
// shared base roster only at the point useProfiles() exposes `profiles` to consumers.
//
// The Record<profileId, TExtension> reducer itself (set/remove) is @tastic/profile's own
// createProfileExtensionSlice factory — this file just supplies the namespace and the
// app-specific extension shape.
export interface ProfileExtension {
  keyScheme: KeyScheme
}

const { actions: profileExtensionsActions, reducer: profileExtensionsReducer } = createProfileExtensionSlice<ProfileExtension>('keyScheme')

export { profileExtensionsActions }
export default profileExtensionsReducer
