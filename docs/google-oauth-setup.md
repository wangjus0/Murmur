# Google OAuth Setup (Supabase + Electron)

This app uses Supabase Auth for Google sign-in and finishes the desktop flow with a deep link callback (`murmur://auth/callback`).

## 1) Google Cloud OAuth client

Create a **Web application** OAuth client in Google Cloud and set the redirect URI to:

`https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`

For this repository's Supabase project, that is:

`https://widbrlxfiolngkncgbkm.supabase.co/auth/v1/callback`

## 2) Supabase Auth provider config

In Supabase dashboard:

1. Open `Authentication` -> `Providers` -> `Google`
2. Enable Google provider
3. Paste your Google OAuth client ID and client secret
4. Save

## 3) Supabase redirect allowlist

In Supabase dashboard:

1. Open `Authentication` -> `URL Configuration`
2. Add this redirect URL to the allowlist:

`murmur://auth/callback`

Without this allowlist entry, browser verification can succeed but Supabase cannot redirect back to the Electron app.

## 4) Supabase email templates (required for auto return + auto sign-in)

In Supabase dashboard:

1. Open `Authentication` -> `Templates`
2. For `Confirm signup`, ensure the CTA link uses `{{ .ConfirmationURL }}`
3. For `Magic Link`, `Change Email Address`, and `Reset Password`, use the same pattern
4. Do **not** hardcode `Site URL` links in those templates for desktop auth flows

This app sets `emailRedirectTo` / `redirectTo` to `murmur://auth/callback`, so using `{{ .ConfirmationURL }}` ensures the final link returns to the desktop app and lets Supabase complete session creation in-app.

## 5) Local env values

Store these values in `apps/server/.env`:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

The Electron app already reads Supabase public config from the same env source when running `npm run dev:electron`.

## 6) Run and verify

1. Start app: `npm run dev:electron`
2. Click `Continue with Google`
3. Complete Google consent in browser
4. Confirm app receives callback and signs in automatically
5. Create a new email/password account and click verification email link
6. Confirm the link opens the app and the user is signed in without manual login

If sign-up or OAuth returns redirect allowlist errors, verify `murmur://auth/callback` is present in Supabase redirect URLs.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Auth redirect is not allowlisted` | `murmur://auth/callback` missing from Supabase redirect URL allowlist | Add `murmur://auth/callback` under Supabase `Authentication -> URL Configuration` |
| `Google sign-in is not configured in Supabase` | Google provider disabled or missing client credentials | Enable Google under `Authentication -> Providers` and add Google OAuth client ID/secret |
| Browser opens but app never signs in | Deep link callback never reaches app (protocol handler issue) | Restart app after first install, then run `open "murmur://auth/callback?code=test"` to verify protocol capture |
| `Google OAuth client configuration is invalid` | Google OAuth client/secret mismatch in Supabase | Recreate Google web OAuth credentials and update Supabase provider config |
| `OAuth URL is not allowlisted` before browser opens | Generated OAuth URL does not match Supabase project origin configured in app | Confirm `SUPABASE_URL` is correct in `apps/server/.env` and rerun `npm run dev:electron` |
