/**
 * agent-mail — Gmail IMAP Email API for AI agents
 */

const express = require("express");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const IMAP_CONFIG = {
  user: process.env.GMAIL_USER || "himoonboys@gmail.com",
  password: process.env.GMAIL_APP_PASSWORD || "mfmw fzwz uwei gnoz",
  host: "imap.gmail.com",
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
};

const DATA_FILE = path.join(__dirname, "accounts.json");
function loadAccounts() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch(e){}
  return {};
}
function saveAccounts(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
const accounts = loadAccounts();

function getImap() {
  return new Promise((resolve, reject) => {
    const imap = new Imap(IMAP_CONFIG);
    const t = setTimeout(() => { try{imap.destroy();}catch(e){} reject(new Error("timeout")); }, 15000);
    imap.once("ready", () => { clearTimeout(t); resolve(imap); });
    imap.once("error", (e) => { clearTimeout(t); reject(e); });
    imap.connect();
  });
}

function fetchMessages(limit = 20) {
  return new Promise(async (resolve, reject) => {
    let imap;
    try { imap = await getImap(); } catch(e) { return reject(e); }

    imap.openBox("INBOX", true, (err, box) => {
      if (err) { try{imap.end();}catch(e){} return reject(err); }
      const total = box.messages.total;
      if (total === 0) { imap.end(); return resolve([]); }

      const from = Math.max(1, total - limit + 1);
      const range = `${from}:${total}`;
      const messages = [];

      const f = imap.seq.fetch(range, { bodies: "" });
      f.on("message", (msg, seqno) => {
        let body = "";
        msg.on("body", (stream) => {
          stream.on("data", (chunk) => { body += chunk.toString("utf8"); });
        });
        msg.on("end", () => { messages.push({ seqno, body }); });
      });
      f.once("error", (e) => { try{imap.end();}catch(e){} reject(e); });
      f.once("end", () => {
        setTimeout(() => { try{imap.end();}catch(e){} resolve(messages); }, 500);
      });
    });
  });
}

function waitForNewEmail(address, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = async () => {
      try {
        const msgs = await fetchMessages(5);
        for (const m of msgs) {
          const parsed = await simpleParser(m.body);
          const to = parsed.to?.value?.[0]?.address?.toLowerCase();
          if (to === address.toLowerCase()) {
            const age = Date.now() - (parsed.date?.getTime() || 0);
            if (age < 120000) return resolve(parsed);
          }
        }
      } catch(e) {}
      if (Date.now() - start < timeoutMs) setTimeout(check, 3000);
      else resolve(null);
    };
    check();
  });
}

// ── Routes ──

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "agent-mail", backend: "gmail-imap", user: IMAP_CONFIG.user, accounts: Object.keys(accounts).length });
});

app.post("/create-email", (req, res) => {
  const prefix = req.body.prefix || `agent-${Date.now().toString(36)}`;
  const address = `${prefix}@gmail.com`;
  accounts[address] = { createdAt: new Date().toISOString() };
  saveAccounts(accounts);
  res.json({ address: IMAP_CONFIG.user, virtualAddress: address, note: "All mail goes to one Gmail inbox.", createdAt: accounts[address].createdAt });
});

app.get("/inbox/:address", async (req, res) => {
  try {
    const msgs = await fetchMessages(30);
    const results = [];
    for (const m of msgs) {
      try {
        const parsed = await simpleParser(m.body);
        const to = parsed.to?.value?.map(t => t.address).join(", ") || "";
        const filter = req.params.address.toLowerCase();
        if (filter !== "all" && !to.toLowerCase().includes(filter)) continue;
        results.push({ seqno: m.seqno, from: parsed.from?.text, to, subject: parsed.subject, date: parsed.date?.toISOString(), snippet: (parsed.text || "").slice(0, 300) });
      } catch(e) {}
    }
    res.json({ address: req.params.address, count: results.length, messages: results.reverse() });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get("/inbox/:address/:seqno", async (req, res) => {
  try {
    const imap = await getImap();
    const seqno = parseInt(req.params.seqno);
    const raw = await new Promise((resolve, reject) => {
      imap.openBox("INBOX", true, (err) => {
        if (err) return reject(err);
        let body = "";
        const f = imap.seq.fetch(seqno, { bodies: "" });
        f.on("message", (msg) => {
          msg.on("body", (s) => { s.on("data", (c) => { body += c.toString(); }); });
          msg.once("end", () => resolve(body));
        });
        f.once("error", reject);
        setTimeout(() => resolve(body), 3000);
      });
    });
    imap.end();
    const p = await simpleParser(raw);
    res.json({ seqno, from: p.from?.text, to: p.to?.value?.map(t=>t.address), subject: p.subject, date: p.date?.toISOString(), text: p.text, html: p.html });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get("/code/:address", async (req, res) => {
  try {
    const msgs = await fetchMessages(10);
    let latest = null;
    for (const m of msgs) {
      try {
        const p = await simpleParser(m.body);
        const to = p.to?.value?.map(t => t.address?.toLowerCase()) || [];
        if (to.includes(req.params.address.toLowerCase()) || req.params.address === "all") { latest = p; break; }
      } catch(e) {}
    }
    if (!latest) return res.json({ address: req.params.address, code: null, message: "No emails found" });
    const text = latest.text || "";
    const patterns = [/verification code[:\s]*(\d{4,8})/i, /code[:\s]*(\d{4,8})/i, /OTP[:\s]*(\d{4,8})/i, /your code is[:\s]*(\d{4,8})/i, /enter (\d{4,8})/i, /(\d{6})/];
    let code = null;
    for (const p of patterns) { const m = text.match(p); if (m) { code = m[1]; break; } }
    res.json({ address: req.params.address, code, from: latest.from?.text, subject: latest.subject, snippet: text.slice(0, 500), date: latest.date?.toISOString() });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.get("/wait/:address", async (req, res) => {
  const timeout = Math.min(parseInt(req.query.timeout) || 60000, 120000);
  const email = await waitForNewEmail(req.params.address, timeout);
  if (!email) return res.json({ address: req.params.address, found: false, message: "No new email within timeout" });
  const text = email.text || "";
  const patterns = [/verification code[:\s]*(\d{4,8})/i, /code[:\s]*(\d{4,8})/i, /OTP[:\s]*(\d{4,8})/i, /your code is[:\s]*(\d{4,8})/i, /enter (\d{4,8})/i, /(\d{6})/];
  let code = null;
  for (const p of patterns) { const m = text.match(p); if (m) { code = m[1]; break; } }
  res.json({ address: req.params.address, found: true, code, from: email.from?.text, subject: email.subject, snippet: text.slice(0, 500), date: email.date?.toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`agent-mail on :${PORT} (${IMAP_CONFIG.user})`));
