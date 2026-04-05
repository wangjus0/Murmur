export type IntegrationAuthMode = "oauth" | "api_key" | "oauth_and_api_key";

export interface IntegrationApiKeyField {
  id: string;
  label: string;
  placeholder: string;
  secret?: boolean;
}

export interface IntegrationAuthDescriptor {
  authMode: IntegrationAuthMode;
  oauthProvider?: string;
  oauthHelpText?: string;
  apiKeyFields?: IntegrationApiKeyField[];
}

const DEFAULT_API_KEY_FIELDS: IntegrationApiKeyField[] = [
  {
    id: "api_key",
    label: "API key",
    placeholder: "Enter API key",
    secret: true,
  },
];

const AUTH_MATRIX: Record<string, IntegrationAuthDescriptor> = {
  Discord: {
    authMode: "oauth",
    oauthProvider: "Discord",
  },
  Dropbox: {
    authMode: "oauth",
    oauthProvider: "Dropbox",
  },
  Exa: {
    authMode: "api_key",
    apiKeyFields: [
      {
        id: "api_key",
        label: "Exa API key",
        placeholder: "exa_...",
        secret: true,
      },
    ],
  },
  Figma: {
    authMode: "oauth",
    oauthProvider: "Figma",
  },
  GitHub: {
    authMode: "oauth",
    oauthProvider: "GitHub",
  },
  Gmail: {
    authMode: "oauth",
    oauthProvider: "Google",
  },
  "Google Calendar": {
    authMode: "oauth",
    oauthProvider: "Google",
  },
  "Google Docs": {
    authMode: "oauth",
    oauthProvider: "Google",
  },
  "Google Drive": {
    authMode: "oauth",
    oauthProvider: "Google",
  },
  "Google Sheets": {
    authMode: "oauth",
    oauthProvider: "Google",
  },
  HubSpot: {
    authMode: "oauth_and_api_key",
    oauthProvider: "HubSpot",
    apiKeyFields: [
      {
        id: "private_app_token",
        label: "Private app token",
        placeholder: "pat-...",
        secret: true,
      },
    ],
  },
  Jira: {
    authMode: "oauth_and_api_key",
    oauthProvider: "Atlassian",
    apiKeyFields: [
      {
        id: "api_token",
        label: "Jira API token",
        placeholder: "API token",
        secret: true,
      },
    ],
  },
  Linear: {
    authMode: "oauth",
    oauthProvider: "Linear",
  },
  Notion: {
    authMode: "oauth",
    oauthProvider: "Notion",
  },
  Outlook: {
    authMode: "oauth",
    oauthProvider: "Microsoft",
  },
  Salesforce: {
    authMode: "oauth",
    oauthProvider: "Salesforce",
  },
  Slack: {
    authMode: "oauth",
    oauthProvider: "Slack",
  },
  Stripe: {
    authMode: "api_key",
    apiKeyFields: [
      {
        id: "secret_key",
        label: "Stripe secret key",
        placeholder: "sk_live_...",
        secret: true,
      },
    ],
  },
  Supabase: {
    authMode: "api_key",
    apiKeyFields: [
      {
        id: "url",
        label: "Project URL",
        placeholder: "https://your-project.supabase.co",
      },
      {
        id: "service_role_key",
        label: "Service role key",
        placeholder: "eyJ...",
        secret: true,
      },
    ],
  },
};

const OAUTH_FALLBACK_SET = new Set([
  "Asana",
  "Attio",
  "Calendly",
  "Confluence",
  "Eventbrite",
  "Facebook",
  "FreshBooks",
  "Freshdesk",
  "GitLab",
  "Google Ads",
  "Google Analytics",
  "Google BigQuery",
  "Google Meet",
  "Google Search Console",
  "Google Slides",
  "Google Tasks",
  "Intercom",
  "Instagram",
  "Jotform",
  "Klaviyo",
  "LinkedIn",
  "Mailchimp",
  "Microsoft Teams",
  "Miro",
  "Monday",
  "OneDrive",
  "Pipedrive",
  "PostHog",
  "QuickBooks",
  "Reddit",
  "Salesmate",
  "Sentry",
  "ServiceNow",
  "SharePoint",
  "Shopify",
  "Snapchat",
  "Spotify",
  "Square",
  "Strava",
  "SurveyMonkey",
  "Telegram",
  "Tiktok",
  "Todoist",
  "Trello",
  "Twitter",
  "Typeform",
  "Vercel",
  "WhatsApp",
  "WordPress",
  "Wrike",
  "Xero",
  "YouTube",
  "Zendesk",
  "Zoho",
  "Zoom",
]);

export function getIntegrationAuthDescriptor(
  integrationName: string,
): IntegrationAuthDescriptor {
  const fromMatrix = AUTH_MATRIX[integrationName];
  if (fromMatrix) {
    return fromMatrix;
  }

  if (OAUTH_FALLBACK_SET.has(integrationName)) {
    return {
      authMode: "oauth",
      oauthProvider: integrationName,
    };
  }

  return {
    authMode: "api_key",
    apiKeyFields: DEFAULT_API_KEY_FIELDS,
  };
}

export function getAuthModeLabel(mode: IntegrationAuthMode): string {
  if (mode === "oauth") {
    return "OAuth";
  }

  if (mode === "api_key") {
    return "API Key";
  }

  return "OAuth + API Key";
}
