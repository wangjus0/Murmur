import test from 'node:test'
import assert from 'node:assert/strict'

import { transitionTurnState } from '../../apps/server/src/orchestrator/turn-state-machine.ts'
import { createActiveTurn } from '../../apps/server/src/orchestrator/turn-context.ts'
import { MissingActiveTurnError } from '../../apps/server/src/orchestrator/turn-errors.ts'

test('interrupt during acting cancels active turn and returns idle', () => {
  const activeTurn = createActiveTurn()

  const result = transitionTurnState('acting', { type: 'interrupt' }, { activeTurn })

  assert.equal(result.state, 'idle')
  assert.equal(result.context.activeTurn, null)
  assert.equal(activeTurn.token.signal.aborted, true)
})

test('interrupt during speaking cancels active turn and returns idle', () => {
  const activeTurn = createActiveTurn()

  const result = transitionTurnState('speaking', { type: 'interrupt' }, { activeTurn })

  assert.equal(result.state, 'idle')
  assert.equal(result.context.activeTurn, null)
  assert.equal(activeTurn.token.signal.aborted, true)
})

test('interrupt without active turn fails in cancellable states', () => {
  assert.throws(
    () => transitionTurnState('acting', { type: 'interrupt' }, { activeTurn: null }),
    MissingActiveTurnError,
  )

  assert.throws(
    () => transitionTurnState('speaking', { type: 'interrupt' }, { activeTurn: null }),
    MissingActiveTurnError,
  )
})
