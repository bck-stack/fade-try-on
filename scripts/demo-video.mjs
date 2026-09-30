#!/usr/bin/env node
// Records the 2-2.5 minute phone-sized demo walkthrough (see docs/VIDEO-SCRIPT.md).
//
//   node scripts/demo-video.mjs                                # MOCK: http://localhost:8787
//   ADMIN_TOKEN=… node scripts/demo-video.mjs --live           # deployed Worker, real YouCam
//   ADMIN_TOKEN=… node scripts/demo-video.mjs https://… --live  # explicit URL
//
// Output: out/fade-try-on-demo.webm. Convert with scripts/webm-to-mp4.sh.
//
// Every step waits until a fixed point on a timeline (TIMELINE below), so the video is
// the same length whether YouCam answers in 1 s (MOCK) or 15 s (live). The captions
// name the YouCam API behind each step. The face is the AI-generated FLUX test face.

import { mkdir, rename, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT, PHONE, parseArgs, loadPlaywright, pause, settle, openStart, agreeToPhoto, choosePhoto, runSkinCheck,
  tryLook, setSlider, openBooking, pickFirstSlot, fillBooking, confirmBooking, openAdmin,
} from './flow.mjs';

const args = parseArgs(process.argv.slice(2), { out: path.join(ROOT, 'out') });
const token = process.env.ADMIN_TOKEN || 'local-demo-token';
const { chromium } = await loadPlaywright();

// Seconds from the start of the recording at which each scene ends. Keep in step
// with docs/VIDEO-SCRIPT.md.
export const TIMELINE = {
  title: 7,
  landing: 17,
  selfie: 24,
  skin: 52,
  fade: 70,
  beard: 83,
  combo: 101,
  compare: 113,
  book: 127,
  done: 134,
  marcus: 143,
  end: 147,
};

const rawDir = path.join(args.out, 'video-raw');
await rm(rawDir, { recursive: true, force: true });
await mkdir(rawDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  ...PHONE,
  // Captions are drawn into the page; the app's CSP would block them otherwise.
  bypassCSP: true,
  // Playwright records at CSS-pixel size (it does not upscale for deviceScaleFactor);
  // webm-to-mp4.sh scales it 2x for upload.
  recordVideo: { dir: rawDir, size: PHONE.viewport },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
const t0 = Date.now();

async function holdUntil(seconds, minMs = 1200) {
  const wait = Math.max(minMs, t0 + seconds * 1000 - Date.now());
  await pause(wait);
}

async function caption(api, text) {
  await page.evaluate(([api, text]) => {
    let box = document.getElementById('__cap');
    if (!box) {
      box = document.createElement('div');
      box.id = '__cap';
      box.style.cssText = 'position:fixed;left:10px;right:10px;top:62px;z-index:99;padding:10px 12px;border-radius:14px;background:rgba(20,20,20,.88);color:#f4efe6;font:600 14px/1.35 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);pointer-events:none;transition:opacity .3s';
      document.body.append(box);
    }
    box.replaceChildren();
    if (api) {
      const a = document.createElement('div');
      a.textContent = api;
      a.style.cssText = 'font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#c8a15a;margin-bottom:2px';
      box.append(a);
    }
    box.append(document.createTextNode(text));
    box.style.opacity = '1';
  }, [api, text]);
}

async function hideCaption() {
  await page.evaluate(() => { const b = document.getElementById('__cap'); if (b) b.style.opacity = '0'; });
}

async function card(title, lines) {
  await page.evaluate(([title, lines]) => {
    const c = document.createElement('div');
    c.id = '__card';
    c.style.cssText = 'position:fixed;inset:0;z-index:100;background:#141414;color:#f4efe6;display:grid;place-content:center;gap:14px;padding:32px;text-align:center;font:500 16px/1.45 system-ui,sans-serif';
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'font:700 30px/1.15 Georgia,serif';
    c.append(h);
    for (const l of lines) {
      const p = document.createElement('div');
      p.textContent = l;
      p.style.opacity = '.85';
      c.append(p);
    }
    document.body.append(c);
  }, [title, lines]);
}

async function removeCard() {
  await page.evaluate(() => document.getElementById('__card')?.remove());
}

async function smoothScrollTo(selector, offset = 64) {
  await page.evaluate(([sel, off]) => {
    const el = document.querySelector(sel);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: 'smooth' });
  }, [selector, offset]);
  await pause(900);
}

async function sweepSlider() {
  for (const [from, to] of [[50, 12], [12, 88], [88, 50]]) {
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      await setSlider(page, from + ((to - from) * i) / steps);
      await pause(45);
    }
  }
}

// ---- the walkthrough ---------------------------------------------------------

await openStart(page, args.base);
await card('Fade & Co. Try-On', [
  'Skin check before the cut, then try the look and book it.',
  'Fade & Co. is a fictional demo barbershop.',
  'The face is AI-generated (FLUX), not a real person.',
]);
await holdUntil(TIMELINE.title);
await removeCard();

await caption(null, 'A customer opens the shop\'s page on their phone. First, consent: the photo goes to the YouCam API and is deleted after each result.');
await pause(2500);
await smoothScrollTo('#photoConsentRow', 140);
await agreeToPhoto(page);
await holdUntil(TIMELINE.landing);

await choosePhoto(page, args);
await page.evaluate(() => window.scrollTo(0, 0));
await caption(null, 'One selfie, resized on the phone. It serves the skin check and every try-on.');
await holdUntil(TIMELINE.selfie);

await smoothScrollTo('#skinCard', 150);
await caption('YouCam AI Skin Analysis', 'Checks redness, bumps, texture and oiliness on the same photo (4 concerns, 9 units).');
await runSkinCheck(page);
await smoothScrollTo('#skinCard', 150);
// Captions quote what the card actually says, so a live run never shows made-up advice.
const skinText = await page.evaluate(() => {
  const q = (s) => document.querySelector(s)?.textContent.trim() || '';
  return q('.skin-head') ? `${q('.skin-head')} ${q('.skin-finish').replace(/^Finish:\s*/, '→ ')}` : q('#skinCard .error');
});
await caption('YouCam AI Skin Analysis', skinText || 'The skin check card shows what the photo showed and a suggested finish.');
await pause(7000);
await smoothScrollTo('#skinCard h4', 180);
await caption('YouCam AI Skin Analysis', 'Plain aftercare, no brands, and a clear line: this is not a medical assessment.');
await holdUntil(TIMELINE.skin);

await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await caption('AI Hairstyle Generator v2.1', 'Tapered Fade: a real Skin Fade service, £28, 45 min.');
await tryLook(page, 'Tapered Fade');
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await sweepSlider();
await holdUntil(TIMELINE.fade);

await caption('AI Beard Style Generator', 'Anchor Beard: Beard Trim & Shape, £14, 20 min.');
await tryLook(page, 'Anchor Beard');
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await holdUntil(TIMELINE.beard);

await caption('AI Hairstyle Generator v2.1 → AI Beard Style Generator', 'Cut + Beard: the hairstyle result is fed straight into the beard task.');
await tryLook(page, 'Tapered Fade + Anchor Beard');
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await sweepSlider();
await holdUntil(TIMELINE.combo);

await caption(null, 'Compare: side by side, or everything tried. Going back to a look is free.');
await page.locator('#tab-side').click();
await pause(3500);
await page.locator('#tab-all').click();
await pause(3500);
await page.locator('#tab-slider').click();
await holdUntil(TIMELINE.compare);

await caption(null, 'Book this look. Times come live from the shop\'s booking server (MCP).');
await openBooking(page);
await pickFirstSlot(page);
await pause(1500);
await fillBooking(page, { consent: false });
await smoothScrollTo('#consentRow', 220);
await page.locator('#consent').check();
await caption(null, 'The same consent box shares the look and a one-line skin note with Marcus. Never the selfie or the scores.');
await holdUntil(TIMELINE.book);

await confirmBooking(page);
await page.evaluate(() => window.scrollTo(0, 0));
await caption(null, 'Booked. The confirmation carries the look and the suggested finish.');
await holdUntil(TIMELINE.done);

await openAdmin(page, args.base, token);
const note = await page.evaluate(() => document.querySelector('#list .skin-note')?.textContent.trim() || '');
await caption(null, note ? `Marcus's Incoming looks, before the customer sits down: "${note}"` : "Marcus's Incoming looks: the chosen look, before the customer sits down.");
await holdUntil(TIMELINE.marcus);

await hideCaption();
await card('Fade & Co. Try-On', [
  'YouCam AI Skin Analysis',
  'AI Hairstyle Generator v2.1 · AI Beard Style Generator',
  'Selfie never stored. YouCam tasks deleted after each result.',
]);
await holdUntil(TIMELINE.end);

const seconds = ((Date.now() - t0) / 1000).toFixed(1);
await context.close();
await browser.close();

const [raw] = (await readdir(rawDir)).filter((f) => f.endsWith('.webm'));
const final = path.join(args.out, 'fade-try-on-demo.webm');
await rename(path.join(rawDir, raw), final);
await rm(rawDir, { recursive: true, force: true });
console.log(`Recorded ${seconds}s -> ${path.relative(ROOT, final)}`);
if (seconds > 150) console.warn('Longer than 2:30 (YouCam was slow). Still under the 3:00 limit if below 180 s; otherwise re-run.');
console.log('MP4: sh scripts/webm-to-mp4.sh ' + path.relative(ROOT, final));
