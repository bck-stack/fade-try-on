# Screenshots

Fourteen phone-sized screenshots for the Devpost gallery: iPhone 14, 390×844 CSS pixels at device scale factor 3 (1170×2532 PNG). They're made by [`scripts/screens.mjs`](../scripts/screens.mjs) (Playwright + Chromium), which walks the real app the way a customer would.

The set in [`docs/screenshots/phone/`](screenshots/phone/) was taken in **MOCK mode**: the faces are the bundled drawn illustrations (marked "SAMPLE · MOCK"), the skin result is the documented response shape with fixed scores, and no YouCam units were used. Say so in the Devpost captions, or re-take them live (below).

| # | File | What it shows | Suggested Devpost caption |
|---|---|---|---|
| 1 | `01-landing.png` | Start screen | "One selfie: a skin check first, then try the cut and book it. Fade & Co. is a fictional demo shop." |
| 2 | `02-consent.png` | Photo consent ticked; photo buttons enabled | "Consent before the camera: the photo goes to YouCam and is deleted after each result." |
| 3 | `03-selfie.png` | The selfie on the studio screen | "The same photo serves the skin check and every look." |
| 4 | `04-skin-check.png` | Skin check card with levels, finish, service nudge, aftercare, raw scores, disclaimer | "YouCam AI Skin Analysis → 'Consider a #1 guard instead of a foil or razor finish today.' Not a medical assessment." |
| 5 | `05-look-tapered-fade.png` | Tapered Fade result on the slider | "AI Hairstyle Generator v2.1: Tapered Fade (Skin Fade, £28)." |
| 6 | `06-look-textured-crop.png` | Textured Crop | "Textured Crop (Skin Fade, £28)." |
| 7 | `07-look-buzz-cut.png` | Buzz Cut | "Buzz Cut (Classic Cut, £22)." |
| 8 | `08-look-anchor-beard.png` | Anchor Beard | "AI Beard Style Generator: Anchor Beard (Beard Trim & Shape, £14)." |
| 9 | `09-look-fade-and-anchor.png` | Tapered Fade + Anchor Beard | "Hairstyle, then beard on the result: the Cut + Beard service (£38)." |
| 10 | `10-before-after-slider.png` | Slider dragged to 38% | "Drag between before and after." |
| 11 | `11-side-by-side-grid.png` | "All tried" grid | "Every look tried so far, side by side. Revisiting is free." |
| 12 | `12-booking-slots.png` | Skin note under the look, soonest free times, a day's times | "Real free times from the shop's booking server (MCP)." |
| 13 | `13-confirmation.png` | Booked, with the look and the suggested finish | "Booked, with the look and the suggested finish." |
| 14 | `14-incoming-looks-skin-note.png` | Marcus's Incoming looks with the look image and the skin note | "The barber sees it before you sit down: 'noticeable redness… Suggested #1 guard, no razor.'" |

## Re-taking them

MOCK (no key, no units):

```sh
npm install
npx playwright install chromium
cp .dev.vars.example .dev.vars          # YOUCAM_MOCK=1, BOOKING_MOCK=1; set ADMIN_TOKEN=local-demo-token
npm run dev                             # http://localhost:8787, in another terminal
npm run screens                         # writes docs/screenshots/phone/*.png
```

The script uses `ADMIN_TOKEN` from the environment for Marcus's page, defaulting to `local-demo-token`. Run against any other URL with `node scripts/screens.mjs <baseUrl>`.

Live (real YouCam, spends units, books a real demo appointment on the Chair Ready Voice server unless `BOOKING_MOCK=1` is deployed):

```sh
ADMIN_TOKEN='<your admin token>' node scripts/screens.mjs https://<your-worker>.workers.dev --live
```

- In live mode the script uploads `docs/samples/flux-selfie.jpg`, an AI-generated (FLUX) face, never a real person. If the skin check answers "face too small" (YouCam wants the face wider than 60% of the photo), it retries with `docs/samples/flux-closeup.jpg`, a crop of the same face.
- Cost: about 9 units for the skin check plus 12 for the five looks (2 + 2 + 2 + 2 + 4). The skin result is cached for 6 hours by photo, so a video recorded soon after with the same photo won't pay for it again. Check the balance on `/admin` first.
- The five looks use 5 of the visitor's 8 daily tries (`TRY_LIMIT`); the demo video uses 3 more.
- With `--live` and no URL, the script uses `LIVE_URL` in `scripts/flow.mjs` (**TODO:** set it to the real deployed URL, or always pass the URL).
