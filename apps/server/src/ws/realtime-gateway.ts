import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

import { WebSocketServer, type WebSocket } from 'ws'

import type {
  ClientToServerEventName,
  ClientToServerMessageInput,
  ServerToClientEventName,
  ServerToClientPayloadMap,
} from '@murmur/shared'
import { parseClientMessage, stringifyServerEnvelope, type RawSocketMessage } from './contracts.js'

type WebSocketState = 0 | 1 | 2 | 3

interface GatewaySocket extends WebSocket {
  readonly readyState: WebSocketState
}

interface ActiveSession {
  readonly sessionId: string
  readonly connectedAt: string
  readonly socket: GatewaySocket
}

interface ConnectionState {
  readonly socket: GatewaySocket
  readonly openedAt: string
  sessionId: string | null
}

export interface RealtimeContext {
  readonly sessionId: string
  readonly requestId?: string
}

export type RealtimeEventHandler = (
  message: ClientToServerMessageInput,
  context: RealtimeContext,
) => void | Promise<void>

export interface RealtimeGatewayOptions {
  readonly path?: string
  readonly onClientEvent?: RealtimeEventHandler
  readonly maxPayloadBytes?: number
}

export class RealtimeGateway {
  private readonly path: string
  private readonly server: WebSocketServer
  private readonly onClientEvent?: RealtimeEventHandler
  private readonly sessions = new Map<string, ActiveSession>()
  private readonly connections = new Map<GatewaySocket, ConnectionState>()

  constructor(options: RealtimeGatewayOptions = {}) {
    this.path = options.path ?? '/ws'
    this.onClientEvent = options.onClientEvent
    this.server = new WebSocketServer({
      noServer: true,
      maxPayload: options.maxPayloadBytes ?? 1_048_576,
    })

    this.server.on('connection', (socket) => {
      this.registerConnection(socket as GatewaySocket)
    })
  }

  attachUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== this.path) {
      return false
    }

    this.server.handleUpgrade(request, socket, head, (upgradedSocket) => {
      this.server.emit('connection', upgradedSocket, request)
    })

    return true
  }

  broadcast<EventName extends ServerToClientEventName>(
    type: EventName,
    payload: ServerToClientPayloadMap[EventName],
  ): void {
    const message = stringifyServerEnvelope(type, payload)

    this.sessions.forEach(({ socket }) => {
      if (socket.readyState === 1) {
        socket.send(message)
      }
    })
  }

  emitToSession<EventName extends ServerToClientEventName>(
    sessionId: string,
    type: EventName,
    payload: ServerToClientPayloadMap[EventName],
    requestId?: string,
  ): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || session.socket.readyState !== 1) {
      return false
    }

    session.socket.send(stringifyServerEnvelope(type, payload, { requestId }))
    return true
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    this.sessions.delete(sessionId)
    session.socket.close(1000, 'session_closed')
  }

  dispose(): void {
    this.sessions.forEach(({ socket }) => {
      if (socket.readyState === 1) {
        socket.close(1001, 'gateway_disposed')
      }
    })

    this.sessions.clear()
    this.connections.clear()
    this.server.close()
  }

  private registerConnection(socket: GatewaySocket): void {
    const connection: ConnectionState = {
      socket,
      openedAt: new Date().toISOString(),
      sessionId: null,
    }

    this.connections.set(socket, connection)

    socket.on('message', async (raw) => {
      await this.routeIncomingEvent(socket, raw as RawSocketMessage)
    })

    socket.on('close', () => {
      this.connections.delete(socket)

      const sessionId = connection.sessionId
      if (!sessionId) {
        return
      }

      const activeSession = this.sessions.get(sessionId)
      if (activeSession?.socket === socket) {
        this.sessions.delete(sessionId)
      }
    })
  }

  private async routeIncomingEvent(socket: GatewaySocket, raw: Parameters<typeof parseClientMessage>[0]): Promise<void> {
    const parsed = parseClientMessage(raw)
    if (!parsed.ok) {
      this.sendError(socket, 'invalid_message', parsed.reason, true)
      return
    }

    const message = parsed.message
    const connection = this.connections.get(socket)
    if (!connection) {
      return
    }

    if (message.type === 'start_session') {
      const requestedSessionId = message.payload.sessionId
      if (requestedSessionId) {
        const activeSession = this.sessions.get(requestedSessionId)
        if (activeSession && activeSession.socket !== socket && activeSession.socket.readyState === 1) {
          const displacedConnection = this.connections.get(activeSession.socket)
          if (displacedConnection && displacedConnection.sessionId === requestedSessionId) {
            displacedConnection.sessionId = null
          }

          this.sessions.delete(requestedSessionId)
          activeSession.socket.close(4000, 'session_replaced')
        }
      }

      const sessionId = this.bindSession(connection, requestedSessionId)
      socket.send(
        stringifyServerEnvelope('session_started', {
          sessionId,
          startedAt: this.sessions.get(sessionId)?.connectedAt ?? connection.openedAt,
        }, {
          requestId: message.requestId,
        }),
      )

      await this.forwardToHandler(message, {
        sessionId,
        requestId: message.requestId,
      })
      return
    }

    if (!connection.sessionId) {
      this.sendError(socket, 'session_required', 'Call start_session before sending realtime events.', true)
      return
    }

    await this.forwardToHandler(message, {
      sessionId: connection.sessionId,
      requestId: message.requestId,
    })
  }

  private bindSession(connection: ConnectionState, requestedSessionId?: string): string {
    const sessionId = requestedSessionId ?? connection.sessionId ?? randomUUID()
    const previousSessionId = connection.sessionId

    if (previousSessionId && previousSessionId !== sessionId) {
      const previous = this.sessions.get(previousSessionId)
      if (previous?.socket === connection.socket) {
        this.sessions.delete(previousSessionId)
      }
    }

    connection.sessionId = sessionId

    this.sessions.set(sessionId, {
      sessionId,
      connectedAt: connection.openedAt,
      socket: connection.socket,
    })

    return sessionId
  }

  private async forwardToHandler(
    message: ClientToServerMessageInput,
    context: RealtimeContext,
  ): Promise<void> {
    if (!this.onClientEvent) {
      return
    }

    try {
      await this.onClientEvent(message, context)
    } catch (error) {
      const session = this.sessions.get(context.sessionId)
      if (!session) {
        return
      }

      const messageText = error instanceof Error ? error.message : 'Unknown realtime handler error.'
      console.error('Realtime handler failure:', messageText)
      this.sendError(session.socket, 'handler_failure', 'Server failed to process event.', false)
    }
  }

  private sendError(
    socket: GatewaySocket,
    code: string,
    message: string,
    recoverable: boolean,
  ): void {
    if (socket.readyState !== 1) {
      return
    }

    socket.send(
      stringifyServerEnvelope('error', {
        code,
        message,
        recoverable,
      }),
    )
  }
}

export function isClientEventType(
  message: ClientToServerMessageInput,
  type: ClientToServerEventName,
): boolean {
  return message.type === type
}
