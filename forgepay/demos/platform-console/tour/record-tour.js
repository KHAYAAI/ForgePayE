/* FORGE console — recorded product tour.
   Drives the real console in Chromium and records the session to WebM.
   Adds a caption strip and a synthetic cursor so the recording reads as a
   guided walkthrough rather than a screen-capture of someone clicking. */
const { chromium } = require('playwright');

const URL = 'file:///home/user/ForgePayE/forgepay/demos/platform-console/index.html';
const OUT = '/tmp/claude-0/-home-user-ForgePayE/5b6ea09d-e9a5-5992-bbf1-eecaf733267b/scratchpad/video';
const W = 1440, H = 900;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── chrome injected into the page (caption strip + cursor + title cards) ── */
const CHROME = () => {
  const s = document.createElement('style');
  s.textContent = `
  /* caption sits at the TOP — the bottom is where video players draw their
     controls, which would cover it during playback */
  #tourCap{position:fixed;left:0;right:0;top:0;z-index:9998;pointer-events:none;
    background:#0A0A0A;color:#F4F2EE;padding:15px 30px;display:flex;align-items:baseline;gap:18px;
    border-bottom:1px solid rgba(244,242,238,.2);transform:translateY(-102%);transition:transform .34s cubic-bezier(.2,.7,.3,1)}
  #tourCap.on{transform:none}
  #tourCap .n{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:1.6px;text-transform:uppercase;
    color:rgba(244,242,238,.5);white-space:nowrap}
  #tourCap .t{font-size:19px;font-weight:500;letter-spacing:-.3px;white-space:nowrap}
  #tourCap .s{font-size:14px;color:rgba(244,242,238,.7);border-left:1px solid rgba(244,242,238,.25);
    padding-left:18px;margin-left:2px}
  #tourCur{position:fixed;z-index:9999;width:16px;height:16px;border:2px solid #0A0A0A;border-radius:50%;
    background:rgba(244,242,238,.55);pointer-events:none;transform:translate(-50%,-50%);
    transition:left .42s cubic-bezier(.3,.8,.3,1),top .42s cubic-bezier(.3,.8,.3,1);left:-60px;top:-60px;
    box-shadow:0 0 0 1px rgba(244,242,238,.8)}
  #tourCur.tap{animation:tourTap .42s ease-out}
  @keyframes tourTap{0%{box-shadow:0 0 0 1px rgba(244,242,238,.8)}
    50%{box-shadow:0 0 0 14px rgba(10,10,10,.18)}100%{box-shadow:0 0 0 1px rgba(244,242,238,.8)}}
  #tourCard{position:fixed;inset:0;z-index:10000;background:#0A0A0A;color:#F4F2EE;display:flex;
    flex-direction:column;justify-content:center;padding:0 clamp(40px,9vw,140px);opacity:0;
    transition:opacity .5s ease;pointer-events:none}
  #tourCard.on{opacity:1}
  #tourCard .k{font-family:ui-monospace,monospace;font-size:12px;letter-spacing:2.4px;text-transform:uppercase;
    color:rgba(244,242,238,.5);margin-bottom:26px}
  #tourCard h1{font-size:clamp(44px,7vw,92px);font-weight:500;line-height:.94;letter-spacing:-.035em;max-width:18ch}
  #tourCard h1 em{font-style:italic;font-weight:300}
  #tourCard p{margin-top:26px;font-size:19px;color:rgba(244,242,238,.72);max-width:56ch;line-height:1.5}
  #tourCard .rule{width:64px;height:2px;background:#F4F2EE;margin-top:34px}`;
  document.head.appendChild(s);
  const cap = document.createElement('div');
  cap.id = 'tourCap';
  cap.innerHTML = '<span class="n"></span><span class="t"></span><span class="s"></span>';
  document.body.appendChild(cap);
  const cur = document.createElement('div'); cur.id = 'tourCur'; document.body.appendChild(cur);
  const card = document.createElement('div'); card.id = 'tourCard';
  card.innerHTML = '<div class="k"></div><h1></h1><div class="rule"></div><p></p>';
  document.body.appendChild(card);
};

async function ensureChrome(page) {
  await page.evaluate(() => { if (!document.getElementById('tourCap')) window.__mk && window.__mk(); });
}

module.exports = {};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(URL);
  await page.waitForTimeout(700);
  await page.evaluate(`window.__mk = ${CHROME.toString()}; window.__mk();`);

  /* helpers ------------------------------------------------------------- */
  const card = async (kicker, title, body, hold) => {
    await page.evaluate(([k, t, b]) => {
      const c = document.getElementById('tourCard');
      c.querySelector('.k').textContent = k;
      c.querySelector('h1').innerHTML = t;
      c.querySelector('p').textContent = b;
      c.classList.add('on');
    }, [kicker, title, body]);
    await sleep(hold);
    await page.evaluate(() => document.getElementById('tourCard').classList.remove('on'));
    await sleep(600);
  };
  const cap = async (n, t, s) => {
    await ensureChrome(page);
    await page.evaluate(([n, t, s]) => {
      const c = document.getElementById('tourCap');
      c.querySelector('.n').textContent = n;
      c.querySelector('.t').textContent = t;
      c.querySelector('.s').textContent = s || '';
      c.classList.add('on');
    }, [n, t, s]);
  };
  const capOff = () => page.evaluate(() => {
    const c = document.getElementById('tourCap'); if (c) c.classList.remove('on');
  });
  const go = async (route) => {
    await page.evaluate(r => { location.hash = '#/' + r; }, route);
    await page.waitForTimeout(520);
    await ensureChrome(page);
  };
  const moveTo = async (sel, nth) => {
    const box = await page.locator(sel).nth(nth || 0).boundingBox().catch(() => null);
    if (!box) return null;
    const x = Math.round(box.x + Math.min(box.width / 2, 220));
    const y = Math.round(box.y + box.height / 2);
    await page.evaluate(([x, y]) => {
      const c = document.getElementById('tourCur');
      if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; }
    }, [x, y]);
    await sleep(480);
    return { x, y };
  };
  const tap = async (sel, nth) => {
    const at = await moveTo(sel, nth);
    if (!at) return false;
    await page.evaluate(() => {
      const c = document.getElementById('tourCur');
      if (c) { c.classList.remove('tap'); void c.offsetWidth; c.classList.add('tap'); }
    });
    await sleep(180);
    try { await page.locator(sel).nth(nth || 0).click({ timeout: 4000 }); } catch (e) { return false; }
    await sleep(260);
    await ensureChrome(page);
    return true;
  };
  const scroll = async (to, ms) => {
    await page.evaluate(y => window.scrollTo({ top: y, behavior: 'smooth' }), to);
    await sleep(ms || 1400);
  };
  const top = () => page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  const closeDrawer = async () => {
    await page.evaluate(() => { if (window.closePortal) closePortal(); });
    await sleep(300); await ensureChrome(page);
  };

  /* ── the tour ────────────────────────────────────────────────────────── */
  await card('FORGE · Product tour',
    'The console, <em>end to end</em>.',
    'Thirty-six pages across payments, treasury, custody, wallet and the agent credit bureau — every rail resolving to one canonical event.', 4200);

  // ── OPERATIONS
  await go('overview');
  await cap('Operations · 01', 'Overview', 'Live volume, canonical events and rail health across the platform');
  await sleep(2600); await scroll(560, 1500); await sleep(1600); await top(); await sleep(900);

  await go('run');
  await cap('Operations · 02', 'End-to-end run', 'One payment traced across all nine service hops');
  await sleep(1500);
  await tap('#runBtn');
  await sleep(11500);
  await scroll(420, 1400); await sleep(2200); await top(); await sleep(800);

  await go('events');
  await cap('Operations · 03', 'Event log', 'The Revenue Ontology — one signed, deduplicated event stream');
  await sleep(2400);
  await tap('tbody tr.clickable', 1);
  await sleep(3400); await closeDrawer();

  // ── PAYMENTS
  await go('pay');
  await cap('Payments · 01', 'Overview', 'Acquiring across card, bank, stablecoin, crypto and x402');
  await sleep(2400); await scroll(520, 1400); await sleep(1500); await top(); await sleep(700);

  await go('payRoute');
  await cap('Payments · 02', 'Routing', 'The fallback chain, simulated against the live router');
  await sleep(1600);
  await tap('button:has-text("Simulate")');
  await sleep(8500);
  await scroll(380, 1300); await sleep(1800); await top(); await sleep(700);

  await go('payCheckout');
  await cap('Payments · 03', 'Checkout', 'Hosted checkout with a live routing trace');
  await sleep(1800);
  await tap('#coBtn');
  await sleep(5200);

  await go('payDisputes');
  await cap('Payments · 04', 'Disputes', 'Chargeback cases with evidence and network reason codes');
  await sleep(2000);
  await tap('tbody tr.clickable');
  await sleep(3600); await closeDrawer();

  await go('payTax');
  await cap('Payments · 05', 'Tax & merchant of record', 'Ten jurisdictions, accrued liability and the filing calendar');
  await sleep(2600); await scroll(500, 1300); await sleep(1500); await top(); await sleep(600);

  // ── TREASURY
  await go('treasury');
  await cap('Treasury · 01', 'Positions', 'Consolidated cash across entities, accounts and assets');
  await sleep(2600); await scroll(480, 1300); await sleep(1400); await top(); await sleep(600);

  await go('trNetting');
  await cap('Treasury · 02', 'Netting', 'Bilateral obligations collapsed to the minimum transfer set');
  await sleep(1800);
  await tap('tbody tr.clickable');
  await sleep(4000); await closeDrawer();
  await tap('#trNetBtn');
  await sleep(3400);

  await go('trFx');
  await cap('Treasury · 03', 'FX', 'Rate book, currency exposure and open hedges');
  await sleep(2600);

  await go('trYield');
  await cap('Treasury · 04', 'Yield', 'Idle cash swept into tokenised treasuries');
  await sleep(1600);
  await tap('button:has-text("Simulate")');
  await sleep(7500);

  await go('trPayouts');
  await cap('Treasury · 05', 'Payouts', 'Queue and the rail that won each instruction');
  await sleep(2600);

  // ── CUSTODY
  await go('custody');
  await cap('Custody · 01', 'Vaults', 'Threshold-signed vaults with policy in front and audit behind');
  await sleep(2200);
  await tap('.int');
  await sleep(4000); await closeDrawer();

  await go('cuApprovals');
  await cap('Custody · 02', 'Approvals', 'Nothing moves on one signature');
  await sleep(2200);
  await tap('#aprList .btn-ghost');
  await sleep(2400);

  await go('cuPolicy');
  await cap('Custody · 03', 'Policy engine', 'The rule chain decides the quorum — or blocks the movement');
  await sleep(1800);
  await page.selectOption('#cuDest', 'ofac').catch(() => {});
  await sleep(500);
  await tap('#cuEvalBtn');
  await sleep(4200);

  await go('cuSigners');
  await cap('Custody · 04', 'Signers & keys', 'Shares, never a whole key — with a rotation schedule');
  await sleep(2600); await scroll(520, 1300); await sleep(1400); await top(); await sleep(600);

  await go('cuAudit');
  await cap('Custody · 05', 'Audit log', 'Append-only and hash-linked to the entry before it');
  await sleep(2600); await scroll(480, 1300); await sleep(1600); await top(); await sleep(600);

  // ── WALLET
  await go('wallet');
  await cap('Wallet · 01', 'Wallets', 'Keyless smart accounts for agents, merchants and people');
  await sleep(2200);
  await tap('tbody tr.clickable');
  await sleep(3600); await closeDrawer();

  await go('waIdentity');
  await cap('Wallet · 02', 'Identity', 'The DID document and the credentials issued against it');
  await sleep(2800); await scroll(520, 1300); await sleep(1600); await top(); await sleep(600);

  await go('waRecovery');
  await cap('Wallet · 03', 'Recovery', 'Lose the device, keep the wallet — guardians rotate the key');
  await sleep(1600);
  await tap('#waRecBtn');
  await sleep(7200);

  await go('waGas');
  await cap('Wallet · 04', 'Gas & paymaster', 'ERC-4337 sponsorship, so users never hold gas');
  await sleep(2600);

  await go('waSessions');
  await cap('Wallet · 05', 'Sessions', 'Scoped, capped, expiring keys — spend this much, on this only');
  await sleep(2000);
  await tap('tbody tr.clickable');
  await sleep(3400); await closeDrawer();

  // ── CREDIT BUREAU
  await go('agents');
  await cap('Credit bureau · 01', 'Agents', 'The registry — verifiable reputation for autonomous agents');
  await sleep(2200);
  await tap('tbody tr.clickable');
  await sleep(4200); await closeDrawer();

  await go('scores');
  await cap('Credit bureau · 02', 'Scores', 'The published AAA–D grade scale');
  await sleep(2800);

  await go('verify');
  await cap('Credit bureau · 03', 'Verify', 'Registration, score and sanctions in a single request');
  await sleep(1400);
  await page.fill('#vIn', 'did:forge:0x7a3b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b').catch(() => {});
  await sleep(700);
  await tap('#vBtn');
  await sleep(6200);

  await go('engine');
  await cap('Credit bureau · 04', 'Scoring engine', 'Four weighted workflows, one published score');
  await sleep(1600);
  await tap('#eBtn');
  await sleep(8200);

  await go('ecosystem');
  await cap('Credit bureau · 05', 'Ecosystem', 'Furnishers earn a share of every inquiry their data informs');
  await sleep(2800);

  // ── RAILS + DEVELOPERS
  await go('stablecoin');
  await cap('Rails', 'Stablecoin · x402', 'Machine micropayments clearing live into the credit bureau');
  await sleep(6500);

  await go('keys');
  await cap('Developers · 01', 'API keys', 'Scoped keys, shown once');
  await sleep(2400);

  await go('webhooks');
  await cap('Developers · 02', 'Webhooks', 'One signed, deduplicated delivery — not a dozen');
  await sleep(2600);

  await go('docs');
  await cap('Developers · 03', 'API docs', 'REST plus signed webhooks over the canonical log');
  await sleep(2600);

  await capOff();
  await sleep(700);
  await card('FORGE', 'Every rail. <em>One</em> log.',
    'Payments · Treasury · Custody · Wallet · Credit Bureau — forgepay.io', 4200);

  await page.waitForTimeout(600);
  const video = page.video();
  await ctx.close();
  const path = await video.path();
  await browser.close();
  console.log(JSON.stringify({ video: path, pageErrors: errs }));
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
