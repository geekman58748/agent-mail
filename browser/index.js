/**
 * agent-mail-browser
 * Headless Playwright task service for agent-mail.
 * Own Render service (same repo, separate deploy).
 * Eyes + hands on the page. Agent-mail is the email leg.
 *
 * This is a separate service from agent-mail/server.js.
 * It calls agent-mail's /wait/:address and /code/:address endpoints when an OTP is needed.
 */

const express = require("express");
const { chromium } = require("playwright");
const Tesseract = require("tesseract.js");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const runPitchSignup = require("./runPitchSignup");

const app = express();
app.use(express.json());

const AGENT_MAIL_URL = process.env.AGENT_MAIL_URL || "https://agent-mail-8n7r.onrender.com";
const EMAIL = process.env.EMAIL || "himoonboys@gmail.com";
const RUNS_DIR = path.join(__dirname, "runs");
fs.mkdirSync(RUNS_DIR, { recursive: true });

// In-memory run store. A real deploy would back this with Redis/DB.
const runs = new Map();

// ── OCR fallback ──────────────────────────────────────────────────────────────

async function ocrScreenshot(page, label = "page") {
  const pngPath = path.join(RUNS_DIR, `${label}.png`);
  await page.screenshot({ path: pngPath, fullPage: true });
  const result = await Tesseract.recognize(pngPath, "eng", { logger: () => {} });
  return { text: result.data.text.trim(), pngPath };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function fetchAgentMail(endpoint, query = "") {
  const url = `${AGENT_MAIL_URL}${endpoint}${query ? "?" + query : ""}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`agent-mail ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// ── Browser session ────────────────────────────────────────────────────────────

async function withBrowser(handler) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--no-first-run"
    ]
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York"
  });
  try {
    return await handler(ctx);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({
    service: "agent-mail-browser",
    mode: "headless",
    email: EMAIL,
    agentMail: AGENT_MAIL_URL
  });
});

app.post("/task", async (req, res) => {
  const runId = uuidv4();
  const body = req.body || {};
  const targetUrl = body.url || "https://app.pitch.com/?signup";
  const goal = body.goal || "create-account";

  runs.set(runId, { id: runId, status: "accepted", startedAt: new Date().toISOString() });
  res.json({ id: runId, status: "accepted" });

  (async () => {
    let page;
    try {
      // Launch a fresh headless browser for this run.
      const browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-default-apps",
          "--disable-sync",
          "--no-first-run"
        ]
      });
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        locale: "en-US",
        timezoneId: "America/New_York"
      });
      page = await ctx.newPage();

      runs.set(runId, { id: runId, status: "running", startedAt: new Date().toISOString() });

      let result;
      if (targetUrl.includes("pitch.com") || goal.includes("pitch") || goal === "create-account") {
        result = await runPitchSignup({
          runId,
          page,
          EMAIL,
          AGENT_MAIL_URL,
          RUNS_DIR,
          fetchAgentMail
        });
      } else {
        // Generic single-url open for future use.
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        await new Promise(r => setTimeout(r, 3000));
        const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 1000) || "");
        const scr = path.join(RUNS_DIR, `${runId}-generic.png`);
        await page.screenshot({ path: scr, fullPage: true });
        result = { bodyText: txt, screenshot: scr };
      }

      runs.set(runId, {
        id: runId,
        status: "completed",
        result,
        finishedAt: new Date().toISOString()
      });
    } catch (err) {
      runs.set(runId, {
        id: runId,
        status: "failed",
        error: err.message?.slice(0, 1000),
        finishedAt: new Date().toISOString()
      });
    }
  })();
});

app.get("/task/:id", (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: "run not found" });
  res.json(run);
});

app.get("/status", (req, res) => {
  res.json({ runs: runs.size, agentMail: AGENT_MAIL_URL, email: EMAIL });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`agent-mail-browser on :${PORT} (email=${EMAIL}, agentMail=${AGENT_MAIL_URL})`)
);
