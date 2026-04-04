# Murmur Electron App Plan (Step-by-Step)

## Step 1: Define Final App Flow and Constraints

1. Confirm target is **macOS Electron app** (desktop-first).
2. Confirm auth methods:
   - Google OAuth (Gmail sign-in)
   - Manual sign-in (email/password)
3. Confirm onboarding is a **boilerplate scaffold** for now (fields to be added later).
4. Confirm backend is **Supabase project: Murmur only**.
5. Confirm post-onboarding behavior:
   - Global shortcut opens voice command popup matching Image 1.

**Output:** Locked requirements and non-goals for v1.

---

## Step 2: Prepare Electron App Shell

1. Create Electron entry files:
   - `electron/main.ts`
   - `electron/preload.ts`
   - `electron/windows/mainWindow.ts`
   - `electron/windows/voicePopoverWindow.ts`
2. Connect existing frontend renderer to Electron window.
3. Configure secure Electron defaults:
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - strict preload API
4. Add development start scripts and production build scripts.

**Output:** App runs locally as Electron desktop app.

---

## Step 3: Configure macOS Packaging

1. Add `electron-builder` config in project settings.
2. Set macOS targets (`dmg`, optional `zip`).
3. Add app metadata:
   - `appId`
   - `productName`
   - app icon
4. Build unsigned local package for first validation.

**Output:** Installable macOS build artifact generated locally.

---

## Step 4: Connect Supabase (Murmur Only)

1. Use only Murmur credentials and environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
2. Add startup checks to fail fast if env vars are missing.
3. Initialize Supabase client in safe renderer/preload layer.
4. Keep service-role secrets out of client-side code.

**Output:** Electron app securely connected to Murmur Supabase.

---

## Step 5: Build Authentication (Manual + Google OAuth)

1. In Murmur Supabase Auth:
   - enable email/password auth
   - enable Google provider
   - configure desktop-compatible OAuth redirect/callback
2. Implement manual auth UI:
   - Sign up
   - Sign in
   - Password reset scaffold
3. Implement Google OAuth login flow in Electron:
   - open auth in browser/popup
   - receive callback in app
   - store session securely
4. Implement route guards:
   - not signed in -> auth screen
   - signed in, not onboarded -> onboarding
   - signed in + onboarded -> home

**Output:** Both auth methods work end-to-end.

---

## Step 6: Create Supabase Schema for Profiles + Onboarding

1. Create `profiles` table:
   - `id` references `auth.users.id`
   - basic identity fields (email, name, avatar)
2. Create `onboarding_responses` table:
   - `user_id` references `auth.users.id`
   - `responses jsonb` for flexible future fields
   - completion flags/timestamps
3. Add SQL migrations in `supabase/migrations`.
4. Enable RLS on both tables.
5. Add policies so users can only access their own records.

**Output:** Secure data model ready for onboarding and user info storage.

---

## Step 7: Implement Onboarding Boilerplate

1. Build multi-step onboarding container UI.
2. Add placeholder steps/components (field content to be provided later).
3. Add schema-based validation layer (extensible).
4. Save onboarding progress to `onboarding_responses.responses`.
5. On completion:
   - set `completed = true`
   - set completion timestamp
   - redirect user to app home

**Output:** Fully working onboarding skeleton with persistent storage.

---

## Step 8: Add Global Shortcut Trigger

1. Register global shortcut in Electron main process.
2. Default shortcut recommendation: `CommandOrControl+Shift+Space`.
3. Make shortcut configurable for future conflicts.
4. Add reliable toggle behavior:
   - press once -> open popover
   - press again -> close popover
   - `Esc` -> close popover

**Output:** Keyboard shortcut opens/closes command UI globally.

---

## Step 9: Build Voice Command Popover (Image 1 Match)

1. Create separate frameless transparent window for popover.
2. Style to match provided visual:
   - black rounded pill
   - centered vertical bars icon
   - subtle shadow + soft pulse animation
3. Window behavior:
   - always on top
   - hidden from dock/task switcher
   - top-center placement
4. Keep it lightweight and instant to show/hide.

**Output:** Voice popup UI matches design direction and interaction pattern.

---

## Step 10: Security Hardening and Session Safety

1. Lock IPC channels to explicit allowlist.
2. Validate all input at renderer-to-main boundaries.
3. Ensure no sensitive keys are shipped in client bundle.
4. Verify token refresh/session restore behavior.
5. Confirm RLS blocks cross-user access in Murmur.

**Output:** App is secure enough for beta distribution.

---

## Step 11: Test the Full User Journey

1. Unit tests:
   - auth state transitions
   - onboarding state and validation
   - shortcut toggle logic
2. Integration tests:
   - auth + profile creation
   - onboarding save/complete path
3. E2E tests:
   - Google OAuth path
   - manual sign-in path
   - onboarding completion path
   - shortcut popover visibility behavior

**Output:** Verified end-to-end workflow from install to voice popup.

---

## Step 12: macOS Release Preparation

1. Configure Apple code signing.
2. Configure notarization.
3. Build signed + notarized `.dmg`.
4. Validate install/uninstall + first run behavior.

**Output:** Production-ready macOS Electron installer.

---

## Final Checklist

- [ ] Electron app boots existing project UI
- [ ] Murmur Supabase is the only backend used
- [ ] Google OAuth sign-in works
- [ ] Manual email/password sign-in works
- [ ] Onboarding boilerplate saves data and marks completion
- [ ] Global shortcut toggles voice popup
- [ ] Voice popup visually matches Image 1
- [ ] RLS policies protect all onboarding/profile data
- [ ] Signed + notarized macOS package generated
