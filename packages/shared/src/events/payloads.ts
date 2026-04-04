import type {
  AudioChunkPayloadInput,
  AudioEndPayloadInput,
  InterruptPayloadInput,
  StartSessionPayloadInput,
} from '../schemas/client-inbound.ts';
import type {
  ActionStatusPayloadInput,
  DonePayloadInput,
  ErrorPayloadInput,
  IntentPayloadInput,
  NarrationAudioPayloadInput,
  NarrationTextPayloadInput,
  SessionStartedPayloadInput,
  StatePayloadInput,
  TranscriptFinalPayloadInput,
  TranscriptPartialPayloadInput,
} from '../schemas/server-inbound.ts';

export type StartSessionPayload = StartSessionPayloadInput;
export type AudioChunkPayload = AudioChunkPayloadInput;
export type AudioEndPayload = AudioEndPayloadInput;
export type InterruptPayload = InterruptPayloadInput;
export type SessionStartedPayload = SessionStartedPayloadInput;
export type StatePayload = StatePayloadInput;
export type TranscriptPartialPayload = TranscriptPartialPayloadInput;
export type TranscriptFinalPayload = TranscriptFinalPayloadInput;
export type IntentPayload = IntentPayloadInput;
export type ActionStatusPayload = ActionStatusPayloadInput;
export type NarrationTextPayload = NarrationTextPayloadInput;
export type NarrationAudioPayload = NarrationAudioPayloadInput;
export type DonePayload = DonePayloadInput;
export type ErrorPayload = ErrorPayloadInput;

export type ClientToServerPayloadMap = {
  start_session: StartSessionPayload;
  audio_chunk: AudioChunkPayload;
  audio_end: AudioEndPayload;
  interrupt: InterruptPayload;
};

export type ServerToClientPayloadMap = {
  session_started: SessionStartedPayload;
  state: StatePayload;
  transcript_partial: TranscriptPartialPayload;
  transcript_final: TranscriptFinalPayload;
  intent: IntentPayload;
  action_status: ActionStatusPayload;
  narration_text: NarrationTextPayload;
  narration_audio: NarrationAudioPayload;
  done: DonePayload;
  error: ErrorPayload;
};
