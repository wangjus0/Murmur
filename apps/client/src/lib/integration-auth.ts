export const INTEGRATION_CONNECTION_STATE_STORAGE_KEY = "murmur.integrationConnectionState.v1";

const INTEGRATION_NAME_PATTERN = /^[\w .:@/-]{1,80}$/;
const FIELD_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_INTEGRATIONS = 256;
const MAX_FIELD_VALUES_PER_INTEGRATION = 24;
const MAX_FIELD_VALUE_LENGTH = 4096;

export type SessionStartIntegrationAuth = Record<
  string,
  {
    oauthConnected?: boolean;
    apiKeyValues?: Record<string, string>;
  }
>;

export function getStoredIntegrationAuthForSession(): SessionStartIntegrationAuth | null {
  try {
    const raw = localStorage.getItem(INTEGRATION_CONNECTION_STATE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Record<
      string,
      {
        oauthConnected?: unknown;
        apiKeyValues?: unknown;
      }
    >;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const entries: Array<[string, SessionStartIntegrationAuth[string]]> = [];
    for (const [integrationName, entry] of Object.entries(parsed)) {
      if (entries.length >= MAX_INTEGRATIONS || !entry || typeof entry !== "object") {
        continue;
      }

      const normalizedIntegrationName = normalizeIntegrationName(integrationName);
      if (!normalizedIntegrationName) {
        continue;
      }

      const oauthConnected = entry.oauthConnected === true;
      const apiKeyValues = normalizeApiKeyValues(entry.apiKeyValues);
      if (!oauthConnected && Object.keys(apiKeyValues).length === 0) {
        continue;
      }

      entries.push([
        normalizedIntegrationName,
        {
          ...(oauthConnected ? { oauthConnected: true } : {}),
          ...(Object.keys(apiKeyValues).length > 0 ? { apiKeyValues } : {}),
        },
      ]);
    }

    if (entries.length === 0) {
      return null;
    }

    return Object.fromEntries(entries);
  } catch {
    return null;
  }
}

function normalizeIntegrationName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || !INTEGRATION_NAME_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function normalizeApiKeyValues(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const entries: Array<[string, string]> = [];
  for (const [fieldId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (entries.length >= MAX_FIELD_VALUES_PER_INTEGRATION) {
      break;
    }

    const normalizedFieldId = normalizeFieldId(fieldId);
    if (!normalizedFieldId || typeof value !== "string") {
      continue;
    }

    const normalizedValue = value.trim().slice(0, MAX_FIELD_VALUE_LENGTH);
    if (normalizedValue.length === 0) {
      continue;
    }

    entries.push([normalizedFieldId, normalizedValue]);
  }

  return Object.fromEntries(entries);
}

function normalizeFieldId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || !FIELD_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}
