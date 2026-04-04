export * from "./events/types.js";
export * from "./schemas/events.js";
export * from "./constants/audio.js";

export {
  CLIENT_TO_SERVER_EVENT_NAMES,
  SERVER_TO_CLIENT_EVENT_NAMES,
} from "./constants/event-names.js";
export type {
  ClientToServerEventName,
  ServerToClientEventName,
} from "./constants/event-names.js";

export type {
  ActionOutcome,
  AudioInputEncoding,
  AudioOutputEncoding,
  IntentName,
  TurnState,
} from "./types/contracts.js";

export type {
  ActionStatusPayload,
  AudioChunkPayload,
  AudioEndPayload,
  ClientToServerPayloadMap,
  DonePayload,
  ErrorPayload,
  IntentPayload,
  InterruptPayload,
  NarrationAudioPayload,
  NarrationTextPayload,
  ServerToClientPayloadMap,
  SessionStartedPayload,
  StartSessionPayload,
  StatePayload,
  TranscriptFinalPayload,
  TranscriptPartialPayload,
} from "./events/payloads.js";

export type {
  AnySocketMessage,
  ClientToServerMessage,
  MessageEnvelope,
  ServerToClientMessage,
} from "./events/messages.js";

export {
  audioChunkMessageSchema,
  audioChunkPayloadSchema,
  audioEndMessageSchema,
  audioEndPayloadSchema,
  clientToServerMessageSchema,
  interruptMessageSchema,
  interruptPayloadSchema,
  startSessionMessageSchema,
  startSessionPayloadSchema,
} from "./schemas/client-inbound.js";

export {
  actionStatusMessageSchema,
  actionStatusPayloadSchema,
  doneMessageSchema,
  donePayloadSchema,
  errorMessageSchema,
  errorPayloadSchema,
  intentMessageSchema,
  intentPayloadSchema,
  narrationAudioMessageSchema,
  narrationAudioPayloadSchema,
  narrationTextMessageSchema,
  narrationTextPayloadSchema,
  serverToClientMessageSchema,
  sessionStartedMessageSchema,
  sessionStartedPayloadSchema,
  stateMessageSchema,
  statePayloadSchema,
  transcriptFinalMessageSchema,
  transcriptFinalPayloadSchema,
  transcriptPartialMessageSchema,
  transcriptPartialPayloadSchema,
} from "./schemas/server-inbound.js";

export type {
  AudioChunkMessageInput,
  AudioChunkPayloadInput,
  AudioEndMessageInput,
  AudioEndPayloadInput,
  ClientToServerMessageInput,
  InterruptMessageInput,
  InterruptPayloadInput,
  StartSessionMessageInput,
  StartSessionPayloadInput,
} from "./schemas/client-inbound.js";

export type {
  ActionStatusMessageInput,
  ActionStatusPayloadInput,
  DoneMessageInput,
  DonePayloadInput,
  ErrorMessageInput,
  ErrorPayloadInput,
  IntentMessageInput,
  IntentPayloadInput,
  NarrationAudioMessageInput,
  NarrationAudioPayloadInput,
  NarrationTextMessageInput,
  NarrationTextPayloadInput,
  ServerToClientMessageInput,
  SessionStartedMessageInput,
  SessionStartedPayloadInput,
  StateMessageInput,
  StatePayloadInput,
  TranscriptFinalMessageInput,
  TranscriptFinalPayloadInput,
  TranscriptPartialMessageInput,
  TranscriptPartialPayloadInput,
} from "./schemas/server-inbound.js";
