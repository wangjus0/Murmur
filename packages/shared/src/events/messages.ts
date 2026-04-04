import type {
  ClientToServerEventName,
  ServerToClientEventName,
} from '../constants/event-names.ts';
import type {
  ClientToServerPayloadMap,
  ServerToClientPayloadMap,
} from './payloads.ts';

export type MessageEnvelope<EventName extends string, Payload> = Readonly<{
  type: EventName;
  payload: Payload;
  requestId?: string;
  timestamp?: string;
}>;

type MessageFromMap<
  EventName extends string,
  PayloadMap extends Record<string, unknown>,
> = {
  [Key in EventName]: Key extends keyof PayloadMap
    ? MessageEnvelope<Key, PayloadMap[Key]>
    : never;
}[EventName];

export type ClientToServerMessage = MessageFromMap<
  ClientToServerEventName,
  ClientToServerPayloadMap
>;

export type ServerToClientMessage = MessageFromMap<
  ServerToClientEventName,
  ServerToClientPayloadMap
>;

export type AnySocketMessage = ClientToServerMessage | ServerToClientMessage;

type ExactKeys<Expected extends string, Actual extends string> = [
  Exclude<Expected, Actual>,
  Exclude<Actual, Expected>,
] extends [never, never]
  ? true
  : never;

const _clientEventPayloadKeysAligned: ExactKeys<
  ClientToServerEventName,
  Extract<keyof ClientToServerPayloadMap, string>
> = true;

const _serverEventPayloadKeysAligned: ExactKeys<
  ServerToClientEventName,
  Extract<keyof ServerToClientPayloadMap, string>
> = true;
