import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPortFromServerDotenv(): string | undefined {
  try {
    const envPath = path.resolve(__dirname, "../server/.env");
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const eq = trimmed.indexOf("=");
      if (eq === -1) {
        continue;
      }
      if (trimmed.slice(0, eq).trim() === "PORT") {
        return trimmed.slice(eq + 1).trim();
      }
    }
  } catch {
    // Missing or unreadable .env — fall through to defaults
  }
  return undefined;
}

const wsProxyTarget = process.env.MURMUR_WS_PROXY_TARGET?.trim()
  || `ws://127.0.0.1:${readPortFromServerDotenv() || process.env.PORT?.trim() || "3000"}`;

const devUrlFile = path.resolve(__dirname, "..", "..", ".murmur-vite-dev-url");

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "murmur-write-vite-dev-url",
      configResolved() {
        try {
          fs.unlinkSync(devUrlFile);
        } catch {
          // ignore missing / unreadable
        }
      },
      configureServer(server) {
        server.httpServer?.once("listening", () => {
          const addr = server.httpServer?.address();
          if (typeof addr !== "object" || !addr) {
            return;
          }
          const url = `http://localhost:${addr.port}`;
          try {
            fs.writeFileSync(devUrlFile, `${url}\n`, "utf-8");
          } catch {
            // ignore
          }
        });
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/ws": {
        target: wsProxyTarget,
        ws: true,
      },
    },
  },
});
