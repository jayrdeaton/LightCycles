import { DEFAULT_LOCAL_PROFILES_STATE, isValidLocalProfilesState, isValidProfile, isValidTag, MAX_PROFILE_NAME_LENGTH, MAX_TAG_LENGTH, migrateLegacyProfilesState } from '@/utils/profilesValidation'

const VALID_PROFILE = {
  id: 'profile-1',
  name: 'Alice',
  color: '#2196f3',
  tag: '😎',
  keyScheme: 'wasd',
  createdAt: 1000,
  updatedAt: 1000
}

describe('isValidProfile', () => {
  it('accepts a fully valid profile', () => {
    expect(isValidProfile(VALID_PROFILE)).toBe(true)
  })

  it('rejects non-objects', () => {
    expect(isValidProfile(null)).toBe(false)
    expect(isValidProfile(undefined)).toBe(false)
    expect(isValidProfile('Alice')).toBe(false)
    expect(isValidProfile(42)).toBe(false)
  })

  it('rejects a missing or empty id', () => {
    const { id: _id, ...missingId } = VALID_PROFILE
    expect(isValidProfile(missingId)).toBe(false)
    expect(isValidProfile({ ...VALID_PROFILE, id: '' })).toBe(false)
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(isValidProfile({ ...VALID_PROFILE, name: '' })).toBe(false)
    expect(isValidProfile({ ...VALID_PROFILE, name: '   ' })).toBe(false)
  })

  it('rejects a name longer than MAX_PROFILE_NAME_LENGTH', () => {
    expect(isValidProfile({ ...VALID_PROFILE, name: 'a'.repeat(MAX_PROFILE_NAME_LENGTH) })).toBe(true)
    expect(isValidProfile({ ...VALID_PROFILE, name: 'a'.repeat(MAX_PROFILE_NAME_LENGTH + 1) })).toBe(false)
  })

  it('rejects a non-hex color', () => {
    expect(isValidProfile({ ...VALID_PROFILE, color: 'blue' })).toBe(false)
    expect(isValidProfile({ ...VALID_PROFILE, color: '#fff' })).toBe(false)
  })

  it('accepts an uppercase hex color', () => {
    expect(isValidProfile({ ...VALID_PROFILE, color: '#2196F3' })).toBe(true)
  })

  it('rejects a missing tag, but accepts an empty one', () => {
    const { tag: _tag, ...missingTag } = VALID_PROFILE
    expect(isValidProfile(missingTag)).toBe(false)
    expect(isValidProfile({ ...VALID_PROFILE, tag: '' })).toBe(true)
  })

  it('rejects non-numeric createdAt/updatedAt', () => {
    expect(isValidProfile({ ...VALID_PROFILE, createdAt: '1000' })).toBe(false)
    expect(isValidProfile({ ...VALID_PROFILE, updatedAt: '1000' })).toBe(false)
  })

  it('accepts every valid keyScheme value', () => {
    for (const keyScheme of ['wasd', 'arrows', 'ijkl']) {
      expect(isValidProfile({ ...VALID_PROFILE, keyScheme })).toBe(true)
    }
  })

  it('rejects a missing or invalid keyScheme', () => {
    const { keyScheme: _keyScheme, ...missingKeyScheme } = VALID_PROFILE
    expect(isValidProfile(missingKeyScheme)).toBe(false)
    expect(isValidProfile({ ...VALID_PROFILE, keyScheme: 'dvorak' })).toBe(false)
  })
})

describe('isValidTag', () => {
  it('accepts an empty tag — no tag set yet', () => {
    expect(isValidTag('')).toBe(true)
  })

  it('accepts a single emoji, including a multi-codepoint one', () => {
    expect(isValidTag('😎')).toBe(true)
    expect(isValidTag('🇺🇸')).toBe(true) // flag: a regional-indicator pair
    expect(isValidTag('👨‍👩‍👧')).toBe(true) // ZWJ-joined family
  })

  it('accepts up to MAX_TAG_LENGTH plain letters', () => {
    expect(isValidTag('J')).toBe(true)
    expect(isValidTag('JAY')).toBe(true)
    expect(isValidTag('J'.repeat(MAX_TAG_LENGTH))).toBe(true)
  })

  it('rejects more than MAX_TAG_LENGTH plain letters', () => {
    expect(isValidTag('J'.repeat(MAX_TAG_LENGTH + 1))).toBe(false)
  })

  it('rejects mixing an emoji with letters', () => {
    expect(isValidTag('😎J')).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isValidTag(5)).toBe(false)
    expect(isValidTag(null)).toBe(false)
    expect(isValidTag(undefined)).toBe(false)
  })
})

const { keyScheme: BASE_ONLY_KEY_SCHEME, ...VALID_BASE_PROFILE } = VALID_PROFILE
void BASE_ONLY_KEY_SCHEME

describe('isValidLocalProfilesState', () => {
  it('accepts DEFAULT_LOCAL_PROFILES_STATE', () => {
    expect(isValidLocalProfilesState(DEFAULT_LOCAL_PROFILES_STATE)).toBe(true)
  })

  it('accepts a populated roster with a selection and an extension', () => {
    const populated = { localBase: [VALID_BASE_PROFILE], extensions: { 'profile-1': { keyScheme: 'wasd' } }, lastSelected: { 1: 'profile-1', 2: null } }
    expect(isValidLocalProfilesState(populated)).toBe(true)
  })

  it('rejects non-objects', () => {
    expect(isValidLocalProfilesState(null)).toBe(false)
    expect(isValidLocalProfilesState(undefined)).toBe(false)
    expect(isValidLocalProfilesState('profiles')).toBe(false)
  })

  it('rejects a non-array localBase field', () => {
    expect(isValidLocalProfilesState({ ...DEFAULT_LOCAL_PROFILES_STATE, localBase: {} })).toBe(false)
  })

  it('rejects a roster containing one malformed base profile — whole state invalid', () => {
    const malformed = { ...DEFAULT_LOCAL_PROFILES_STATE, localBase: [VALID_BASE_PROFILE, { ...VALID_BASE_PROFILE, id: '', name: 'Bob' }] }
    expect(isValidLocalProfilesState(malformed)).toBe(false)
  })

  it('rejects a malformed extensions entry — whole state invalid', () => {
    const malformed = { ...DEFAULT_LOCAL_PROFILES_STATE, extensions: { 'profile-1': { keyScheme: 'dvorak' } } }
    expect(isValidLocalProfilesState(malformed)).toBe(false)
  })

  it('rejects missing or malformed lastSelected', () => {
    const { lastSelected: _lastSelected, ...missingLastSelected } = DEFAULT_LOCAL_PROFILES_STATE
    expect(isValidLocalProfilesState(missingLastSelected)).toBe(false)
    expect(isValidLocalProfilesState({ ...DEFAULT_LOCAL_PROFILES_STATE, lastSelected: { 1: 42, 2: null } })).toBe(false)
  })

  it('accepts a lastSelected id that does not (yet) match any saved profile', () => {
    // Validation doesn't cross-check lastSelected against the roster — a stale/deleted id is
    // handled by lobby.tsx resolving it to Guest at read time, not by rejecting the whole blob.
    expect(isValidLocalProfilesState({ localBase: [], extensions: {}, lastSelected: { 1: 'deleted-id', 2: null } })).toBe(true)
  })
})

describe('migrateLegacyProfilesState', () => {
  it('splits a legacy full-profile blob into base fields + extensions', () => {
    const legacy = { profiles: [VALID_PROFILE], lastSelected: { 1: 'profile-1', 2: null } }
    expect(migrateLegacyProfilesState(legacy)).toEqual({
      localBase: [VALID_BASE_PROFILE],
      extensions: { 'profile-1': { keyScheme: 'wasd' } },
      lastSelected: { 1: 'profile-1', 2: null }
    })
  })

  it('returns null for a blob that is neither legacy nor current-shape', () => {
    expect(migrateLegacyProfilesState({ profiles: [{ ...VALID_PROFILE, keyScheme: undefined }], lastSelected: { 1: null, 2: null } })).toBeNull()
    expect(migrateLegacyProfilesState(null)).toBeNull()
    expect(migrateLegacyProfilesState(DEFAULT_LOCAL_PROFILES_STATE)).toBeNull()
  })
})
