/**
 * agent-mail — Gmail IMAP Email API for AI agents
 *
 * Reads emails directly from Gmail via IMAP.
 * Create virtual accounts, read inbox, extract verification codes.
 *
 * Endpoints:
 *   GET  /health                   → status
 *   POST /create-email             → register an email address
 *   GET  /inbox/:address           → list messages
 *   GET  /inbox/:address/:msgId    → read a message
 *   GET  /code/:address            → extract verification code from latest
 *   GET  /wait/:address            → wait for new email (polls every 3s, max 60s)
 */

const express = require("express");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// ── Gmail IMAP Config ──
const IMAP_CONFIG = {
  user: process.env.GMAIL_USER || "himoonboys@gmail.com",
  password: process.env.GMAIL_APP_PASSWORD || "mfmw fzwz uwei gnoz",
  host: "imap.gmail.com",
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
};

const DATA_FILE = path.join(__dirname, "accounts.json");

// ── Persistence ──
function loadAccounts() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {}
  return {};
}
function saveAccounts(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Virtual accounts: address → { createdAt }
const accounts = loadAccounts();

// ── IMAP Connection (fresh per request) ──
function getImap() {
  return new Promise((resolve, reject) => {
    const imap = new Imap(IMAP_CONFIG);
    const timeout = setTimeout(() => {
      try { imap.destroy(); } catch (e) {}
      reject(new Error("IMAP connection timeout"));
    }, 15000);
    imap.once("ready", () => {
      clearTimeout(timeout);
      resolve(imap);
    });
    imap.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    imap.connect();
  });
}

function fetchMessages(imap, mailbox = "INBOX", limit = 20) {
  return new Promise((resolve, reject) => {
    imap.openBox(mailbox, true, (err, box) => {
      if (err) return reject(err);

      const total = box.messages.total;
      if (total === 0) return resolve([]);

      const from = Math.max(1, total - limit + 1);
      const range = `${from}:${total}`;

      const messages = [];
      imap.seq.fetch(range, {
        bodies: "",
        struct: true,
        envelope: true,
      });

      imap.on("message", (msg, seqno) => {
        let body = "";
        msg.on("body", (stream) => {
          stream.on("data", (chunk) => { body += chunk.toString("utf8"); });
        });
        msg.on("end", () => {
          messages.push({ seqno, body });
        });
      });

      imap.once("error", reject);

      // Wait for all messages to be collected
      setTimeout(() => resolve(messages), 1000);
    });
  });
}

function waitForNewEmail(address, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = async () => {
      try {
        const imap = await getImap();
        const msgs = await fetchMessages(imap, "INBOX", 5);

        // Parse and look for new emails
        for (const m of msgs) {
          const parsed = await simpleParser(m.body);
          const to = parsed.to?.value?.[0]?.address?.toLowerCase();
          if (to === address.toLowerCase()) {
            const age = Date.now() - (parsed.date?.getTime() || 0);
            if (age < 120000) { // Less than 2 minutes old
              return resolve(parsed);
            }
          }
        }

        if (Date.now() - start < timeoutMs) {
          setTimeout(check, 3000);
        } else {
          resolve(null);
        }
      } catch (e) {
        if (Date.now() - start < timeoutMs) {
          setTimeout(check, 3000);
        } else {
          resolve(null);
        }
      }
    };
    check();
  });
}

// ── Routes ──

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "agent-mail",
    backend: "gmail-imap",
    user: IMAP_CONFIG.user,
    accounts: Object.keys(accounts).length,
  });
});

// Register a virtual email (just tracks it — all mail goes to the same Gmail inbox)
app.post("/create-email", (req, res) => {
  const prefix = req.body.prefix || `agent-${Date.now().toString(36)}`;
  const address = `${prefix}@${IMAP_CONFIG.user.split("@")[1]}`;

  // For Gmail, all addresses go to the same inbox
  // We use the prefix as a filter
  accounts[address] = { createdAt: new Date().toISOString() };
  saveAccounts(accounts);

  res.json({
    address: IMAP_CONFIG.user,
    virtualAddress: address,
    note: "Gmail routes all mail to one inbox. Use /inbox to read, /wait/:address to wait for a specific email.",
    createdAt: accounts[address].createdAt,
  });
});

// List messages (optionally filtered by 'to' address)
app.get("/inbox/:address", async (req, res) => {
  try {
    const imap = await getImap();
    const msgs = await fetchMessages(imap, "INBOX", 30);

    const results = [];
    for (const m of msgs) {
      try {
        const parsed = await simpleParser(m.body);
        const to = parsed.to?.value?.map((t) => t.address).join(", ") || "";
        const from = parsed.from?.text || "";
        const subject = parsed.subject || "";
        const date = parsed.date?.toISOString() || "";
        const text = parsed.text || "";

        // Filter if specific address requested
        const filter = req.params.address.toLowerCase();
        if (filter !== "all" && !to.toLowerCase().includes(filter)) continue;

        results.push({
          seqno: m.seqno,
          from,
          to,
          subject,
          date,
          snippet: text.slice(0, 300),
        });
      } catch (e) { /* skip unparseable */ }
    }

    res.json({
      address: req.params.address,
      count: results.length,
      messages: results.reverse(), // newest first
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read a specific message by seqno
app.get("/inbox/:address/:seqno", async (req, res) => {
  try {
    const imap = await getImap();
    const seqno = parseInt(req.params.seqno);

    const msg = await new Promise((resolve, reject) => {
      imap.openBox("INBOX", true, (err) => {
        if (err) return reject(err);
        let body = "";
        imap.seq.fetch(seqno, { bodies: "" });
        imap.on("message", (msg) => {
          msg.on("body", (stream) => {
            stream.on("data", (chunk) => { body += chunk.toString("utf8"); });
          });
          msg.on("end", () => resolve(body));
        });
        setTimeout(() => resolve(body), 1000);
      });
    });
    const parsed = await simpleParser(msg);

    res.json({
      seqno,
      from: parsed.from?.text,
      to: parsed.to?.value?.map((t) => t.address),
      subject: parsed.subject,
      date: parsed.date?.toISOString(),
      text: parsed.text,
      html: parsed.html,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Extract verification code from latest email to this address
app.get("/code/:address", async (req, res) => {
  try {
    const imap = await getImap();
    const msgs = await fetchMessages(imap, "INBOX", 10);

    // Find latest email to this address
    let latest = null;
    for (const m of msgs) {
      try {
        const parsed = await simpleParser(m.body);
        const to = parsed.to?.value?.map((t) => t.address?.toLowerCase()) || [];
        const filter = req.params.address.toLowerCase();
        if (to.includes(filter) || filter === "all") {
          latest = parsed;
          break;
        }
      } catch (e) {}
    }

    if (!latest) {
      return res.json({ address: req.params.address, code: null, message: "No emails found" });
    }

    const text = latest.text || "";

    // Extract verification code
    const patterns = [
      /verification code[:\s]*(\d{4,8})/i,
      /verify.*?code[:\s]*(\d{4,8})/i,
      /code[:\s]*(\d{4,8})/i,
      /OTP[:\s]*(\d{4,8})/i,
      /your code is[:\s]*(\d{4,8})/i,
      /enter (\d{4,8})/i,
      /(\d{6})/,
    ];

    let code = null;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) { code = match[1]; break; }
    }

    res.json({
      address: req.params.address,
      code,
      from: latest.from?.text,
      subject: latest.subject,
      snippet: text.slice(0, 500),
      date: latest.date?.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Wait for a new email to arrive (polls every 3s)
app.get("/wait/:address", async (req, res) => {
  const timeout = Math.min(parseInt(req.query.timeout) || 60000, 120000);
  const email = await waitForNewEmail(req.params.address, timeout);

  if (!email) {
    return res.json({ address: req.params.address, found: false, message: "No new email within timeout" });
  }

  const text = email.text || "";
  const patterns = [
    /verification code[:\s]*(\d{4,8})/i,
    /code[:\s]*(\d{4,8})/i,
    /OTP[:\s]*(\d{4,8})/i,
    /your code is[:\s]*(\d{4,8})/i,
    /enter (\d{4,8})/i,
    /(\d{6})/,
  ];

  let code = null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) { code = match[1]; break; }
  }

  res.json({
    address: req.params.address,
    found: true,
    code,
    from: email.from?.text,
    subject: email.subject,
    snippet: text.slice(0, 500),
    date: email.date?.toISOString(),
  });
});

// ── Start ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`agent-mail running on :${PORT} (Gmail IMAP: ${IMAP_CONFIG.user})`);
});
