import test from 'node:test'
import assert from 'node:assert/strict'

import {
  transitionTurnState,
  type TurnState,
  type TurnMachineContext,
} from '../../apps/server/src/orchestrator/turn-state-machine.ts'
import { createActiveTurn } from '../../apps/server/src/orchestrator/turn-context.ts'
import { InvalidTransitionError } from '../../apps/server/src/orchestrator/turn-errors.ts'

test('state machine follows deterministic lifecycle', () => {
  let state: TurnState = 'idle'
  let context: TurnMachineContext = { activeTurn: null }

  let result = transitionTurnState(state, { type: 'start_listening' }, context)
  state = result.state
  context = result.context
  assert.equal(state, 'listening')

  result = transitionTurnState(state, { type: 'audio_finalized' }, context)
  state = result.state
  context = result.context
  assert.equal(state, 'thinking')

  const activeTurn = createActiveTurn()
  context = { activeTurn }

  result = transitionTurnState(state, { type: 'intent_ready' }, context)
  state = result.state
  context = result.context
  assert.equal(state, 'acting')

  result = transitionTurnState(state, { type: 'action_completed' }, context)
  state = result.state
  context = result.context
  assert.equal(state, 'speaking')

  result = transitionTurnState(state, { type: 'narration_completed' }, context)
  state = result.state
  context = result.context
  assert.equal(state, 'idle')
  assert.equal(context.activeTurn, null)
})

test('invalid transitions are rejected', () => {
  assert.throws(
    () => transitionTurnState('idle', { type: 'action_completed' }, { activeTurn: null }),
    InvalidTransitionError,
  )

  assert.throws(
    () => transitionTurnState('listening', { type: 'interrupt' }, { activeTurn: null }),
    InvalidTransitionError,
  )
})

test('error event cancels active turn and transitions to error state', () => {
  const activeTurn = createActiveTurn()

  const result = transitionTurnState('acting', { type: 'error' }, { activeTurn })

  assert.equal(result.state, 'error')
  assert.equal(result.context.activeTurn, null)
  assert.equal(activeTurn.token.signal.aborted, true)
})
