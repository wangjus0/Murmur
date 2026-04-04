import type { ClientEvent, ServerEvent } from "@diamond/shared";
import { parseServerEvent } from "@diamond/shared";

const MAX_BACKOFF_MS = 10_000;

export interface Socket {
  send(event: ClientEvent): void;
  onEvent(cb: (event: ServerEvent) => void): void;
  close(): void;
}

export function createSocket(url: string): Socket {
  let ws: WebSocket | null = null;
  let backoff = 1000;
  let intentionallyClosed = false;
  const listeners: Array<(event: ServerEvent) => void> = [];
  const pendingMessages: string[] = [];

  function flushPendingMessages(): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    for (const message of pendingMessages.splice(0, pendingMessages.length)) {
      ws.send(message);
    }
  }

  function connect(): void {
    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      backoff = 1000; // reset on successful connect
      flushPendingMessages();
    });

    ws.addEventListener("message", (msg) => {
      try {
        const parsed = parseServerEvent(JSON.parse(msg.data as string));
        for (const cb of listeners) {
          cb(parsed);
        }
      } catch (err) {
        console.error("[ws] Failed to parse server event:", err);
      }
    });

    ws.addEventListener("close", () => {
      if (intentionallyClosed) return;
      console.log(`[ws] Disconnected. Reconnecting in ${backoff}ms…`);
      setTimeout(() => {
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        connect();
      }, backoff);
    });

    ws.addEventListener("error", (err) => {
      console.error("[ws] Error:", err);
    });
  }

  connect();

  return {
    send(event: ClientEvent): void {
      const message = JSON.stringify(event);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        return;
      }

      pendingMessages.push(message);
    },

    onEvent(cb: (event: ServerEvent) => void): void {
      listeners.push(cb);
    },

    close(): void {
      intentionallyClosed = true;
      ws?.close();
    },
  };
}
