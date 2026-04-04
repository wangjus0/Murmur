import type { User } from "@supabase/supabase-js";

export type GuardDestination = "auth" | "onboarding" | "home";

export function resolveGuardDestination(user: User | null): GuardDestination {
  if (!user) {
    return "auth";
  }

  if (user.user_metadata?.onboarding_completed === true) {
    return "home";
  }

  return "onboarding";
}
