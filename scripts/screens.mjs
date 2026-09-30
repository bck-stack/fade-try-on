#!/usr/bin/env node
// Phone-sized screenshots for the Devpost gallery (see docs/SCREENSHOTS.md).
//
//   node scripts/screens.mjs                          # MOCK: http://localhost:8787 (npm run dev)
//   node scripts/screens.mjs https://other.example    # any base URL
//   ADMIN_TOKEN=… node scripts/screens.mjs --live     # the deployed Worker, real YouCam
//
// Output: docs/screenshots/phone/NN-name.png, iPhone 14 (390x844 @3x).

import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT, PHONE, parseArgs, loadPlaywright, settle, openStart, agreeToPhoto, choosePhoto, runSkinCheck,
  tryLook, setSlider, openBooking, pickFirstSlot, fillBooking, confirmBooking, openAdmin,
} from './flow.mjs';

const args = parseArgs(process.argv.slice(2), { out: path.join(ROOT, 'docs/screenshots/phone') });
const token = process.env.ADMIN_TOKEN || 'local-demo-token';
const { chromium } = await loadPlaywright();

await rm(args.out, { recursive: true, force: true });
await mkdir(args.out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext(PHONE);
const page = await context.newPage();
page.setDefaultTimeout(30000);

let n = 0;
async function shot(name, target) {
  n++;
  const file = path.join(args.out, `${String(n).padStart(2, '0')}-${name}.png`);
  if (target) await target.scrollIntoViewIfNeeded();
  await settle(page, 250);
  await page.screenshot({ path: file });
  console.log('saved', path.relative(ROOT, file));
}

// Scroll so an element sits near the top of the screen (below the sticky header).
async function toTop(selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: 'instant' });
  }, selector);
}

console.log(`Screenshots from ${args.base} (${args.live ? 'live' : 'MOCK unless the server says otherwise'})`);

await openStart(page, args.base);
await shot('landing');

await agreeToPhoto(page);
await toTop('#photoConsentRow');
await shot('consent');

await choosePhoto(page, args);
await page.evaluate(() => window.scrollTo(0, 0));
await shot('selfie');

const skinOk = await runSkinCheck(page);
if (!skinOk) console.warn('Skin check did not return a result; the card shows the error instead.');
await toTop('#skinCard');
await shot('skin-check');

for (const [name, file] of [
  ['Tapered Fade', 'look-tapered-fade'],
  ['Textured Crop', 'look-textured-crop'],
  ['Buzz Cut', 'look-buzz-cut'],
  ['Anchor Beard', 'look-anchor-beard'],
  ['Tapered Fade + Anchor Beard', 'look-fade-and-anchor'],
]) {
  await tryLook(page, name);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(file);
}

await setSlider(page, 38);
await page.evaluate(() => window.scrollTo(0, 0));
await shot('before-after-slider');

await page.locator('#tab-all').click();
await page.evaluate(() => window.scrollTo(0, 0));
await shot('side-by-side-grid');
await page.locator('#tab-slider').click();

await openBooking(page);
await pickFirstSlot(page);
await page.evaluate(() => window.scrollTo(0, 0));
await shot('booking-slots');

await fillBooking(page, { consent: true });
await confirmBooking(page);
await page.evaluate(() => window.scrollTo(0, 0));
await shot('confirmation');

await openAdmin(page, args.base, token);
await shot('incoming-looks-skin-note');

await browser.close();
console.log(`${n} screenshots in ${path.relative(ROOT, args.out)}`);
