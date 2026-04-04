export interface TurnCancellationToken {
  readonly turnId: string
  readonly signal: AbortSignal
}

export interface ActiveTurn {
  readonly turnId: string
  readonly token: TurnCancellationToken
  readonly controller: AbortController
}

let turnSequence = 0

export function createActiveTurn(): ActiveTurn {
  turnSequence += 1
  const turnId = `turn-${turnSequence}`
  const controller = new AbortController()

  return {
    turnId,
    token: {
      turnId,
      signal: controller.signal,
    },
    controller,
  }
}

export function cancelActiveTurn(activeTurn: ActiveTurn, reason = 'interrupted'): null {
  if (!activeTurn.controller.signal.aborted) {
    activeTurn.controller.abort(reason)
  }

  return null
}
