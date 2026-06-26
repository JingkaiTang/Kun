import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSession, validateToken, revokeSession, refreshToken } from './mobile-session'

describe('mobile-session', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('createSession', () => {
    it('creates a session with valid fields', () => {
      const session = createSession('Test Device')
      expect(session.id).toBeDefined()
      expect(session.name).toBe('Test Device')
      expect(session.token).toBeDefined()
      expect(session.createdAt).toBeDefined()
    })

    it('trims whitespace from name', () => {
      const session = createSession('  Test Device  ')
      expect(session.name).toBe('Test Device')
    })

    it('throws on empty name', () => {
      expect(() => createSession('')).toThrow('Session name must not be empty')
    })

    it('throws on whitespace-only name', () => {
      expect(() => createSession('   ')).toThrow('Session name must not be empty')
    })
  })

  describe('validateToken', () => {
    it('returns true for valid token', () => {
      const session = createSession('Test')
      expect(validateToken(session.token, [session])).toBe(true)
    })

    it('returns false for invalid token', () => {
      const session = createSession('Test')
      expect(validateToken('invalid-token', [session])).toBe(false)
    })

    it('returns false for empty token', () => {
      const session = createSession('Test')
      expect(validateToken('', [session])).toBe(false)
    })

    it('returns false for whitespace-only token', () => {
      const session = createSession('Test')
      expect(validateToken('   ', [session])).toBe(false)
    })

    it('returns false for empty sessions array', () => {
      const session = createSession('Test')
      expect(validateToken(session.token, [])).toBe(false)
    })
  })

  describe('revokeSession', () => {
    it('removes session by id', () => {
      const session1 = createSession('Device 1')
      const session2 = createSession('Device 2')
      const result = revokeSession(session1.id, [session1, session2])
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe(session2.id)
    })

    it('returns empty array when revoking last session', () => {
      const session = createSession('Test')
      const result = revokeSession(session.id, [session])
      expect(result).toHaveLength(0)
    })

    it('returns all sessions if id not found', () => {
      const session1 = createSession('Device 1')
      const session2 = createSession('Device 2')
      const result = revokeSession('nonexistent', [session1, session2])
      expect(result).toHaveLength(2)
    })

    it('does not mutate input array', () => {
      const session = createSession('Test')
      const input = [session]
      const result = revokeSession(session.id, input)
      expect(input).toHaveLength(1)
      expect(result).toHaveLength(0)
    })
  })

  describe('refreshToken', () => {
    it('generates new token for session', () => {
      const session = createSession('Test')
      const oldToken = session.token
      const result = refreshToken(session.id, [session])
      expect(result[0].token).not.toBe(oldToken)
    })

    it('preserves session id and name', () => {
      const session = createSession('Test')
      const result = refreshToken(session.id, [session])
      expect(result[0].id).toBe(session.id)
      expect(result[0].name).toBe(session.name)
    })

    it('throws if session not found', () => {
      const session = createSession('Test')
      expect(() => refreshToken('nonexistent', [session])).toThrow('Session not found')
    })

    it('does not mutate input array', () => {
      const session = createSession('Test')
      const input = [session]
      const result = refreshToken(session.id, input)
      expect(input[0].token).toBe(session.token)
      expect(result[0].token).not.toBe(session.token)
    })
  })
})
