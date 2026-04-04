import test from 'node:test'
import assert from 'node:assert/strict'

import { RealtimeClient } from '../../apps/client/src/lib/realtime-client.ts'

type Listener = (event?: unknown) => void

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  static instances: MockWebSocket[] = []

  readonly url: string
  readyState = MockWebSocket.CONNECTING
  readonly sentMessages: string[] = []

  private readonly listeners = new Map<string, Set<Listener>>()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    const bucket = this.listeners.get(type) ?? new Set<Listener>()
    bucket.add(listener)
    this.listeners.set(type, bucket)
  }

  send(data: string): void {
    this.sentMessages.push(data)
  }

  close(code = 1000): void {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', { code })
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN
    this.emit('open', undefined)
  }

  private emit(type: string, event?: unknown): void {
    const bucket = this.listeners.get(type)
    if (!bucket) {
      return
    }

    bucket.forEach((listener) => listener(event))
  }

  static reset(): void {
    MockWebSocket.instances = []
  }
}

const originalWebSocket = globalThis.WebSocket

test.beforeEach(() => {
  MockWebSocket.reset()
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: MockWebSocket,
  })
})

test.after(() => {
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: originalWebSocket,
  })
})

test('startSession sends exactly one start_session frame after connect', () => {
  const client = new RealtimeClient({ url: 'ws://localhost/ws' })

  client.startSession('session-123')

  assert.equal(MockWebSocket.instances.length, 1)
  const socket = MockWebSocket.instances[0]
  assert.equal(socket.readyState, MockWebSocket.CONNECTING)

  socket.open()

  const startSessionFrames = socket.sentMessages
    .map((raw) => JSON.parse(raw) as { type?: string; payload?: { sessionId?: string } })
    .filter((frame) => frame.type === 'start_session')

  assert.equal(startSessionFrames.length, 1)
  assert.equal(startSessionFrames[0]?.payload?.sessionId, 'session-123')
})
