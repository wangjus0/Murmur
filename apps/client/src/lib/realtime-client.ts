import type {
  ClientToServerEventName,
  ClientToServerPayloadMap,
  MessageEnvelope,
  ServerToClientMessage,
} from '@murmur/shared'

import { parseServerMessage } from './contracts.js'

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

interface ClientEventMap {
  readonly open: undefined
  readonly close: CloseEvent
  readonly connection_status: ConnectionStatus
  readonly message: ServerToClientMessage
  readonly error: Error
}

type Listener<K extends keyof ClientEventMap> = (payload: ClientEventMap[K]) => void

type ListenerRegistry = {
  [K in keyof ClientEventMap]: Set<Listener<K>>
}

interface QueuedMessage {
  readonly event: ClientToServerEventName
  readonly payload: ClientToServerPayloadMap[ClientToServerEventName]
  readonly requestId?: string
}

export interface RealtimeClientOptions {
  readonly url?: string
  readonly reconnectBaseDelayMs?: number
  readonly reconnectMaxDelayMs?: number
  readonly maxReconnectAttempts?: number
  readonly maxQueuedMessages?: number
}

export class RealtimeClient {
  private readonly url: string
  private readonly reconnectBaseDelayMs: number
  private readonly reconnectMaxDelayMs: number
  private readonly maxReconnectAttempts: number
  private readonly maxQueuedMessages: number

  private socket: WebSocket | null = null
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private sessionId: string | null = null
  private closedByUser = false
  private readonly queue: QueuedMessage[] = []
  private readonly listeners: ListenerRegistry = {
    open: new Set(),
    close: new Set(),
    connection_status: new Set(),
    message: new Set(),
    error: new Set(),
  }
  private status: ConnectionStatus = 'idle'

  constructor(options: RealtimeClientOptions = {}) {
    const location = (globalThis as { location?: { protocol?: string; hostname?: string; port?: string } }).location
    const portSegment = location?.port ? `:${location.port}` : ''
    const protocol = location?.protocol === 'https:' ? 'wss' : 'ws'
    const host = location?.hostname || 'localhost'

    this.url = options.url ?? `${protocol}://${host}${portSegment}/ws`
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 500
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 8_000
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10
    this.maxQueuedMessages = options.maxQueuedMessages ?? 512
  }

  connect(): void {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }

    this.closedByUser = false
    this.updateStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting')

    this.socket = new WebSocket(this.url)
    this.socket.addEventListener('open', () => {
      this.reconnectAttempt = 0
      this.updateStatus('connected')
      this.emit('open', undefined)
      this.startOrResumeSession()
    })

    this.socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') {
        this.emitError(new Error('Expected text websocket payload from server.'))
        return
      }

      const result = parseServerMessage(event.data)
      if (!result.ok) {
        this.emitError(new Error(result.reason))
        return
      }

      if (result.message.type === 'session_started') {
        this.sessionId = result.message.payload.sessionId
        this.flushQueue()
      }

      this.emit('message', result.message)
    })

    this.socket.addEventListener('close', (event) => {
      this.emit('close', event)
      this.socket = null

      if (this.closedByUser) {
        this.updateStatus('closed')
        return
      }

      if (event.code === 4000) {
        this.updateStatus('closed')
        this.emitError(new Error('Session resumed by another connection.'))
        return
      }

      this.scheduleReconnect()
    })

    this.socket.addEventListener('error', () => {
      this.emitError(new Error('WebSocket connection error.'))
    })
  }

  disconnect(): void {
    this.closedByUser = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.socket) {
      this.socket.close()
      this.socket = null
    }

    this.updateStatus('closed')
  }

  startSession(sessionId?: string): void {
    if (sessionId) {
      this.sessionId = sessionId
    }

    this.removeQueuedStartSession()
    this.send('start_session', {
      sessionId: this.sessionId ?? undefined,
    })
  }

  send<EventName extends ClientToServerEventName>(
    event: EventName,
    payload: ClientToServerPayloadMap[EventName],
    requestId?: string,
  ): void {
    const envelope: MessageEnvelope<EventName, ClientToServerPayloadMap[EventName]> = {
      type: event,
      payload,
      requestId,
      timestamp: new Date().toISOString(),
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.enqueue(event, payload, requestId)
      if (this.status === 'idle' || this.status === 'closed') {
        this.connect()
      }

      return
    }

    this.socket.send(JSON.stringify(envelope))
  }

  on<K extends keyof ClientEventMap>(event: K, listener: Listener<K>): () => void {
    const listeners = this.listeners[event] as Set<Listener<K>>
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  private startOrResumeSession(): void {
    this.removeQueuedStartSession()
    this.send('start_session', {
      sessionId: this.sessionId ?? undefined,
    })
  }

  private removeQueuedStartSession(): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]?.event === 'start_session') {
        this.queue.splice(index, 1)
      }
    }
  }

  private enqueue<EventName extends ClientToServerEventName>(
    event: EventName,
    payload: ClientToServerPayloadMap[EventName],
    requestId?: string,
  ): void {
    if (event === 'start_session') {
      this.removeQueuedStartSession()
    }

    this.queue.push({
      event,
      payload: payload as ClientToServerPayloadMap[ClientToServerEventName],
      requestId,
    })

    if (this.queue.length <= this.maxQueuedMessages) {
      return
    }

    this.queue.shift()
    this.emitError(new Error('Realtime queue overflow. Dropped oldest queued event.'))
  }

  private flushQueue(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }

    while (this.queue.length > 0) {
      const next = this.queue.shift()
      if (!next) {
        return
      }

      this.send(next.event, next.payload, next.requestId)
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.updateStatus('closed')
      this.emitError(new Error('Realtime reconnect attempts exhausted.'))
      return
    }

    this.reconnectAttempt += 1
    this.updateStatus('reconnecting')

    const delay = Math.min(
      this.reconnectBaseDelayMs * 2 ** (this.reconnectAttempt - 1),
      this.reconnectMaxDelayMs,
    )

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private emit<K extends keyof ClientEventMap>(event: K, payload: ClientEventMap[K]): void {
    const listeners = this.listeners[event] as Set<Listener<K>>
    listeners.forEach((listener) => {
      listener(payload)
    })
  }

  private emitError(error: Error): void {
    this.emit('error', error)
  }

  private updateStatus(status: ConnectionStatus): void {
    if (this.status === status) {
      return
    }

    this.status = status
    this.emit('connection_status', status)
  }
}
