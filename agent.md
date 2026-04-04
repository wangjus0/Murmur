# Agent Context: DiamondHacks 2026 MVP

This file gives coding agents shared context for this repository.

## Product Goal

Build a voice-first, interactive AI web agent that:
- listens to user requests in natural speech,
- executes real actions on real websites,
- narrates what it is doing and what it found.

Primary integrations:
- ElevenLabs for speech-to-text (STT) and text-to-speech (TTS)
- Browser Use for live browser automation

## MVP Target (<=20 hours)

Deliver one reliable end-to-end loop:
1. User speaks request
2. Agent transcribes and classifies intent
3. Agent executes browser actions
4. Agent narrates progress and final result
5. User can interrupt with `stop`

### In Scope
- Real-time STT input
- Real-time TTS narration output
- Live browser execution through Browser Use
- Two intents only:
  - `search`
  - `form_fill_draft` (fill only, never submit)
- Live UI feedback:
  - transcript (partial + final)
  - action status timeline
- Safety guardrails:
  - domain allowlist
  - block dangerous actions (`submit`, `pay`, `checkout`, final confirmations)

### Out of Scope (MVP)
- Broad autonomous support for arbitrary websites
- Advanced retry/recovery orchestration
- Full preferences/settings system
- Production-grade observability stack
- Full multi-tenant auth architecture

## Recommended Architecture

- `apps/client`: mic capture, websocket client, transcript UI, status UI, audio playback
- `apps/server`: websocket gateway, turn state machine, STT/TTS adapters, orchestrator, safety layer, browser executor
- `packages/shared`: typed event contracts and validation schemas

## Required Turn State Machine

Use deterministic states:
- `idle -> listening -> thinking -> acting -> speaking -> idle`
- Any state can transition to `error`
- `interrupt` during `acting` or `speaking` returns to `idle`

Avoid ad hoc transitions.

## Event Contract (Minimum)

Agents should preserve or align with these event shapes:
- Client -> Server:
  - `start_session`
  - `audio_chunk`
  - `audio_end`
  - `interrupt`
- Server -> Client:
  - `session_started`
  - `state`
  - `transcript_partial`
  - `transcript_final`
  - `intent`
  - `action_status`
  - `narration_text`
  - `narration_audio`
  - `done`
  - `error`

## Intent Rules (MVP)

Only implement/maintain these:
- `search`
- `form_fill_draft`
- `clarify` fallback when confidence is low or request unsupported

If unsupported, narrate a concise clarification prompt.

## Safety Rules (Non-Negotiable)

- Never perform final submission/payment actions in MVP.
- Enforce navigation domain allowlist.
- On safety block, return user-friendly explanation and a safe next step.

## Engineering Constraints

- Prefer immutable updates to state objects.
- Validate all external input/events at boundaries.
- Keep implementation simple and demo-reliable over feature breadth.
- Prioritize deterministic behavior on 1-2 known demo websites.

## MVP Definition of Done

- Voice -> browser -> narration loop works end to end.
- Both supported intents complete on known demo flows.
- Interrupt (`stop`) cancels active turn.
- Dangerous actions are blocked by policy.
- UI shows transcript and action progress clearly.

## Suggested Next Steps for Agents

1. Implement shared event schemas in `packages/shared`.
2. Implement websocket session + turn state manager in server.
3. Add STT/TTS adapters and wire narration events.
4. Add Browser Use adapter with `search` and `form_fill_draft` handlers.
5. Implement safety policy checks before every browser action.
6. Build minimal client panels for transcript/status/audio playback.
