import { env } from "./config/env.js";
import { GoogleGenAI } from "@google/genai";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { Session } from "./ws/session.js";
import { SupabaseSessionPersistence } from "./persistence/supabase-session-persistence.js";
import { registerReplayRoutes } from "./http/replay-routes.js";

// ── Google GenAI client ────────────────────────────────────
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
const persistence = new SupabaseSessionPersistence(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Express ────────────────────────────────────────────────
const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
registerReplayRoutes(app, persistence);

// ── HTTP + WebSocket server ────────────────────────────────
const server = createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  const session = new Session(ws, ai, persistence);
  console.log(`[ws] New connection → session ${session.id}`);
});

// ── Start ──────────────────────────────────────────────────
server.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
});
