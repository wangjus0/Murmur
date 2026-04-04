# DiamondHacks 2026 Project Details

This document is organized into independent work sets so multiple agents can build in parallel with minimal overlap.

## 0. Project Summary

Build a voice-first AI web agent that:
1. Listens to natural speech
2. Understands user intent
3. Executes real browser actions on real websites
4. Narrates progress and results
5. Supports follow-up and interruption

Core integrations:
- ElevenLabs (STT + TTS)
- Browser Use (browser automation)

MVP scope:
- Intents: `search`, `form_fill_draft` (never submit)
- UI: live transcript + action timeline + voice playback
- Safety: allowlisted domains + dangerous action blocking

---

## 1. Environment and Configuration Set

Goal: Ensure all required runtime configuration exists and is validated.

### Inputs
- `apps/server/src/.env.example`

### Current variables
```bash
PORT=3000

ELEVEN_LABS_API_KEY=
BROWSER_USE_API_KEY=

GEMINI_API_KEY=
```

### Tasks
1. Implement strict env parsing/validation in server startup.
2. Fail fast with clear errors when required keys are missing.
3. Keep secrets out of source control.

### Deliverable
- Server boots only when required env vars are present and valid.

---

## 2. Shared Contracts Set (`packages/shared`)

Goal: Define stable event and schema contracts between client and server.

### Tasks
1. Add event type definitions for all websocket messages.
2. Add runtime schema validation (zod) for inbound payloads.
3. Export shared types for client and server usage.

### Minimum event model
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

### Deliverable
- One shared contract source of truth used by both apps.

---

## 3. Realtime Transport Set (`apps/server` + `apps/client`)

Goal: Enable low-latency session communication over websockets.

### Tasks
1. Implement websocket connection and session handshake.
2. Handle reconnect/disconnect safely.
3. Route validated events through shared contract layer.

### Deliverable
- Client can start session and receive server events in real time.

---

## 4. Turn State Machine Set (`apps/server`)

Goal: Create deterministic orchestration state transitions.

### Required states
`idle -> listening -> thinking -> acting -> speaking -> idle`

Interrupt rule:
- `interrupt` during `acting` or `speaking` must cancel and return to `idle`.

### Tasks
1. Implement central state transition function.
2. Add cancellation token support for active turn.
3. Reject invalid transitions.

### Deliverable
- Reliable turn lifecycle with no ad hoc state mutations.

---

## 5. Voice Input Set (STT)

Goal: Stream microphone audio and produce partial/final transcripts.

### Tasks
1. Capture mic audio in client and stream chunks.
2. Connect server stream to ElevenLabs STT.
3. Emit `transcript_partial` and `transcript_final` events.

### Deliverable
- User speech appears live and finalizes reliably.

---

## 6. Voice Output Set (TTS)

Goal: Generate and play narration audio from server-side status text.

### Tasks
1. Add server TTS adapter using ElevenLabs.
2. Emit `narration_text` and `narration_audio` events.
3. Queue and play audio on client in order.

### Deliverable
- Agent narrates actions and final results with clear playback.

---

## 7. Intent Classification Set

Goal: Map user text to MVP intents.

### Supported intents
- `search`
- `form_fill_draft`
- `clarify` fallback

### Tasks
1. Implement lightweight intent classifier.
2. Return confidence score.
3. For low confidence, produce concise clarification prompt.

### Deliverable
- Final transcript consistently routes to one supported intent.

---

## 8. Browser Execution Set (Browser Use)

Goal: Execute real browser actions and emit action telemetry.

### Tasks
1. Build Browser Use adapter with cancellable execution.
2. Implement `search` handler (collect top results).
3. Implement `form_fill_draft` handler (fill only, no submit).
4. Emit `action_status` per meaningful step.

### Deliverable
- Two end-to-end real-web task flows work on known demo sites.

---

## 9. Safety and Policy Set

Goal: Enforce non-negotiable safeguards.

### Rules
1. Domain allowlist required before navigation.
2. Block dangerous actions: `submit`, `pay`, `checkout`, final confirmations.
3. Never allow final form submission in MVP.

### Tasks
1. Add pre-action policy checks in executor.
2. Return user-friendly safety block messages.
3. Log blocked events for debugging.

### Deliverable
- Unsafe actions are blocked every time before execution.

---

## 10. Client UX Set

Goal: Provide clear, transparent interaction feedback.

### Tasks
1. Add mic controls (start/stop).
2. Render transcript panel (partial + final).
3. Render action timeline/status feed.
4. Add visible interrupt button.
5. Show current turn state badge.

### Deliverable
- User can see exactly what was said, what the agent is doing, and what happened.

---

## 11. Persistence Set (Optional MVP+)

Goal: Persist session context for replay/debugging.

### Tasks
1. Persist session metadata.
2. Persist transcript messages.
3. Persist action events.

### Deliverable
- Session can be reloaded and reviewed after run.

Note: If time is limited, use in-memory storage for MVP and defer this set.

---

## 12. Testing and Verification Set

Goal: Validate core reliability for demo readiness.

### Minimum tests
1. Unit: intent classifier.
2. Unit: policy/safety checks.
3. Unit: turn state transitions.
4. Integration: transcript final -> intent -> browser action -> done.
5. Integration: interrupt cancels active execution.

### Deliverable
- Core flows are repeatable and safe for demo.

---

## 13. Parallelization Guide for Multiple Agents

Recommended parallel sets:
- Agent A: Set 2 (Shared Contracts) + Set 12 (Unit tests for contracts)
- Agent B: Set 3 (Realtime Transport) + Set 4 (State Machine)
- Agent C: Set 5 (STT) + Set 6 (TTS)
- Agent D: Set 8 (Browser Execution) + Set 9 (Safety)
- Agent E: Set 10 (Client UX)

Then merge sequence:
1. Sets 1-4
2. Sets 5-6
3. Sets 7-9
4. Sets 10-12

---

## 14. MVP Definition of Done

1. Voice -> browser -> narration loop works end-to-end.
2. `search` and `form_fill_draft` both work on known demo sites.
3. `stop` interrupt reliably cancels active turn.
4. Dangerous actions are blocked by policy.
5. UI shows transcript + action progress clearly.
