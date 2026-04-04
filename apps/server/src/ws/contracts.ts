import {
  clientToServerMessageSchema,
  type ClientToServerMessageInput,
  type MessageEnvelope,
  type ServerToClientEventName,
  type ServerToClientPayloadMap,
} from '@diamond/shared'
import type { ZodIssue } from 'zod'

export type RawSocketMessage = string | Buffer | ArrayBuffer | Buffer[]

export type ParsedClientMessageResult =
  | { readonly ok: true; readonly message: ClientToServerMessageInput }
  | { readonly ok: false; readonly reason: string }

function normalizeRawMessage(raw: RawSocketMessage): string {
  if (typeof raw === 'string') {
    return raw
  }

  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString('utf8')
  }

  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8')
  }

  return raw.toString('utf8')
}

export function parseClientMessage(raw: RawSocketMessage): ParsedClientMessageResult {
  const normalized = normalizeRawMessage(raw)

  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch {
    return { ok: false, reason: 'Malformed JSON payload.' }
  }

  const validated = clientToServerMessageSchema.safeParse(parsed)
  if (!validated.success) {
    return {
      ok: false,
      reason: validated.error.issues.map((issue: ZodIssue) => issue.message).join('; '),
    }
  }

  return { ok: true, message: validated.data }
}

type EnvelopeOptions = Readonly<{
  requestId?: string
}>

export function createServerEnvelope<EventName extends ServerToClientEventName>(
  type: EventName,
  payload: ServerToClientPayloadMap[EventName],
  options: EnvelopeOptions = {},
): MessageEnvelope<EventName, ServerToClientPayloadMap[EventName]> {
  return {
    type,
    payload,
    requestId: options.requestId,
    timestamp: new Date().toISOString(),
  }
}

export function stringifyServerEnvelope<EventName extends ServerToClientEventName>(
  type: EventName,
  payload: ServerToClientPayloadMap[EventName],
  options: EnvelopeOptions = {},
): string {
  return JSON.stringify(createServerEnvelope(type, payload, options))
}
