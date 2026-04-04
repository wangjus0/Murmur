import { Router } from "express";
import { SessionPersistenceService } from "../modules/session/session-persistence-service.js";

export function createSessionsRouter(
  sessionPersistenceService: SessionPersistenceService,
): Router {
  const router = Router();

  router.get("/:sessionId", (req, res) => {
    const snapshot = sessionPersistenceService.getSessionSnapshot(req.params.sessionId);

    if (!snapshot) {
      res.status(404).json({ message: "Session not found" });
      return;
    }

    res.json(snapshot);
  });

  return router;
}
