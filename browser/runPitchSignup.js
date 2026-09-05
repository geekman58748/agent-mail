/**
 * runPitchSignup.js
 * Cleaned-up Pitch signup flow for agent-mail-browser.
 * Imported by index.js; replaces the garbled inline version.
 */

const path = require("path");

module.exports = async function runPitchSignup({
  runId,
  page,
  EMAIL,
  AGENT_MAIL_URL,
  RUNS_DIR,
  fetchAgentMail
}) {
  const steps = [];
  const addStep = async (name, fn) => {
    const start = Date.now();
    const entry = { name, start, end: null, ok: false, detail: "" };
    steps.push(entry);
    try {
      const result = await fn();
      entry.ok = true;
      entry.detail = result?.detail || "";
      entry.data = result?.data || null;
      if (result?.screenshot) entry.screenshot = result.screenshot;
      if (result?.ocr) entry.ocr = result.ocr;
    } catch (err) {
      entry.ok = false;
      entry.detail = err.message?.slice(0, 500) || String(err);
      try {
        const png = path.join(RUNS_DIR, `${runId}-fail-${steps.length}.png`);
        await page.screenshot({ path: png, fullPage: true });
        entry.screenshot = png;
      } catch {}
      throw err;
    } finally {
      entry.end = Date.now();
    }
  };

  let displayName, password;

  await addStep("launch-browser", async () => {
    return { detail: "headless chromium + fresh context ready" };
  });

  await addStep("goto-signup", async () => {
    await page.goto("https://app.pitch.com/?signup", { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));
    const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 800) || "");
    const scr = path.join(RUNS_DIR, `${runId}-step-goto.png`);
    await page.screenshot({ path: scr, fullPage: true });
    return {
      detail: `title=${(await page.title())||""}`,
      data: { bodyText: txt, screenshot: scr }
    };
  });

  await addStep("choose-path", async () => {
    const labelLower = (await page.evaluate(() => document.body?.innerText?.toLowerCase() || "")).slice(0, 1500);
    const opts = [
      { label: /sign up with email/i, kind: "email" },
      { label: /create account/i, kind: "email" },
      { label: /sign up/i, kind: "email" },
      { label: /get started/i, kind: "email" }
    ];
    const best = opts.find(o => o.label.test(labelLower));
    return {
      detail: best ? `path=${best.kind}` : "no-email-cta-found",
      data: { labelLower, chosen: best?.kind || "unknown" }
    };
  });

  await addStep("click-email-cta", async () => {
    const candidates = [
      'text=Sign up with email',
      'text=Create account',
      'text=Sign up',
      'text=Get started',
      'text=Continue with email'
    ];
    let clicked = false;
    for (const sel of candidates) {
      try {
        const els = await page.locator(sel).all();
        for (const el of els) {
          if (await el.isVisible()) {
            await el.click();
            clicked = true;
            break;
          }
        }
        if (clicked) break;
      } catch {}
    }
    await new Promise(r => setTimeout(r, 2500));
    const scr = path.join(RUNS_DIR, `${runId}-step-cta.png`);
    await page.screenshot({ path: scr, fullPage: true });
    return { detail: `clicked=${clicked}`, data: { clicked, screenshot: scr } };
  });

  await addStep("fill-form", async () => {
    displayName = "Moonboys Vault";
    password = "Moonboys44!" + Date.now().toString(36).slice(-4);

    await new Promise(r => setTimeout(r, 3000));

    const formSnapshot = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
      return inputs.map(i => ({
        tag: i.tagName,
        type: i.type,
        name: i.name,
        id: i.id,
        placeholder: i.placeholder,
        value: i.value,
        visible: i.offsetParent !== null || i.getClientRects().length > 0
      })).slice(0, 40);
    });

    const fill = async (selector, value) => {
      try {
        const el = page.locator(selector);
        if (await el.count() && await el.first().isVisible()) {
          await el.first().click();
          await el.first().fill(value);
          return true;
        }
      } catch {}
      return false;
    };

    const emailOk = await fill('input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="Email" i]');
    const passOk = await fill('input[type="password"], input[name="password"]');
    let nameOk = false;
    const nameCandidates = [
      'input[name="name"]',
      'input[placeholder*="name" i]',
      'input[placeholder*="full" i]',
      'input[placeholder*="display" i]',
      'input[autocomplete="name"]',
      'input[placeholder*="user" i]'
    ];
    for (const nc of nameCandidates) {
      if (await page.locator(nc).count()) { nameOk = await fill(nc, displayName); if (nameOk) break; }
    }

    await new Promise(r => setTimeout(r, 1500));
    const scr = path.join(RUNS_DIR, `${runId}-step-filled.png`);
    await page.screenshot({ path: scr, fullPage: true });

    return {
      detail: `email=${emailOk} password=${passOk} name=${nameOk}`,
      data: {
        displayName,
        password,
        email: EMAIL,
        formSnapshot,
        screenshot: scr
      }
    };
  });

  await addStep("submit", async () => {
    const candBtns = [
      'button[type="submit"]',
      'button:has-text("Create account")',
      'button:has-text("Sign up")',
      'button:has-text("Continue")',
      'button:has-text("Get started")',
      'button:has-text("Join")',
      'input[type="submit"]'
    ];
    let hit = false;
    for (const sel of candBtns) {
      try {
        const els = await page.locator(sel).all();
        for (const el of els) {
          if (await el.isVisible()) {
            await el.click();
            hit = true;
            break;
          }
        }
        if (hit) break;
      } catch {}
    }
    await new Promise(r => setTimeout(r, 4000));
    const scr = path.join(RUNS_DIR, `${runId}-step-submit.png`);
    await page.screenshot({ path: scr, fullPage: true });
    const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 800) || "");
    return {
      detail: `submitted=${hit}`,
      data: { submitted: hit, screenshot: scr, bodyText: txt }
    };
  });

  const checkResult = await addStep("check-result", async () => {
    const txt = await page.evaluate(() => document.body?.innerText?.toLowerCase() || "");
    const inputProbe = await page.evaluate(() =>
      Array.from(document.querySelectorAll("input")).map(i => (i.name || "") + (i.placeholder || "") + (i.id || "")).join(" ")
    );
    const needsOtp =
      /verify|verification|confirmation|code|otp|enter code|check your email|we've sent|email us|check your inbox/i.test(txt) ||
      /code|otp|one-time/i.test(inputProbe);
    return {
      detail: `needsOtp=${needsOtp}`,
      data: { needsOtp, bodyText: txt.slice(0, 1000) }
    };
  });
  const needsOtp = checkResult?.data?.needsOtp;

  let otpCode = null;
  if (needsOtp) {
    otpCode = await addStep("wait-for-code", async () => {
      const poll = async () => {
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 5000));
          try {
            const resp = await fetchAgentMail(`/wait/${encodeURIComponent(EMAIL)}`, "timeout=5000");
            if (resp.found && resp.code) return resp.code;
            if (resp.found) {
              try {
                const full = await fetchAgentMail(`/inbox/${encodeURIComponent(EMAIL)}/1`);
                const codePat = (full.text || "").match(/(?:verification code|code|otp|your code is|enter\s+)\s*:?\s*(\d{4,8})/i);
                if (codePat) return codePat[1];
              } catch {}
            }
          } catch {}
        }
        return null;
      };
      const code = await poll();
      return { detail: `code=${code || "none"}`, data: { code } };
    }).data?.code || null;
  }

  if (needsOtp && otpCode) {
    await addStep("enter-code", async () => {
      const code = otpCode;
      const codeField = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        return inputs.find(i => /code|otp|verify|one-time/i.test((i.name || "") + (i.placeholder || "") + (i.id || "")))?.name || "";
      });
      const loc = page.locator(
        `input[name="${codeField}"], input[placeholder*="code" i], input[placeholder*="otp" i], input[autocomplete="one-time-code"]`
      );
      if (await loc.count()) await loc.first().fill(code);
      await new Promise(r => setTimeout(r, 1000));
      const scr = path.join(RUNS_DIR, `${runId}-step-code.png`);
      await page.screenshot({ path: scr, fullPage: true });
      return {
        detail: `typed=${!!code} code=${code}`,
        data: { code, screenshot: scr }
      };
    });
  }

  if (needsOtp) {
    await addStep("final-submit", async () => {
      const candBtns = [
        'button[type="submit"]',
        'button:has-text("Verify")',
        'button:has-text("Continue")',
        'button:has-text("Submit")',
        'button:has-text("Finish")',
        'button:has-text("Complete")',
        'button:has-text("Next")'
      ];
      let hit = false;
      for (const sel of candBtns) {
        try {
          const els = await page.locator(sel).all();
          for (const el of els) {
            if (await el.isVisible()) { await el.click(); hit = true; break; }
          }
          if (hit) break;
        } catch {}
      }
      await new Promise(r => setTimeout(r, 4000));
      const scr = path.join(RUNS_DIR, `${runId}-step-final.png`);
      await page.screenshot({ path: scr, fullPage: true });
      const title = await page.title();
      const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 1000) || "");
      return {
        detail: `finalSubmitted=${hit} title=${title}`,
        data: { submitted: hit, title, screenshot: scr, bodyText: txt }
      };
    });
  }

  await addStep("final-state", async () => {
    const title = await page.title();
    const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 1500) || "");
    const url = page.url();
    const loggedIn = /dashboard|home|feed|pitches/i.test(txt) && /sign out|log out/i.test(txt);
    return {
      detail: `final title=${title} url=${url} loggedIn=${loggedIn}`,
      data: { title, url, loggedIn, bodyText: txt }
    };
  });

  return {
    steps,
    account: {
      email: EMAIL,
      displayName,
      password
    }
  };
};
