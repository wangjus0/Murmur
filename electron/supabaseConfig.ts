export type SupabasePublicConfig = {
  readonly url: string;
  readonly anonKey: string;
};

function getEnvValue(name: "SUPABASE_URL" | "SUPABASE_ANON_KEY", env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function readSupabasePublicConfig(env: NodeJS.ProcessEnv = process.env): SupabasePublicConfig {
  const url = getEnvValue("SUPABASE_URL", env);
  const anonKey = getEnvValue("SUPABASE_ANON_KEY", env);
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL must be a valid URL");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("SUPABASE_URL must use http or https");
  }

  return {
    url,
    anonKey,
  };
}
