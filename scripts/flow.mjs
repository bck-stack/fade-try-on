// Shared Playwright helpers for scripts/screens.mjs and scripts/demo-video.mjs.
// They drive the real pages the way a customer would; nothing here is app code.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// AI-generated test face (FLUX), cropped from docs/samples/real-youcam-results.jpg.
// Never use a real person's photo here.
export const SELFIE = path.join(ROOT, 'docs/samples/flux-selfie.jpg');
export const CLOSEUP = path.join(ROOT, 'docs/samples/flux-closeup.jpg');

export const LOCAL_URL = 'http://localhost:8787';
// TODO(owner): confirm the deployed URL, or always pass it on the command line.
export const LIVE_URL = 'https://fade-try-on.fadeandco.workers.dev';

// iPhone 14: 390x844 CSS pixels at device scale factor 3.
export const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  locale: 'en-GB',
  colorScheme: 'light',
};

// `node script.mjs [baseUrl] [--live] [--out dir]`
export function parseArgs(argv, defaults = {}) {
  const args = { live: false, base: null, out: defaults.out };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') args.live = true;
    else if (a === '--out') args.out = argv[++i];
    else if (!a.startsWith('--')) args.base = a;
  }
  args.base = (args.base || (args.live ? LIVE_URL : LOCAL_URL)).replace(/\/$/, '');
  return args;
}

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    console.error('Playwright is missing. Run: npm install && npx playwright install chromium');
    process.exit(1);
  }
}

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function settle(page, ms = 450) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await pause(ms);
}

export async function openStart(page, base) {
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('tries') && !document.getElementById('tries').hidden, null, { timeout: 15000 }).catch(() => {});
}

export async function agreeToPhoto(page) {
  await page.locator('#photoConsent').check();
}

// MOCK mode has a demo-face button; live mode uploads the FLUX test face.
export async function choosePhoto(page, { live }) {
  const mock = await page.locator('#demo').isVisible();
  if (mock && !live) await page.locator('#demo').click();
  else await page.locator('#pick').setInputFiles(SELFIE);
  await page.locator('#s-studio').waitFor({ state: 'visible' });
  await settle(page);
}

// Runs the skin check. If YouCam says the face is too small in the head-and-shoulders
// selfie (it wants the face wider than 60% of the photo), retries with the close-up.
export async function runSkinCheck(page) {
  await page.locator('#skinBtn').click();
  const done = page.locator('#skinCard.has-result, #skinCard .error');
  await done.first().waitFor({ timeout: 120000 });
  if (!(await page.locator('#skinCard.has-result').count())) {
    const closeUp = page.locator('#skinCard input[type=file]');
    if (await closeUp.count()) {
      await closeUp.setInputFiles(CLOSEUP);
      await page.locator('#skinCard.has-result, #skinCard .error').first().waitFor({ timeout: 120000 });
    }
  }
  await settle(page);
  return page.locator('#skinCard.has-result').count().then(Boolean);
}

export async function tryLook(page, name) {
  const card = page.locator('.look', { has: page.locator('.name', { hasText: new RegExp('^' + escape(name) + '$') }) });
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.waitForFunction(() => document.getElementById('busy').hidden, null, { timeout: 150000 });
  await settle(page, 600);
  const err = page.locator('#err');
  if (await err.isVisible()) throw new Error(`${name}: ${await err.textContent()}`);
}

export async function setSlider(page, pct) {
  await page.evaluate((p) => {
    const s = document.getElementById('slider');
    s.value = String(p);
    s.dispatchEvent(new Event('input', { bubbles: true }));
  }, pct);
}

export async function openBooking(page) {
  await page.locator('#bookBtn').click();
  await page.locator('#s-book').waitFor({ state: 'visible' });
  await page.locator('#soonest .chip').first().waitFor({ timeout: 20000 });
  await settle(page);
}

// Opens the first day in the 14-day picker that has free times, so the times grid shows.
export async function pickFirstSlot(page) {
  const days = page.locator('.chip.day');
  const n = await days.count();
  for (let i = 0; i < n; i++) {
    await days.nth(i).click();
    await page.waitForFunction(() => !/Loading times/.test(document.getElementById('times').textContent), null, { timeout: 20000 });
    if (await page.locator('#times .time').count()) break;
  }
  await settle(page);
}

export async function fillBooking(page, { consent = true } = {}) {
  const time = page.locator('#times .time').first();
  if (await time.count()) await time.click();
  else await page.locator('#soonest .chip').first().click();
  await page.locator('#form').waitFor({ state: 'visible' });
  await page.locator('#name').fill('Sam Demo');
  await page.locator('#phone').fill('07700 900123'); // Ofcom drama range: never a real number
  if (consent) await page.locator('#consent').check();
  await settle(page, 300);
}

export async function confirmBooking(page) {
  await page.locator('#confirm').click();
  await page.locator('#s-done').waitFor({ state: 'visible', timeout: 30000 });
  await settle(page);
}

export async function openAdmin(page, base, token) {
  await page.goto(base + '/admin', { waitUntil: 'networkidle' });
  if (await page.locator('#login').isVisible()) {
    await page.locator('#token').fill(token);
    await page.locator('#loginForm button[type=submit]').click();
  }
  await page.locator('#list .card, #list p').first().waitFor({ timeout: 20000 });
  await settle(page, 800);
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
