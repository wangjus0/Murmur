import type { ServerToClientMessage } from '@diamond/shared'
import { serverToClientMessageSchema } from '@diamond/shared'

type ParseServerMessageResult =
  | { readonly ok: true; readonly message: ServerToClientMessage }
  | { readonly ok: false; readonly reason: string }

export function parseServerMessage(raw: string): ParseServerMessageResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'Malformed JSON payload.' }
  }

  const validated = serverToClientMessageSchema.safeParse(parsed)
  if (!validated.success) {
    return {
      ok: false,
      reason: validated.error.issues.map((issue) => issue.message).join('; '),
    }
  }

  return {
    ok: true,
    message: validated.data as ServerToClientMessage,
  }
}
