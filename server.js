/**
 * agent-mail — Email API for AI agents
 *
 * Wraps Mail.tm to give AI agents email capabilities:
 * - Create disposable email addresses
 * - Read inbox / specific messages
 * - Extract verification codes automatically
 *
 * Endpoints:
 *   GET  /health                   → status
 *   POST /create-email             → create a new email address
 *   GET  /inbox/:address           → list messages for an address
 *   GET  /inbox/:address/:msgId    → read a specific message
 *   GET  /code/:address            → extract verification code from latest email
 *   GET  /domains                  → list available domains
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();
app.use(express.json());

const MAIL_TM = "https://api.mail.tm";
const DATA_FILE = path.join(__dirname, "accounts.json");

// ── Helpers ──

async function tmFetch(path, opts = {}) {
  const res = await fetch(`${MAIL_TM}${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mail.tm ${res.status}: ${body}`);
  }
  return res.json();
}

// Persist accounts to disk
function loadAccounts() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      return new Map(Object.entries(data));
    }
  } catch (e) { /* ignore */ }
  return new Map();
}
function saveAccounts() {
  const obj = Object.fromEntries(accounts);
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2));
}

// Store accounts: address → { password, token }
const accounts = loadAccounts();

// ── Routes ──

app.get("/health", (req, res) => {
  res.json({ status: "ok", accounts: accounts.size, service: "agent-mail" });
});

// List available domains
app.get("/domains", async (req, res) => {
  try {
    const data = await tmFetch("/domains");
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new email address
app.post("/create-email", async (req, res) => {
  try {
    // Get available domains
    const domains = await tmFetch("/domains");
    const domain = domains["hydra:member"]?.[0]?.domain;
    if (!domain) throw new Error("No domains available");

    // Generate address
    const prefix = req.body.prefix || `agent-${Date.now().toString(36)}`;
    const address = `${prefix}@${domain}`;
    const password = `Pass_${Date.now()}_!`;

    // Create account
    const account = await tmFetch("/accounts", {
      method: "POST",
      body: JSON.stringify({ address, password }),
    });

    // Get auth token
    const tokenData = await tmFetch("/token", {
      method: "POST",
      body: JSON.stringify({ address, password }),
    });

    accounts.set(address, { password, token: tokenData.token });
    saveAccounts();

    res.json({
      address,
      id: account.id,
      createdAt: account.createdAt,
      token: tokenData.token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List messages for an address
app.get("/inbox/:address", async (req, res) => {
  try {
    const acct = accounts.get(req.params.address);
    if (!acct) return res.status(404).json({ error: "Address not found. Create it first with POST /create-email" });

    const data = await tmFetch("/messages", {
      headers: { Authorization: `Bearer ${acct.token}` },
    });

    const messages = (data["hydra:member"] || []).map((m) => ({
      id: m.id,
      from: m.from?.address,
      subject: m.subject,
      intro: m.intro,
      createdAt: m.createdAt,
    }));

    res.json({ address: req.params.address, count: messages.length, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read a specific message
app.get("/inbox/:address/:msgId", async (req, res) => {
  try {
    const acct = accounts.get(req.params.address);
    if (!acct) return res.status(404).json({ error: "Address not found" });

    const msg = await tmFetch(`/messages/${req.params.msgId}`, {
      headers: { Authorization: `Bearer ${acct.token}` },
    });

    res.json({
      id: msg.id,
      from: msg.from?.address,
      to: msg.to?.map((t) => t.address),
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      intro: msg.intro,
      createdAt: msg.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Extract verification code from latest email
app.get("/code/:address", async (req, res) => {
  try {
    const acct = accounts.get(req.params.address);
    if (!acct) return res.status(404).json({ error: "Address not found" });

    const data = await tmFetch("/messages", {
      headers: { Authorization: `Bearer ${acct.token}` },
    });

    const messages = data["hydra:member"] || [];
    if (messages.length === 0) {
      return res.json({ address: req.params.address, code: null, message: "No emails yet" });
    }

    // Get the latest message
    const latest = messages[0];
    const msg = await tmFetch(`/messages/${latest.id}`, {
      headers: { Authorization: `Bearer ${acct.token}` },
    });

    const text = msg.text || "";

    // Try to extract verification code (common patterns)
    const patterns = [
      /verification code[:\s]*(\d{4,8})/i,
      /code[:\s]*(\d{4,8})/i,
      /OTP[:\s]*(\d{4,8})/i,
      /your code is[:\s]*(\d{4,8})/i,
      /enter (\d{4,8})/i,
      /(\d{6})/, // fallback: any 6-digit number
    ];

    let code = null;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        code = match[1];
        break;
      }
    }

    res.json({
      address: req.params.address,
      code,
      from: msg.from?.address,
      subject: msg.subject,
      snippet: text.slice(0, 500),
      createdAt: msg.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`agent-mail running on :${PORT}`);
});
