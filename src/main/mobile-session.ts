import type { MobileSessionV1 } from '../shared/mobile-api-types'

/**
 * Create a new mobile session with a random UUID token.
 * The session is NOT persisted automatically — the caller is
 * responsible for writing it to the settings store.
 */
export function createSession(name: string): MobileSessionV1 {
  if (!name.trim()) {
    throw new Error('Session name must not be empty')
  }
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    token: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  }
}

/**
 * Return `true` if `token` matches any active session.
 */
export function validateToken(
  token: string,
  sessions: MobileSessionV1[]
): boolean {
  const t = token.trim()
  if (!t) return false
  return sessions.some((s) => s.token === t)
}

/**
 * Remove one session by id.
 * Returns a shallow copy of the array; does not mutate the input.
 */
export function revokeSession(
  id: string,
  sessions: MobileSessionV1[]
): MobileSessionV1[] {
  return sessions.filter((s) => s.id !== id)
}

/**
 * Replace the token of one session with a new random UUID.
 * Returns a shallow copy of the array with the updated session.
 * The old token becomes invalid immediately.
 */
export function refreshToken(
  id: string,
  sessions: MobileSessionV1[]
): MobileSessionV1[] {
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx === -1) {
    throw new Error(`Session not found: ${id}`)
  }
  const copy = [...sessions]
  copy[idx] = { ...copy[idx], token: crypto.randomUUID() }
  return copy
}
