import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'

import { KeyScheme, Player, Profile } from '@/types'
import { DEFAULT_PROFILES_STATE, isValidProfilesState, SavedProfilesState } from '@/utils/profilesValidation'

const STORAGE_KEY = 'lightcycles.profiles'

interface CreateProfileInput {
  name: string
  color: string
  tag: string
  keyScheme: KeyScheme
}

interface ProfilesContextValue {
  profiles: Profile[]
  lastSelected: Record<Player, string | null>
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

function generateProfileId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Single source of truth for saved player profiles, mounted once in _layout.tsx — same
// single-Provider rationale as useGameSettings.tsx/useGameStats.tsx (expo-router keeps prior
// screens mounted, so a per-screen AsyncStorage-backed copy could go stale or clobber a concurrent
// update). Deliberately doesn't import Theme/@rific/auto-paper or touch color/theme state at all —
// selecting a profile here only ever writes `lastSelected`; the "pre-fill the seat's color"
// behavior lives one layer up, in lobby.tsx/LobbyPlayerPanel.tsx. Keeping this hook free of any
// LightCycles-specific theme coupling is what keeps a future @tastic/profile extraction low-friction.
export function ProfilesProvider({ children }: Props) {
  const [state, setState] = useState<SavedProfilesState>(DEFAULT_PROFILES_STATE)

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!stored) return
        try {
          const parsed = JSON.parse(stored)
          if (isValidProfilesState(parsed)) setState(parsed)
        } catch {
          // Corrupt/stale blob — keep defaults.
        }
      })
      .catch(() => {
        // Unavailable storage — DEFAULT_PROFILES_STATE already in state is a complete, silent
        // fallback, same as useGameSettings.tsx.
      })
  }, [])

  const createProfile = useCallback((input: CreateProfileInput) => {
    const now = Date.now()
    const profile: Profile = { id: generateProfileId(), name: input.name, color: input.color, tag: input.tag, keyScheme: input.keyScheme, createdAt: now, updatedAt: now }
    setState((prev) => {
      const next = { ...prev, profiles: [...prev.profiles, profile] }
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
    return profile
  }, [])

  const updateProfile = useCallback((id: string, patch: Partial<CreateProfileInput>) => {
    setState((prev) => {
      const next = { ...prev, profiles: prev.profiles.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)) }
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  const deleteProfile = useCallback((id: string) => {
    setState((prev) => {
      const next: SavedProfilesState = {
        profiles: prev.profiles.filter((p) => p.id !== id),
        lastSelected: { 1: prev.lastSelected[1] === id ? null : prev.lastSelected[1], 2: prev.lastSelected[2] === id ? null : prev.lastSelected[2] }
      }
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  const selectProfile = useCallback((seat: Player, profileId: string | null) => {
    setState((prev) => {
      const next = { ...prev, lastSelected: { ...prev.lastSelected, [seat]: profileId } }
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  return <ProfilesContext.Provider value={{ profiles: state.profiles, lastSelected: state.lastSelected, createProfile, updateProfile, deleteProfile, selectProfile }}>{children}</ProfilesContext.Provider>
}

export function useProfiles() {
  const ctx = useContext(ProfilesContext)
  if (!ctx) throw new Error('useProfiles must be used within a ProfilesProvider')
  return ctx
}
