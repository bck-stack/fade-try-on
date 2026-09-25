// Builds the illustrated sample images used by MOCK mode (YOUCAM_MOCK=1).
//
// Each image is an SVG illustration (no real faces), rasterised to JPEG with the
// headless Chromium that ships with Playwright (via playwright-core, not a
// dependency: `npm i --no-save playwright-core` first), then written into
// src/mock-images.js as base64 so the Worker and the node tests can use them
// without a bundler rule for binary files.
//
//   node scripts/build-mock-images.mjs
//
// Set CHROMIUM=/path/to/chrome if it is not at the default Playwright path.

import { writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 480;
const H = 600;
const HAIR = '#1e1611';
const SKIN = '#b07a55';
const SKIN_SHADE = '#9a6746';

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const dir of readdirSync(root)) {
    if (!dir.startsWith('chromium-')) continue;
    const bin = join(root, dir, 'chrome-linux', 'chrome');
    if (existsSync(bin)) return bin;
  }
  throw new Error('Chromium not found; set CHROMIUM=/path/to/chrome');
}

// ---- building blocks -------------------------------------------------------

const defs = `
<defs>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
  <clipPath id="head"><ellipse cx="240" cy="262" rx="96" ry="122"/></clipPath>
  <linearGradient id="skinFade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${HAIR}" stop-opacity=".9"/>
    <stop offset=".45" stop-color="${HAIR}" stop-opacity=".35"/>
    <stop offset="1" stop-color="${HAIR}" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="midFade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${HAIR}" stop-opacity=".95"/>
    <stop offset=".7" stop-color="${HAIR}" stop-opacity=".45"/>
    <stop offset="1" stop-color="${HAIR}" stop-opacity=".05"/>
  </linearGradient>
  <linearGradient id="taper" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${HAIR}" stop-opacity="1"/>
    <stop offset="1" stop-color="${HAIR}" stop-opacity=".55"/>
  </linearGradient>
  <radialGradient id="bgGlow" cx=".5" cy=".42" r=".7">
    <stop offset="0" stop-color="#fffaf1"/>
    <stop offset="1" stop-color="#e9dfcc"/>
  </radialGradient>
</defs>`;

const background = (accent) => `
<rect width="${W}" height="${H}" fill="url(#bgGlow)"/>
<circle cx="240" cy="265" r="190" fill="${accent}" opacity=".13"/>
<g opacity=".25" stroke="${accent}" stroke-width="10">
  <line x1="-20" y1="560" x2="120" y2="420"/><line x1="10" y1="590" x2="150" y2="450"/>
  <line x1="360" y1="450" x2="500" y2="590"/><line x1="330" y1="420" x2="470" y2="560"/>
</g>`;

const body = `
<path d="M70 600 C80 505 150 452 206 440 L274 440 C330 452 400 505 410 600 Z" fill="#23272b"/>
<path d="M200 440 L240 486 L280 440 Z" fill="#1a1d20"/>
<rect x="206" y="352" width="68" height="100" rx="22" fill="${SKIN_SHADE}"/>`;

const head = `
<ellipse cx="146" cy="282" rx="17" ry="28" fill="${SKIN}"/>
<ellipse cx="334" cy="282" rx="17" ry="28" fill="${SKIN}"/>
<ellipse cx="240" cy="262" rx="96" ry="122" fill="${SKIN}"/>`;

const face = `
<g>
  <path d="M188 238 q18 -10 36 -2" stroke="${HAIR}" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M256 236 q18 -8 36 2" stroke="${HAIR}" stroke-width="7" fill="none" stroke-linecap="round"/>
  <ellipse cx="206" cy="262" rx="14" ry="8" fill="#fff"/>
  <ellipse cx="274" cy="262" rx="14" ry="8" fill="#fff"/>
  <circle cx="207" cy="262" r="6" fill="#2a1a12"/>
  <circle cx="275" cy="262" r="6" fill="#2a1a12"/>
  <path d="M240 270 L231 310 Q240 318 250 311" stroke="${SKIN_SHADE}" stroke-width="4" fill="none" stroke-linecap="round"/>
</g>`;

const mouth = `<path d="M214 342 Q240 356 266 342" stroke="#6e3a2a" stroke-width="5" fill="none" stroke-linecap="round"/>`;

// Hair variants ------------------------------------------------------------

const hairOvergrown = `
<path d="M136 290 C120 200 150 118 240 110 C330 118 362 200 344 290 C336 250 330 228 318 214
         C300 222 270 206 254 196 C236 214 196 220 170 212 C158 232 150 256 136 290 Z" fill="${HAIR}"/>
<path d="M170 212 C190 190 214 204 222 186 M250 196 C262 182 286 196 300 186" stroke="#3a2b22" stroke-width="3" fill="none"/>`;

const fadeSides = (grad) => `
<g clip-path="url(#head)"><g filter="url(#soft)">
  <path d="M136 180 Q132 250 146 310 L172 310 Q164 250 182 180 Z" fill="url(#${grad})"/>
  <path d="M344 180 Q348 250 334 310 L308 310 Q316 250 298 180 Z" fill="url(#${grad})"/>
</g></g>`;

const hairSkinFadeTop = `
<path d="M162 206 C160 150 196 124 240 122 C284 124 320 150 318 206 C300 192 280 188 240 190 C200 188 180 192 162 206 Z" fill="${HAIR}"/>
<path d="M190 160 l10 -8 M214 148 l12 -8 M244 144 l12 -6 M270 152 l12 -6" stroke="#3a2b22" stroke-width="3" stroke-linecap="round"/>`;

const hairCropTop = `
<path d="M160 214 C156 150 196 120 240 118 C284 120 324 150 320 214 L300 212 L288 206 L274 212 L262 204 L248 212 L234 204 L220 212 L206 204 L192 212 L178 206 Z" fill="${HAIR}"/>
<path d="M186 170 l14 -10 M214 160 l14 -12 M246 156 l14 -10 M274 164 l14 -10 M200 190 l10 -8 M262 186 l12 -8" stroke="#3a2b22" stroke-width="3" stroke-linecap="round"/>`;

const hairSidePart = `
<path d="M150 250 C140 170 180 112 250 112 C312 114 346 160 332 250 C326 226 320 212 310 204
         C286 178 250 170 214 178 C200 182 196 190 196 196 C180 200 164 216 150 250 Z" fill="${HAIR}"/>
<path d="M200 190 C196 160 214 134 244 128" stroke="${SKIN}" stroke-width="3" fill="none" opacity=".75"/>
<path d="M226 150 C262 134 300 146 318 180 M232 166 C266 154 296 166 312 196" stroke="#3a2b22" stroke-width="3" fill="none"/>`;

const hairCrew = `
<path d="M156 226 C152 156 194 126 240 124 C286 126 328 156 324 226 C312 206 288 196 240 196 C192 196 168 206 156 226 Z" fill="${HAIR}"/>
<path d="M184 168 l8 -5 M204 156 l8 -5 M226 150 l8 -4 M250 150 l8 -4 M272 156 l8 -5 M292 168 l8 -5" stroke="#3a2b22" stroke-width="3" stroke-linecap="round"/>
<g clip-path="url(#head)"><g filter="url(#soft)" opacity=".55"><path d="M136 196 Q134 240 144 284 L170 284 Q164 240 178 196 Z" fill="${HAIR}"/><path d="M344 196 Q346 240 336 284 L310 284 Q316 240 302 196 Z" fill="${HAIR}"/></g></g>`;

// Beard variants ------------------------------------------------------------

const stubbleLight = `
<g clip-path="url(#head)">
  <path d="M150 292 C156 354 196 392 240 394 C284 392 324 354 330 292 C320 322 300 330 280 330 C262 330 252 324 240 324 C228 324 218 330 200 330 C180 330 160 322 150 292 Z" fill="${HAIR}" opacity=".16"/>
</g>`;

const beardBoxed = `
<g clip-path="url(#head)">
  <path d="M146 276 C150 350 190 398 240 402 C290 398 330 350 334 276 C326 300 318 312 306 318
           C296 344 274 360 240 362 C206 360 184 344 174 318 C162 312 154 300 146 276 Z" fill="${HAIR}"/>
  <path d="M206 330 C218 320 230 322 240 326 C250 322 262 320 274 330 C262 336 250 334 240 332 C230 334 218 336 206 330 Z" fill="${HAIR}"/>
</g>
<path d="M178 318 C192 312 204 308 212 300 M302 318 C288 312 276 308 268 300" stroke="#3a2b22" stroke-width="2" fill="none"/>`;

const beardStubbleLine = `
<g clip-path="url(#head)">
  <path d="M150 284 C154 352 194 396 240 398 C286 396 326 352 330 284 L322 290 C316 312 300 318 286 322 C272 344 258 352 240 352 C222 352 208 344 194 322 C180 318 164 312 158 290 Z" fill="${HAIR}" opacity=".42"/>
  <path d="M208 330 C220 322 232 324 240 327 C248 324 260 322 272 330 C260 334 250 333 240 332 C230 333 220 334 208 330 Z" fill="${HAIR}" opacity=".6"/>
</g>`;

const sampleTag = `
<g>
  <rect x="16" y="16" width="148" height="30" rx="15" fill="#141414" opacity=".82"/>
  <text x="90" y="36" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" letter-spacing="1.5" fill="#f4efe6">SAMPLE · MOCK</text>
</g>`;

function portrait({ accent, hair, beard }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${defs}
${background(accent)}
${body}
${head}
${beard}
${face}
${mouth}
${hair}
${sampleTag}
</svg>`;
}

// One image per look id in src/looks.js, plus the demo "selfie".
const images = {
  'demo-selfie': { accent: '#6b7280', hair: hairOvergrown, beard: stubbleLight },
  'tapered-fade': { accent: '#b8322a', hair: fadeSides('skinFade') + hairSkinFadeTop, beard: stubbleLight },
  'textured-crop': { accent: '#c8a15a', hair: fadeSides('midFade') + hairCropTop, beard: stubbleLight },
  'side-swept-undercut': { accent: '#2f5d50', hair: fadeSides('taper') + hairSidePart, beard: stubbleLight },
  'anchor-beard': { accent: '#7a4b2a', hair: hairOvergrown, beard: beardBoxed },
  'goatee': { accent: '#44607a', hair: hairOvergrown, beard: beardStubbleLine },
  'fade-and-anchor': { accent: '#b8322a', hair: fadeSides('skinFade') + hairSkinFadeTop, beard: beardBoxed },
  'buzz-cut': { accent: '#3d7bd9', hair: hairCrew, beard: '' },
};

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: findChromium() });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const out = {};

for (const [name, parts] of Object.entries(images)) {
  await page.setContent(`<!doctype html><html><body style="margin:0">${portrait(parts)}</body></html>`);
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: W, height: H } });
  out[name] = jpeg.toString('base64');
  console.log(`${name}: ${Math.round(jpeg.length / 1024)} KB`);
}
await browser.close();

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'mock-images.js');
const body_ = Object.entries(out)
  .map(([k, v]) => `  '${k}': '${v}',`)
  .join('\n');
writeFileSync(target, `// Generated by scripts/build-mock-images.mjs. Do not edit by hand.
// Illustrated sample images (JPEG, base64) used when YOUCAM_MOCK=1.

export const MOCK_IMAGE_TYPE = 'image/jpeg';

export const MOCK_IMAGES = {
${body_}
};
`);
console.log(`wrote ${target}`);
