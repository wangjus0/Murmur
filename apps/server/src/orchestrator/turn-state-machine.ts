import { MissingActiveTurnError, InvalidTransitionError } from './turn-errors.js'
import { cancelActiveTurn } from './turn-context.js'
import type { ActiveTurn } from './turn-context.js'

export type TurnState = 'idle' | 'listening' | 'thinking' | 'acting' | 'speaking' | 'error'

export type TurnEventType =
  | 'start_listening'
  | 'audio_finalized'
  | 'intent_ready'
  | 'action_completed'
  | 'narration_completed'
  | 'interrupt'
  | 'error'
  | 'reset'

export interface TurnEvent {
  readonly type: TurnEventType
}

export interface TurnMachineContext {
  readonly activeTurn: ActiveTurn | null
}

export interface TurnTransitionResult {
  readonly state: TurnState
  readonly context: TurnMachineContext
}

const TRANSITIONS: Readonly<Record<TurnState, Readonly<Partial<Record<TurnEventType, TurnState>>>>> = {
  idle: {
    start_listening: 'listening',
    error: 'error',
  },
  listening: {
    audio_finalized: 'thinking',
    error: 'error',
  },
  thinking: {
    intent_ready: 'acting',
    error: 'error',
  },
  acting: {
    action_completed: 'speaking',
    interrupt: 'idle',
    error: 'error',
  },
  speaking: {
    narration_completed: 'idle',
    interrupt: 'idle',
    error: 'error',
  },
  error: {
    reset: 'idle',
  },
}

export function transitionTurnState(
  currentState: TurnState,
  event: TurnEvent,
  context: TurnMachineContext,
): TurnTransitionResult {
  const nextState = TRANSITIONS[currentState][event.type]

  if (!nextState) {
    throw new InvalidTransitionError(currentState, event.type)
  }

  if (event.type === 'error') {
    return {
      state: nextState,
      context: {
        activeTurn: context.activeTurn ? cancelActiveTurn(context.activeTurn, 'error') : null,
      },
    }
  }

  if (event.type === 'interrupt') {
    if (!context.activeTurn) {
      throw new MissingActiveTurnError(currentState)
    }

    return {
      state: nextState,
      context: {
        activeTurn: cancelActiveTurn(context.activeTurn),
      },
    }
  }

  if (event.type === 'narration_completed') {
    return {
      state: nextState,
      context: {
        activeTurn: null,
      },
    }
  }

  if (event.type === 'reset') {
    return {
      state: nextState,
      context: {
        activeTurn: null,
      },
    }
  }

  return {
    state: nextState,
    context,
  }
}
