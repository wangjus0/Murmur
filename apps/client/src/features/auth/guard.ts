import type { User } from "@supabase/supabase-js";

export type GuardDestination = "auth" | "onboarding" | "home";

export function resolveGuardDestination(user: User | null, onboardingCompleted: boolean): GuardDestination {
  if (!user) {
    return "auth";
  }

  if (onboardingCompleted) {
    return "home";
  }

  return "onboarding";
}
