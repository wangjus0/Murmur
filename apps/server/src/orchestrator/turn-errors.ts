export class InvalidTransitionError extends Error {
  readonly currentState: string
  readonly eventType: string

  constructor(currentState: string, eventType: string) {
    super(`Invalid transition: state '${currentState}' cannot handle event '${eventType}'.`)
    this.name = 'InvalidTransitionError'
    this.currentState = currentState
    this.eventType = eventType
  }
}

export class MissingActiveTurnError extends Error {
  readonly currentState: string

  constructor(currentState: string) {
    super(`State '${currentState}' requires an active turn to process interruption.`)
    this.name = 'MissingActiveTurnError'
    this.currentState = currentState
  }
}
