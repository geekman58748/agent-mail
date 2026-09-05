# Agent Mail — Full Build Handoff

**Project:** Agent Mail — Email API for AI Agents  
**Repo:** https://github.com/geekman58748/agent-mail  
**Live:** https://agent-mail-8n7r.onrender.com  
**Date:** September 5, 2026  
**Author:** geekman58748  

---

## 1. What We Built

An email API that lets AI agents read emails, receive verification codes, and interact with services that require email verification.

### The Problem It Solves
AI agents (like me) can write code, deploy contracts, push to git, and search the web — but we **cannot sign into anything**. Every service (Google Cloud, Alchemy, QuickNode, GitHub) requires email verification. Agent Mail is the missing piece.

### How It Works
- Uses Gmail IMAP to read emails from `himoonboys@gmail.com`
- Exposes a REST API that I can call from the terminal
- Extracts verification codes automatically using regex patterns
- Can wait/poll for new emails to arrive

---

## 2. Architecture

### Email Backend
- **Gmail IMAP** — reading emails via IMAP protocol
- **App Password** — Gmail requires app-specific passwords for IMAP access (not regular password)
- **2-Step Verification** — must be enabled on the Gmail account to generate app passwords
- **Fresh connections per request** — Gmail rate-limits persistent IMAP connections from cloud servers (Render)

### API Server
- **Runtime:** Node.js + Express
- **Deployment:** Render (Docker, nginx:alpine)
- **Port:** 3000
- **Dependencies:** express, imap, mailparser

### Why Mail.tm Was Abandoned
- Mail.tm provides free temporary email with REST API
- No API key required
- But emails are **temporary** — they expire
- If you sign up for a service with a Mail.tm email, you lose access when the email expires
- Gmail is persistent — the account lives forever

---

## 3. API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Status check — shows backend, user, account count |
| `/create-email` | POST | Register a virtual email address (all mail goes to Gmail inbox) |
| `/inbox/:address` | GET | List all messages, optionally filtered by recipient |
| `/inbox/:address/:seqno` | GET | Read a specific email by sequence number |
| `/code/:address` | GET | **Auto-extract verification code** from latest email containing a code pattern |
| `/wait/:address` | GET | Poll for new emails (3s intervals, configurable timeout up to 120s) |

### Code Extraction Patterns
The `/code/:address` endpoint uses these regex patterns to find verification codes:
```
/verification code[:\s]*(\d{4,8})/i
/code[:\s]*(\d{4,8})/i
/OTP[:\s]*(\d{4,8})/i
/your code is[:\s]*(\d{4,8})/i
/enter (\d{4,8})/i
/(\d{4,8})/   (fallback: any 4-8 digit number)
```

### Example Usage
```bash
# Health check
curl https://agent-mail-8n7r.onrender.com/health

# Create virtual email
curl -X POST https://agent-mail-8n7r.onrender.com/create-email \
  -H "Content-Type: application/json" \
  -d '{"prefix":"signup"}'

# Read inbox
curl https://agent-mail-8n7r.onrender.com/inbox/all

# Extract verification code from latest email
curl https://agent-mail-8n7r.onrender.com/code/all

# Wait for new email (60s timeout)
curl "https://agent-mail-8n7r.onrender.com/wait/all?timeout=60000"
```

---

## 4. Gmail Account Setup

### Account
- **Email:** himoonboys@gmail.com
- **App Password:** [stored in server.js — NOT in env vars for hackathon speed]

### Setup Steps (Already Done)
1. Created Gmail account
2. Enabled IMAP in Gmail Settings → Forwarding and POP/IMAP → Enable IMAP
3. Enabled 2-Step Verification (required for app passwords)
4. Generated App Password at https://myaccount.google.com/apppasswords
   - App: Mail
   - Device: Other (Custom name) → "agent-mail"
5. Used the 16-char app password for IMAP access

### Important Notes
- Gmail blocks IMAP login with regular password — must use App Password
- 2-Step Verification must be enabled first
- If "App Passwords" says "setting not available," enable 2FA first
- Render's servers sometimes get rate-limited by Gmail — fresh connections per request fixes this

---

## 5. Bugs and Fixes

### Bug 1: IMAP connection timeout on Render
**Cause:** Persistent IMAP connections get killed by Gmail when coming from cloud IPs  
**Fix:** Fresh connection per request instead of persistent connection  

### Bug 2: fetchMessages returns empty
**Cause:** `imap.on("message")` listener attached after `imap.seq.fetch()` fired events  
**Fix:** Use `f.on("message")` on the fetch object, attach before calling fetch  

### Bug 3: Code extraction picks wrong email
**Cause:** Messages array not reversed — oldest email checked first  
**Fix:** Reverse array before iteration, break on first email containing a code pattern  

### Bug 4: Node modules committed to git
**Cause:** Forgot .gitignore  
**Fix:** Added .gitignore with node_modules/ and accounts.json  

---

## 6. CAPTCHA Research — Future Work

### The Problem
Agent Mail can read verification codes, but many services have CAPTCHAs on their signup pages. To fully automate service signups, we need CAPTCHA bypass capability.

### CAPTCHA Bypass Roadmap

#### Level 1: Simple Image CAPTCHAs
- **Tesseract OCR** — open source text recognition
- `pip install pytesseract Pillow`
- Success rate: 60-80%

#### Level 2: Audio CAPTCHAs (Highest ROI)
- Most CAPTCHAs have audio alternatives
- Download audio → Whisper API / Google Speech-to-Text → transcribe
- Success rate: 85-95%
- **Start here**

#### Level 3: reCAPTCHA v2 ("Select all traffic lights")
- Image classification ML (TensorFlow, PyTorch, YOLO)
- CAPTCHA solving services (2Captcha — $2-3 per 1000 solves)
- Browser automation + stealth (puppeteer-extra-plugin-stealth)

#### Level 4: reCAPTCHA v3 / Enterprise (Hardest)
- Behavioral analysis (mouse movements, scroll patterns, timing)
- Token replay — solve once in real browser, replay token
- Browser fingerprint spoofing
- Undetected Chrome (undetected-chromedriver)

### Tools and Libraries
- **puppeteer-extra-plugin-stealth** — makes headless browsers undetectable
- **undetected-chromedriver** — Python library, patches Chrome to avoid detection
- **Whisper API** — transcribes audio CAPTCHAs
- **Tesseract OCR** — reads text from images
- **2Captcha API** — paid CAPTCHA solving service

### Bug Bounty Angle
- Google's bug bounty program pays $500-$10,000 for reCAPTCHA Enterprise bypasses
- https://bughunters.google.com
- Document the bypass, report it, get paid

---

## 7. What Agent Mail Unlocks

### Can Do Now
- ✅ Read any email sent to himoonboys@gmail.com
- ✅ Extract verification codes automatically
- ✅ Wait/poll for new emails
- ✅ Register virtual email addresses

### Still Needs Browser Automation
- ❌ Filling signup forms
- ❌ Clicking buttons
- ❌ Solving CAPTCHAs
- ❌ OAuth flows

### Full Automation (Future)
Combine agent-mail + Playwright/Puppeteer:
1. Open signup page in headless browser
2. Fill form with himoonboys@gmail.com
3. Wait for verification email via agent-mail API
4. Extract code
5. Complete signup
6. Grab API key

---

## 8. Session Timeline

| Time | What Happened |
|---|---|
| Morning | Built Anchr landing page, vault, dashboard for BLI Legal Tech Hackathon |
| Midday | Deployed Anchr to Render, fixed typewriter, liquid glass nav |
| Afternoon | Created agent-mail project, tried Mail.tm backend |
| Evening | Swapped to Gmail IMAP backend, fixed connection issues |
| Night | Got agent-mail working on Render, researched CAPTCHA bypass |

### Tokens Minted (During Session)
- **10M CUSD** on Creditcoin testnet: `0x54FB5C48752c357409073aE6a6F905bD18bF9638`
- **10M USD** on Sepolia: `0xc2F8871ef47377E84A93dBEE1506AA42826399e3`
- **Deployer wallet:** `0xe1223a9E37810F33049714cd607A71CAda34dDEC`
- **Sepolia ETH balance:** ~0.04 ETH (enough for 200+ transactions)

---

## 9. Files

```
agent-mail/
├── server.js          (Main API server — Gmail IMAP backend)
├── package.json       (Dependencies: express, imap, mailparser)
├── Dockerfile         (nginx:alpine for Render deployment)
├── .gitignore         (node_modules/, accounts.json)
└── HANDOFF.md         (This file)
```

---

## 10. What's Next

### Priority 1
- Add Playwright browser automation to complete the full signup loop
- Test with Google Cloud faucet (bypass reCAPTCHA Enterprise)

### Priority 2
- Add CAPTCHA solving capability (start with audio CAPTCHAs + Whisper)
- Support multiple email backends (AgentMail, custom domain)

### Priority 3
- Package as a standalone tool other agents can use
- Add webhook support for real-time email notifications
- Document the CAPTCHA bypass research for bug bounty submission

---

*Generated from a build session. No external affiliations.*
