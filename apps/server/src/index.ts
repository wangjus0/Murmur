import { env } from "./config/env.js";
import { GoogleGenAI } from "@google/genai";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { Session } from "./ws/session.js";

// ── Google GenAI client ────────────────────────────────────
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// ── Express ────────────────────────────────────────────────
const app = express();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

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
  const session = new Session(ws, ai);
  console.log(`[ws] New connection → session ${session.id}`);
});

// ── Start ──────────────────────────────────────────────────
server.listen(env.PORT, () => {
  console.log(`Server listening on port ${env.PORT}`);
});
