import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { WebSocketServer } from "ws";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "qa-screenshots");
const APP_URL = "http://127.0.0.1:8000/#/voice-popover";

const clients = new Set();

function sendEvent(event) {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // keep waiting
    }
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForWsClient(timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (clients.size > 0) return;
    await delay(100);
  }
  throw new Error("Timed out waiting for WebSocket client connection");
}

function parseDuration(durationString) {
  if (!durationString) return 0;
  const first = durationString.split(",")[0].trim();
  if (first.endsWith("ms")) return Number.parseFloat(first);
  if (first.endsWith("s")) return Number.parseFloat(first) * 1000;
  return Number.parseFloat(first) || 0;
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, name), fullPage: true });
}

async function runScenario(page, prefix) {
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await waitForWsClient();
  sendEvent({ type: "session_started", sessionId: `${prefix}-session` });
  sendEvent({ type: "state", state: "idle" });

  await page.waitForSelector(".voice-meter-pill", { timeout: 20_000 });
  await screenshot(page, `${prefix}-idle.png`);

  const toggleButton = page.locator(".voice-text-toggle-btn");
  await toggleButton.click();
  await page.waitForTimeout(180);
  await screenshot(page, `${prefix}-text-panel-open.png`);

  await toggleButton.click();
  await page.waitForTimeout(280);
  await screenshot(page, `${prefix}-text-panel-closed.png`);

  sendEvent({ type: "state", state: "idle" });
  sendEvent({ type: "clarification_request", question: "Can you clarify which calendar to update?" });
  await page.waitForTimeout(20);
  await screenshot(page, `${prefix}-clarification-early.png`);
  await page.waitForTimeout(220);
  await screenshot(page, `${prefix}-clarification-settled.png`);

  sendEvent({ type: "state", state: "speaking" });
  sendEvent({
    type: "narration_text",
    text: "I can update your calendar. I just need your preferred time window and attendees to finalize the event.",
  });
  sendEvent({ type: "state", state: "idle" });
  sendEvent({ type: "done" });
  await page.waitForTimeout(20);
  await screenshot(page, `${prefix}-response-early.png`);
  await page.waitForTimeout(220);
  await screenshot(page, `${prefix}-response-settled.png`);

  const metrics = await page.evaluate(() => {
    const response = document.querySelector(".voice-response-card");
    const clarification = document.querySelector(".voice-clarification-card");
    const reducedClass = document
      .querySelector(".voice-popover-screen")
      ?.classList.contains("voice-popover-screen--reduced-motion");
    const responseStyle = response ? window.getComputedStyle(response) : null;
    const clarificationStyle = clarification ? window.getComputedStyle(clarification) : null;

    return {
      reducedClass: Boolean(reducedClass),
      responseTransitionDuration: responseStyle?.transitionDuration ?? null,
      clarificationTransitionDuration: clarificationStyle?.transitionDuration ?? null,
      responseTransform: responseStyle?.transform ?? null,
      clarificationTransform: clarificationStyle?.transform ?? null,
    };
  });

  return metrics;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const wss = new WebSocketServer({ port: 3000, path: "/ws" });
  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });

  const clientDev = spawn(
    "npm",
    ["run", "dev", "-w", "apps/client", "--", "--host", "127.0.0.1", "--port", "8000", "--strictPort"],
    { cwd: ROOT, stdio: "pipe" }
  );

  const logs = [];
  clientDev.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  clientDev.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  let browser;
  try {
    await waitForHttp("http://127.0.0.1:8000", 90_000);
    browser = await chromium.launch({ headless: true });

    const normalContext = await browser.newContext({ viewport: { width: 430, height: 620 }, reducedMotion: "no-preference" });
    const normalPage = await normalContext.newPage();
    const normal = await runScenario(normalPage, "normal");
    await normalContext.close();

    const reducedContext = await browser.newContext({ viewport: { width: 430, height: 620 }, reducedMotion: "reduce" });
    const reducedPage = await reducedContext.newPage();
    const reduced = await runScenario(reducedPage, "reduced");
    await reducedContext.close();

    const result = {
      generatedAt: new Date().toISOString(),
      appUrl: APP_URL,
      screenshots: [
        "normal-idle.png",
        "normal-text-panel-open.png",
        "normal-text-panel-closed.png",
        "normal-clarification-early.png",
        "normal-clarification-settled.png",
        "normal-response-early.png",
        "normal-response-settled.png",
        "reduced-idle.png",
        "reduced-text-panel-open.png",
        "reduced-text-panel-closed.png",
        "reduced-clarification-early.png",
        "reduced-clarification-settled.png",
        "reduced-response-early.png",
        "reduced-response-settled.png"
      ],
      metrics: {
        normal: {
          ...normal,
          responseTransitionMs: parseDuration(normal.responseTransitionDuration),
          clarificationTransitionMs: parseDuration(normal.clarificationTransitionDuration),
        },
        reduced: {
          ...reduced,
          responseTransitionMs: parseDuration(reduced.responseTransitionDuration),
          clarificationTransitionMs: parseDuration(reduced.clarificationTransitionDuration),
        },
      },
      devServerLogsTail: logs.slice(-25),
    };

    await fs.writeFile(path.join(OUT_DIR, "test-results.json"), JSON.stringify(result, null, 2), "utf8");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => {
      clientDev.once("exit", () => resolve(undefined));
      clientDev.kill("SIGTERM");
      setTimeout(() => {
        if (!clientDev.killed) clientDev.kill("SIGKILL");
      }, 5_000);
    });
    wss.close();
  }
}

main().catch(async (error) => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
  await fs.writeFile(path.join(OUT_DIR, "test-results.json"), JSON.stringify(payload, null, 2), "utf8");
  throw error;
});
