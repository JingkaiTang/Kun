import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer } from 'node:http'
import { MobileGateway } from './mobile-gateway'
import { createSession } from './mobile-session'

// Helper to create a mock Kun server
function createMockKunServer(port: number, handler: (req: any, res: any) => void) {
  const server = createServer(handler)
  return new Promise<any>((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

describe('MobileGateway', () => {
  let mockKunServer: any
  let gateway: MobileGateway
  const mockSettingsStore = {
    load: vi.fn().mockResolvedValue({
      agents: { kun: { port: 18080 } }
    })
  }
  const mockLog = vi.fn()

  beforeEach(async () => {
    // Start a mock Kun server
    mockKunServer = await createMockKunServer(18080, (req, res) => {
      const url = new URL(req.url, `http://localhost:${req.socket.localPort}`)
      
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok' }))
        return
      }
      
      if (req.url?.includes('/events')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        })
        res.write('data: {"type":"test"}\n\n')
        setTimeout(() => res.end(), 100)
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ path: req.url, method: req.method }))
    })
  })

  afterEach(async () => {
    if (gateway) {
      await gateway.stop()
    }
    if (mockKunServer) {
      await new Promise<void>((resolve) => mockKunServer.close(() => resolve()))
    }
  })

  it('starts and listens on 0.0.0.0', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    
    const port = await gateway.start()
    expect(port).toBeGreaterThanOrEqual(19900)
    expect(gateway.activePort).toBe(port)
  })

  it('proxies health endpoint without auth', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/health`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
  })

  it('returns 401 without auth header', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/threads`)
    expect(res.status).toBe(401)
  })

  it('returns 401 with bad token', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/threads`, {
      headers: { Authorization: 'Bearer invalid-token' }
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 after revocation', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    // Revoke session
    gateway.updateSessions([])

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/threads`, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 for non-whitelisted endpoint', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/memory`, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 for wrong method', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/threads`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(404)
  })

  it('strips /mobile prefix and proxies correctly', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/threads`, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.path).toBe('/v1/threads')
  })

  it('proxies POST /v1/threads/{id}/todos (full-list replacement)', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/threads/test-thread/todos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ todos: [] })
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.path).toBe('/v1/threads/test-thread/todos')
    expect(data.method).toBe('POST')
  })

  it('proxies DELETE /v1/threads/{id}/todos (clear all)', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/threads/test-thread/todos`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.path).toBe('/v1/threads/test-thread/todos')
    expect(data.method).toBe('DELETE')
  })

  it('handles SSE pass-through', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/threads/test/events`, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    
    const text = await res.text()
    expect(text).toContain('data: {"type":"test"}')
  })

  it('stops and frees port', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    await gateway.stop()
    expect(gateway.activePort).toBe(0)

    // Verify port is freed by trying to bind to it
    const testServer = createServer()
    await new Promise<void>((resolve) => testServer.listen(port, '127.0.0.1', () => resolve()))
    await new Promise<void>((resolve) => testServer.close(() => resolve()))
  })

  it('handles idempotent stop', async () => {
    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    await gateway.start()

    await gateway.stop()
    await gateway.stop() // Should not throw
    expect(gateway.activePort).toBe(0)
  })

  it('throws when Kun is unreachable', async () => {
    await new Promise<void>((resolve) => mockKunServer.close(() => resolve()))
    mockKunServer = null

    const session = createSession('Test Device')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)

    await expect(gateway.start()).rejects.toThrow('Kun is not reachable')
  })
})
