import type { AiClient } from "../config/ai-client.js";
import { z } from "zod";

/**
 * Tool Guide — sits between intent classification and execution.
 * Given the user's request, determines the optimal execution strategy
 * using available Composio integrations + browser automation.
 */

// Curated list of high-value integrations grouped by category.
// We don't send all 978 to Gemini — just the ones most likely to be useful.
// IMPORTANT: The integrations listed under "BrowserUse Connected Integrations" are
// available as OAuth-connected accounts via BrowserUse. When a task targets one of
// these services, ALWAYS prefer the integration over raw web browsing.
const INTEGRATION_CATALOG = `
## BrowserUse Connected Integrations
These integrations are available as authenticated OAuth connections via BrowserUse.
Use them DIRECTLY instead of navigating websites manually.
CRITICAL: Prefer these integrations even when the user does NOT name the brand.

### Email
- Gmail (tool: gmail) — read/send/search emails, manage labels, list inbox
  Triggers: "email", "emails", "inbox", "unread", "check my email", "read my emails",
            "my recent emails", "new emails", "compose email", "send email", "reply to email"
- Outlook (tool: outlook) — read/send emails, manage folders
  Triggers: "outlook", "hotmail", "microsoft email"

### Communication
- Slack (tool: slack) — send/read messages, manage channels
  Triggers: "slack", "slack message", "slack channel", "message on slack"
- Discord (tool: discord) — send messages, read channels, manage servers
  Triggers: "discord", "discord message", "discord server"

### Storage & Data
- Google Drive (tool: google_drive) — file management, sharing, upload/download
  Triggers: "google drive", "my drive", "my files on drive"
- Google Sheets (tool: google_sheets) — read/write spreadsheet data, formulas
  Triggers: "google sheets", "spreadsheet", "my spreadsheet"
- Dropbox (tool: dropbox) — file storage, sharing
  Triggers: "dropbox"
- Supabase (tool: supabase) — database queries, table management
  Triggers: "supabase", "my database"

### Productivity
- Google Calendar (tool: google_calendar) — create/read/update events, check availability
  Triggers: "google calendar", "my calendar", "calendar", "schedule", "appointments",
            "upcoming events", "what's on my calendar", "add to calendar", "schedule a meeting"
- Google Docs (tool: google_docs) — create/edit documents
  Triggers: "google docs", "my document", "create a doc"
- Notion (tool: notion) — pages, databases, notes
  Triggers: "notion", "notion page", "my notes"

### Developer Tools
- GitHub (tool: github) — repos, issues, PRs, code search
  Triggers: "github", "my repos", "pull requests", "open PRs", "github issues"
- Exa (tool: exa) — AI-powered web search (use for broad research queries)
- Jira (tool: jira) — issue/project tracking
  Triggers: "jira", "jira tickets", "my tickets"
- Linear (tool: linear) — issue tracking
  Triggers: "linear", "linear issues"

### Design
- Figma (tool: figma) — view/manage design files
  Triggers: "figma", "my figma files"

### CRM & Sales
- HubSpot (tool: hubspot) — contacts, deals, companies
  Triggers: "hubspot", "my contacts", "my deals"
- Salesforce (tool: salesforce) — CRM data
  Triggers: "salesforce"

### Payments
- Stripe (tool: stripe) — payment data, invoices, customers
  Triggers: "stripe", "my payments", "my invoices", "stripe customers"

## Browser Automation (LAST RESORT — only use when no integration covers the task)
- Direct web browsing: navigate any website, click, type, scroll, extract content
- Form filling: fill out web forms (draft mode by default)
- Multi-site comparison: compare data across multiple websites
- Web scraping: extract structured data from any page
Examples of when to use browser_use: search Google, visit a news site, check Amazon prices,
look up a Wikipedia article, navigate a website not in the integration list.
NEVER use browser_use for email, calendar, docs, sheets, drive, or messaging tasks.

## Other Services (browser automation only, no direct integration)
- Google Maps, Calendly, Google Slides, Todoist, Trello, Asana, ClickUp
- GitLab, Vercel, DigitalOcean, SerpApi, Wikipedia, Hacker News
- QuickBooks, Splitwise, Twitter/X, LinkedIn, Instagram, Reddit, YouTube
- Yelp, Instacart, TripAdvisor, Eventbrite, OpenWeatherMap, Spotify, Ticketmaster
`;

const toolPlanSchema = z.object({
  strategy: z.enum(["browser_only", "integration_assisted", "integration_direct"]),
  integrations: z.array(z.string()).describe("List of integration names to use"),
  enhanced_prompt: z.string().describe("Optimized task prompt for the browser agent"),
  reasoning: z.string().describe("Brief explanation of why this strategy was chosen"),
});

export type ToolPlan = z.infer<typeof toolPlanSchema>;

const TOOL_GUIDE_SYSTEM_PROMPT = `You are a tool routing expert for a voice-controlled AI assistant.

Given a user's request, determine the BEST execution strategy using the available integrations and browser automation.

${INTEGRATION_CATALOG}

## Strategy Types

1. **browser_only**: Use browser automation to navigate websites directly. Best for:
   - General web searches
   - Visiting specific websites
   - Tasks where no direct API integration exists
   - Reading/extracting content from web pages

2. **integration_assisted**: Use API integrations to ENHANCE browser automation. Best for:
   - Tasks that benefit from structured data (e.g., use Google Maps API for location data, then browser for details)
   - Multi-step workflows where some steps are better done via API
   - Tasks where API provides faster/more reliable data than scraping

3. **integration_direct**: Use API integrations directly WITHOUT browser automation. Best for:
   - Sending emails/messages (Gmail, Slack, etc.)
   - Calendar operations (create events, check availability)
   - CRUD operations on structured data (sheets, databases, CRM)
   - Tasks where the API provides everything needed

## Rules
- ALWAYS prefer BrowserUse Connected Integrations over browser scraping — even when the user does NOT name the brand.
- Match by topic, not just brand name. Examples:
  - "check my email" / "unread emails" / "recent emails" → gmail (integration_direct)
  - "what's on my calendar" / "my schedule" / "upcoming events" → google_calendar (integration_direct)
  - "my spreadsheet" / "update the sheet" → google_sheets (integration_direct)
  - "open a doc" / "create a document" → google_docs (integration_direct)
  - "my files" → google_drive (integration_direct)
  - "my repos" / "open PRs" → github (integration_direct)
  - "my slack messages" / "message the team" → slack (integration_direct)
- For email tasks: ALWAYS integration_direct with gmail (or outlook if explicitly named). NEVER navigate gmail.com.
- For calendar tasks: ALWAYS integration_direct with google_calendar. NEVER navigate calendar.google.com.
- For messaging (Slack, Discord): ALWAYS integration_direct.
- For files/docs (Google Drive, Docs, Sheets, Notion, Dropbox): ALWAYS integration_direct.
- For code/dev (GitHub, Jira, Linear): ALWAYS integration_direct.
- For CRM (HubSpot, Salesforce): ALWAYS integration_direct.
- For payments (Stripe): ALWAYS integration_direct.
- Use browser_only ONLY when the task is truly general web browsing with no matching integration.
- Use the exact tool name from the catalog in the "integrations" array (e.g. "Gmail", "Google Drive", "Slack").
- The enhanced_prompt must be fully self-contained and specific.
  - Resolve pronouns and vague references using conversation history.
  - Never leave "it", "that", "those", "the same" in enhanced_prompt — replace with the actual subject.
- Keep reasoning to 1-2 sentences.

Respond with JSON only:
{
  "strategy": "browser_only" | "integration_assisted" | "integration_direct",
  "integrations": ["integration_name", ...],
  "enhanced_prompt": "detailed task prompt",
  "reasoning": "why this strategy"
}`;

const FALLBACK_PLAN: ToolPlan = {
  strategy: "browser_only",
  integrations: [],
  enhanced_prompt: "",
  reasoning: "Fallback — using browser automation.",
};

export async function generateToolPlan(
  ai: AiClient,
  userRequest: string,
  intent: string,
  historyContext?: string
): Promise<ToolPlan> {
  try {
    const contextSection = historyContext
      ? `[Conversation history]\n${historyContext}\n\n`
      : "";
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents:
        `${TOOL_GUIDE_SYSTEM_PROMPT}\n\n` +
        `${contextSection}` +
        `User request: "${userRequest}"\n` +
        `Classified intent: ${intent}`,
      config: { responseMimeType: "application/json" },
    });

    const text = response.text;
    if (!text) return { ...FALLBACK_PLAN, enhanced_prompt: userRequest };

    const parsed = toolPlanSchema.parse(JSON.parse(text));
    return parsed;
  } catch (err) {
    console.error("[ToolGuide] Planning failed:", err);
    return { ...FALLBACK_PLAN, enhanced_prompt: userRequest };
  }
}
