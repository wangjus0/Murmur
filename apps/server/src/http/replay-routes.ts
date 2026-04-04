import type { Express, Request, Response } from "express";
import type { SessionPersistence } from "../persistence/session-persistence.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function registerReplayRoutes(
  app: Express,
  persistence: Pick<SessionPersistence, "listSessions" | "getSessionReplay">
): void {
  app.get("/api/sessions", async (req: Request, res: Response) => {
    try {
      const rawLimit = req.query.limit;
      const limit = parseLimit(rawLimit);
      if (limit === null) {
        res.status(400).json({ error: "Query param 'limit' must be a positive integer." });
        return;
      }

      const sessions = await persistence.listSessions(limit);
      res.json({ sessions });
    } catch (error) {
      console.error("Failed to list sessions:", error);
      res.status(500).json({ error: "Failed to list sessions." });
    }
  });

  app.get("/api/sessions/:sessionId", async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.sessionId;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        res.status(400).json({ error: "sessionId is required." });
        return;
      }

      const replay = await persistence.getSessionReplay(sessionId);
      if (!replay) {
        res.status(404).json({ error: "Session not found." });
        return;
      }

      res.json(replay);
    } catch (error) {
      console.error("Failed to fetch session replay:", error);
      res.status(500).json({ error: "Failed to fetch session replay." });
    }
  });
}

function parseLimit(rawLimit: unknown): number | null {
  if (rawLimit === undefined) {
    return DEFAULT_LIMIT;
  }

  if (Array.isArray(rawLimit) || typeof rawLimit !== "string") {
    return null;
  }

  const parsed = Number(rawLimit);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(parsed, MAX_LIMIT);
}
