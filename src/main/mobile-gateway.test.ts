import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer } from 'node:http'
import { MobileGateway, buildMobileGatewayDeps, buildMobileSettingsSnapshot } from './mobile-gateway'
import { createSession } from './mobile-session'
import type { AppSettingsV1, ScheduledTaskV1 } from '../shared/app-settings-types'

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

  // -------------------------------------------------------------------------
  // Desktop-local routes (`/v1/desktop/...`)
  // -------------------------------------------------------------------------

  /** Minimal AppSettingsV1 fixture with the fields buildMobileSettingsSnapshot reads. */
  function buildMockSettings(sessions: ReturnType<typeof createSession>[] = []): AppSettingsV1 {
    return {
      version: 1,
      locale: 'en',
      theme: 'system',
      uiFontScale: 1,
      provider: {
        apiKey: 'secret-key',
        baseUrl: 'https://api.deepseek.com',
        proxy: { mode: 'none' },
        providers: [
          { id: 'p1', name: 'DeepSeek', apiKey: 'secret-1', baseUrl: 'https://api.deepseek.com', endpointFormat: 'openai-chat', models: ['deepseek-chat'], modelProfiles: {} }
        ]
      },
      agents: { kun: { binaryPath: '', port: 18080, autoStart: true, apiKey: 'rt-token', baseUrl: '', providerId: 'p1', endpointFormat: 'openai-chat', runtimeToken: 'rt-secret', dataDir: '', model: 'deepseek-chat', approvalPolicy: 'on-failure' } },
      workspaceRoot: '',
      log: { enabled: false, retentionDays: 7 },
      checkpointCleanup: { enabled: false, intervalDays: 30 },
      notifications: { enabled: false },
      appBehavior: { closeWindowAction: 'quit', launchHidden: false, fallbackBaseUrl: 'https://api.deepseek.com' } as any,
      keyboardShortcuts: {} as any,
      write: {} as any,
      claw: {} as any,
      schedule: {
        enabled: true,
        defaultWorkspaceRoot: '',
        model: 'deepseek-chat',
        mode: 'agent',
        promptPrefix: '',
        skills: {} as any,
        keepAwake: false,
        internal: { port: 0, secret: 'internal-secret' },
        tasks: []
      },
      workflow: {} as any,
      guiUpdate: { channel: 'stable' },
      terminal: { colors: {} as any },
      mobile: { gatewayEnabled: true, sessions },
      codePromptPrefix: '',
      disabledSkillIds: []
    } as unknown as AppSettingsV1
  }

  function buildMockTask(overrides: Partial<ScheduledTaskV1> = {}): ScheduledTaskV1 {
    return {
      id: 'task-1',
      title: 'Daily standup summary',
      enabled: true,
      prompt: 'Summarize today',
      workspaceRoot: '',
      clawChannelId: '',
      model: 'deepseek-chat',
      reasoningEffort: 'auto',
      mode: 'agent',
      schedule: { kind: 'daily', everyMinutes: 60, timeOfDay: '09:00', atTime: '' },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle',
      lastMessage: '',
      lastThreadId: '',
      ...overrides
    }
  }

  it('buildMobileSettingsSnapshot strips all secrets', () => {
    const settings = buildMockSettings()
    const snapshot = buildMobileSettingsSnapshot(settings)
    expect(snapshot.locale).toBe('en')
    expect(snapshot.theme).toBe('system')
    expect(snapshot.model).toBe('deepseek-chat')
    expect(snapshot.providerId).toBe('p1')
    expect(snapshot.schedule.enabled).toBe(true)
    expect(snapshot.schedule.taskCount).toBe(0)
    expect(snapshot.providers).toEqual([{ id: 'p1', name: 'DeepSeek', models: ['deepseek-chat'] }])
    expect(snapshot.mobile.gatewayEnabled).toBe(true)
    expect(snapshot.mobile.sessionCount).toBe(0)
    // No secret fields should appear anywhere in the snapshot.
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('runtimeToken')
    expect(serialized).not.toContain('baseUrl')
  })

  it('GET /v1/desktop/settings returns safe snapshot and requires auth', async () => {
    const session = createSession('iPhone')
    const store = { load: vi.fn().mockResolvedValue(buildMockSettings([session])) }
    gateway = new MobileGateway(store, [session], mockLog)
    const port = await gateway.start()

    // No auth → 401
    const unauthed = await fetch(`http://127.0.0.1:${port}/mobile/v1/desktop/settings`)
    expect(unauthed.status).toBe(401)

    // Authed → snapshot
    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/desktop/settings`, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.model).toBe('deepseek-chat')
    expect(data.providers[0].id).toBe('p1')
    expect(JSON.stringify(data)).not.toContain('apiKey')
  })

  it('GET /v1/desktop/schedule/tasks lists tasks via injected deps', async () => {
    const session = createSession('iPhone')
    const task = buildMockTask()
    const deps = buildMobileGatewayDeps(() => ({
      listTasks: vi.fn().mockResolvedValue([task]),
      runTask: vi.fn(),
      updateTaskById: vi.fn(),
      status: vi.fn()
    } as any))
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog, deps)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/desktop/schedule/tasks`, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.tasks).toHaveLength(1)
    expect(data.tasks[0].id).toBe('task-1')
  })

  it('GET /v1/desktop/schedule/tasks/{id} returns 404 for unknown id', async () => {
    const session = createSession('iPhone')
    const deps = buildMobileGatewayDeps(() => ({
      listTasks: vi.fn().mockResolvedValue([buildMockTask()]),
      runTask: vi.fn(),
      updateTaskById: vi.fn(),
      status: vi.fn()
    } as any))
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog, deps)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/desktop/schedule/tasks/missing`, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(404)
  })

  it('POST /v1/desktop/schedule/tasks/{id}/run triggers runTask', async () => {
    const session = createSession('iPhone')
    const runTask = vi.fn().mockResolvedValue({ ok: true, threadId: 't1', message: 'Started' })
    const deps = buildMobileGatewayDeps(() => ({
      listTasks: vi.fn(),
      runTask,
      updateTaskById: vi.fn(),
      status: vi.fn()
    } as any))
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog, deps)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/desktop/schedule/tasks/task-1/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.result.ok).toBe(true)
    expect(runTask).toHaveBeenCalledWith('task-1')
  })

  it('PATCH /v1/desktop/schedule/tasks/{id} updates enabled flag', async () => {
    const session = createSession('iPhone')
    const updated = buildMockTask({ enabled: false })
    const updateTaskById = vi.fn().mockResolvedValue(updated)
    const deps = buildMobileGatewayDeps(() => ({
      listTasks: vi.fn(),
      runTask: vi.fn(),
      updateTaskById,
      status: vi.fn()
    } as any))
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog, deps)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/desktop/schedule/tasks/task-1`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.task.enabled).toBe(false)
    expect(updateTaskById).toHaveBeenCalledWith('task-1', expect.objectContaining({ enabled: false }))
  })

  it('PATCH /v1/desktop/schedule/tasks/{id} rejects unknown fields', async () => {
    const session = createSession('iPhone')
    const updateTaskById = vi.fn()
    const deps = buildMobileGatewayDeps(() => ({
      listTasks: vi.fn(),
      runTask: vi.fn(),
      updateTaskById,
      status: vi.fn()
    } as any))
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog, deps)
    const port = await gateway.start()

    // Attempt to smuggle a prompt change — sanitizer should drop it.
    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/desktop/schedule/tasks/task-1`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'malicious', enabled: true })
    })
    expect(res.status).toBe(200)
    expect(updateTaskById).toHaveBeenCalledWith('task-1', expect.not.objectContaining({ prompt: expect.anything() }))
    expect(updateTaskById).toHaveBeenCalledWith('task-1', expect.objectContaining({ enabled: true }))
  })

  it('GET /v1/desktop/schedule/status returns runtime status', async () => {
    const session = createSession('iPhone')
    const deps = buildMobileGatewayDeps(() => ({
      listTasks: vi.fn(),
      runTask: vi.fn(),
      updateTaskById: vi.fn(),
      status: vi.fn().mockResolvedValue({
        internalServerRunning: true,
        internalUrl: 'http://127.0.0.1:19000',
        runningTaskIds: ['task-1'],
        queuedTaskIds: [],
        powerSaveBlockerActive: false
      })
    } as any))
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog, deps)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/desktop/schedule/status`, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status.internalServerRunning).toBe(true)
    expect(data.status.runningTaskIds).toEqual(['task-1'])
  })

  it('GET /v1/desktop/sessions returns list without tokens and flags current', async () => {
    const current = createSession('This phone')
    const other = createSession('iPad')
    gateway = new MobileGateway(mockSettingsStore, [current, other], mockLog)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/desktop/sessions`, {
      headers: { Authorization: `Bearer ${current.token}` }
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.sessions).toHaveLength(2)
    const me = data.sessions.find((s: any) => s.current === true)
    const them = data.sessions.find((s: any) => s.current !== true)
    expect(me.name).toBe('This phone')
    expect(them.name).toBe('iPad')
    // No token leaks
    expect(JSON.stringify(data)).not.toContain(current.token)
    expect(JSON.stringify(data)).not.toContain(other.token)
  })

  it('desktop-local unknown sub-path returns 404', async () => {
    const session = createSession('iPhone')
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/desktop/unknown`, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(404)
  })

  it('desktop-local route with no deps returns 501 for schedule reads', async () => {
    const session = createSession('iPhone')
    // No deps injected → schedule runtime not available
    gateway = new MobileGateway(mockSettingsStore, [session], mockLog)
    const port = await gateway.start()

    const res = await fetch(`http://127.0.0.1:${port}/mobile/v1/desktop/schedule/tasks`, {
      headers: { Authorization: `Bearer ${session.token}` }
    })
    expect(res.status).toBe(501)
  })
})
