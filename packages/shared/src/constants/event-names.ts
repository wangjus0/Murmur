export const CLIENT_TO_SERVER_EVENT_NAMES = [
  "start_session",
  "audio_chunk",
  "audio_end",
  "interrupt",
] as const;

export const SERVER_TO_CLIENT_EVENT_NAMES = [
  "session_started",
  "state",
  "transcript_partial",
  "transcript_final",
  "intent",
  "action_status",
  "narration_text",
  "narration_audio",
  "done",
  "error",
] as const;

export type ClientToServerEventName =
  (typeof CLIENT_TO_SERVER_EVENT_NAMES)[number];

export type ServerToClientEventName =
  (typeof SERVER_TO_CLIENT_EVENT_NAMES)[number];
