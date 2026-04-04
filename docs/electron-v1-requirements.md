# Murmur Electron v1 Requirements Lock (Step 1)

## Scope

This document locks the Step 1 scope from `ELECTRON_APP_PLAN.md`.
Only final app flow and constraints are defined here. No implementation work from later steps is included.

## Locked Requirements (v1)

1. Target platform is a **macOS-first Electron desktop app**.
2. Authentication methods are limited to:
   - **Google OAuth** (Gmail sign-in)
   - **Manual email/password** sign-in
3. Onboarding is a **boilerplate scaffold only** for v1 (final field set/content deferred).
4. Backend is **Supabase project: Murmur only**.
5. Post-onboarding behavior includes a **global shortcut** that opens a voice command popup matching Image 1.

## Locked App Flow (v1)

1. User launches desktop app.
2. If not authenticated, user sees auth and can sign in with Google or email/password.
3. If authenticated but onboarding is incomplete, user sees onboarding scaffold.
4. After onboarding completion, user lands on app home.
5. From post-onboarding state, global shortcut toggles/opens the voice command popup.

## Non-Goals for Step 1

The following are explicitly out of scope for Step 1:

- Electron shell/window implementation and packaging setup.
- Supabase wiring, auth flow code, schema migrations, RLS policy implementation.
- Global shortcut registration and popup window implementation details.
- Full unit/integration/E2E test implementation.
- Signing/notarization and release readiness work.
- Final onboarding fields, copy, and completion logic beyond scaffold intent.

## Early Risks (for later steps)

- Desktop OAuth redirect/callback handling in Electron can be complex.
- "Match Image 1" requires explicit visual specs to avoid fidelity drift.
- Global shortcuts may conflict with existing macOS/system/app bindings.

## Acceptance Signal for Step 1

Step 1 is complete when this requirements lock is approved and treated as source-of-truth for v1 scope.
