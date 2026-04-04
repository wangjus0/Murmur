# DiamondHacks 2026 Project Details

## Project Summary

This project is a voice-first, interactive AI web agent that lets users control web browsing through natural conversation.

Instead of typing or manually navigating pages, users speak requests in plain language. The system interprets intent, executes real browser actions, and responds with human-like narration of what it is doing.

Core experience loop:
1. User speaks request
2. Agent interprets intent
3. Agent executes actions on real websites
4. Agent narrates progress and results
5. User gives follow-up or interruption

## Core Integrations

- **ElevenLabs**: real-time speech-to-text (STT) and expressive text-to-speech (TTS)
- **Browser Use**: live browser automation and web task execution

## Product Vision

Create a conversational web assistant that feels like working with a capable human operator, not a traditional tool.

## MVP Scope (Hackathon Build)

### In Scope
- Real-time speech input and output
- Live browser execution on real websites
- Two intents:
  - `search`
  - `form_fill_draft` (fill only, no submit)
- Live transcript and action status UI
- Interrupt support via `stop`
- Safety guardrails:
  - domain allowlist
  - dangerous action blocking (`submit`, `pay`, `checkout`, confirmation actions)

### Out of Scope
- Full autonomous browsing across arbitrary websites
- Advanced retries/fallback planning
- Full preferences system
- Production-grade telemetry stack
- Multi-tenant auth and enterprise hardening

## High-Level Architecture

- `apps/client`
  - microphone input
  - websocket connection
  - transcript UI
  - action timeline/status UI
  - TTS playback

- `apps/server`
  - websocket gateway
  - turn-state orchestration
  - STT/TTS adapters
  - intent classification
  - Browser Use executor
  - safety policy layer

- `packages/shared`
  - shared event contracts
  - validation schemas
  - common types

## Turn-State Model

`idle -> listening -> thinking -> acting -> speaking -> idle`

Interrupt behavior:
- `interrupt` during `acting` or `speaking` cancels active run and returns to `idle`.

## Event Model (Minimum)

Client to server:
- `start_session`
- `audio_chunk`
- `audio_end`
- `interrupt`

Server to client:
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

## Safety Principles

- No final submit/payment actions in MVP
- Enforce domain allowlist before navigation
- Validate all inbound event payloads
- Provide friendly error narration and safe alternatives

## Technical Priorities

1. End-to-end reliability over feature breadth
2. Deterministic behavior on known demo sites
3. Clear user-facing transparency (what the agent is doing)
4. Fast interruption and graceful cancellation

## MVP Success Criteria

- User can speak a request and get spoken feedback quickly
- Agent completes at least two real browser task types end-to-end
- UI visibly streams transcript and action progress
- Interrupt works consistently
- Safety policy blocks dangerous actions

## Development Notes

- Keep state updates immutable
- Keep logic small and modular
- Validate external input at boundaries
- Prefer simple, testable flows before generalizing

## Future Roadmap (Post-MVP)

- broader intent set and planner quality
- robust fallback/recovery policy engine
- persistent memory and user preferences
- richer observability and analytics
- broader site compatibility and reliability hardening
