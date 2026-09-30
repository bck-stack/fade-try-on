# Fade & Co. Try-On

**A skin check before the cut: YouCam AI Skin Analysis tells the barber whether a close foil or razor finish is a bad idea today, then the customer tries the cut on their own face and books it.**

> **Fade & Co. is a fictional one-chair barbershop** that we use as the demo customer, shared with our Chair Ready Voice project. "Marcus", its owner, is fictional too. Nothing below describes a real shop we visited or watched. The test face in every screenshot and in the video is AI-generated (FLUX) or a drawn illustration, never a real person.

## Inspiration

Close cuts are hard on skin. Skin fades, line-ups and clean shaves take the hair right down to the skin, and the razor and foil finishes that make them look sharp are what cause trouble.

The medical name for razor bumps is *pseudofolliculitis barbae*. DermNet describes it as a common inflammatory reaction of the hair follicle, most often on the face as a result of shaving. It is more likely with curly and coarse hair, is linked to close shaving, and is more common with blade razors than electric shavers ([DermNet: Pseudofolliculitis barbae](https://dermnetnz.org/topics/pseudofolliculitis-barbae)). The NHS says you may be more likely to get ingrown hairs if you have coarse or curly hair, that the best way to prevent them is not shaving, and suggests an electric razor over wet shaving ([NHS: Ingrown hairs](https://www.nhs.uk/conditions/ingrown-hairs/)).

So the decisions that matter for irritation are barbershop decisions: which guard to finish on, foil, razor or neither, and a beard trim instead of a clean shave. They're usually made by eye, once the customer is in the chair. We wanted the barber to have that information earlier, from the selfie the customer already takes to try on cuts: skin analysis that changes the service, not a product sale.

## What it does

On their phone, a customer:

1. **Agrees to how the photo is used.** A plain consent box comes before the camera opens: the photo goes to the YouCam API for the skin check and try-ons, is deleted from YouCam right after each result, and is never stored by us. The photo buttons stay disabled until the box is ticked.
2. **Takes one selfie.** The page resizes it to 1000px and re-encodes it as JPEG on the phone, which strips EXIF and GPS data. The same photo serves every step.
3. **Runs the skin check.** The "Skin check before the cut" card sends the photo to **YouCam AI Skin Analysis** for four concerns: redness, acne (spots and bumps), texture and oiliness. The card shows each as *Low*, *Some* or *Noticeable* and turns them into three things:
   - **A finish suggestion.** For example: "Your photo showed noticeable redness. Consider a #1 guard instead of a foil or razor finish today."
   - **A service nudge**, only for services on the shop's live price list: "If you were thinking of a clean shave, a Beard Trim & Shape (£14) is easier on the skin today." A hot-towel prep appears only if the shop sells one (Fade & Co. doesn't).
   - **Two or three aftercare tips**, with no brands and no products: rinse with cool water and pat dry, a plain fragrance-free moisturiser, don't pick at bumps.

   Every result ends with: "This is not a medical assessment. If your skin is sore, broken or infected, see a pharmacist or GP before a close shave."
4. **Tries the shop's looks.** Seven looks, each a real service with its price: Tapered Fade and Textured Crop (Skin Fade, £28), Side-Swept Undercut and Buzz Cut (Classic Cut, £22), Anchor Beard and Goatee (Beard Trim & Shape, £14), and Tapered Fade + Anchor Beard (Cut + Beard, £38). They can compare them with a before/after slider, side by side, or in a grid of everything tried.
5. **Books the look** at a time that's really free, through the shop's booking server.
6. **Shares it with Marcus, if they choose.** The existing consent box on the booking form now covers the chosen look image *and* a one-line skin note. Marcus's "Incoming looks" page then shows, for example: "Skin check: noticeable redness, some spots or bumps. Suggested #1 guard, no razor." He sees it before the customer walks in. Without consent, the skin check never leaves the phone.

## How we built it

One Cloudflare Worker, plain ES modules, no framework. Three YouCam APIs, all following the documented flow: register a file, upload to the presigned URL, start a task, poll it, read the result, delete the task.

**YouCam APIs and endpoints**

| API | Docs category | Endpoints |
|---|---|---|
| **AI Skin Analysis** (v2.1) | Skin, Face & Body | `POST /s2s/v2.1/task/skin-analysis`, `GET /s2s/v2.1/task/skin-analysis/{task_id}` |
| AI Hairstyle Generator (v2.1) | Hair & Beard | `POST /s2s/v2.1/task/hair-transfer`, `GET …/{task_id}`, `GET /s2s/v2.1/task/template/hair-transfer` |
| AI Beard Style Generator | Hair & Beard | `POST /s2s/v2.0/task/beard-style`, `GET …/{task_id}`, `GET /s2s/v2.0/task/template/beard-style` |
| File API | Utility | `POST /s2s/v2.0/file`, then `PUT` to the presigned URL |
| Task delete | Utility | `POST /s2s/v2.0/task/delete` |
| Unit balance (staff view) | Utility | `GET /s2s/v1.0/client/credit` |

- **Skin Analysis request.** `{ src_file_id, dst_actions: ["redness", "acne", "texture", "oiliness"], format: "json" }`. These are four SD concerns, the cheapest tier (1–4 concerns = 9 units). We chose them because they're the ones that change a barber's decision; pores, wrinkles and eye bags don't. `format: "json"` returns the scores inline, so the Worker doesn't have to download and unzip a results archive.
- **Reading the scores.** Each concern has a `raw_score` and a `ui_score` from 1 to 100, where higher means healthier skin. The docs say `ui_score` is adjusted upwards on purpose, as "a psychological motivator", so we use `raw_score`. Below 40 is *Noticeable*, 40 to under 60 is *Some*, 60 and above is *Low*. These cut-offs are ours, not YouCam's, and our write-up says so. The mapping is a small pure function (`src/skin.js`) with a test at every boundary.
- **Hair and beard.** Each look pins a template id we checked against the live catalogue. Cut + Beard chains two tasks: the beard task runs on the hairstyle task's result URL.
- **Booking over MCP.** The Worker uses the official `@modelcontextprotocol/sdk` client (Streamable HTTP) to talk to the Chair Ready Voice booking server for prices, free times and bookings.
- **Storage.** Workers KV holds consented looks and skin notes (deleted a week after the appointment), usage counters, and a six-hour cache of skin *levels* keyed by a photo hash.
- **MOCK mode.** `YOUCAM_MOCK=1` returns bundled illustrations for the looks and a skin result in the exact documented `format=json` shape, so the app, the tests and the demo run with no key and no units.
- **Tests.** `npm test` runs 82 node:test tests with no network, against a fake YouCam API that speaks the documented shapes. The new skin tests cover the request body, every threshold boundary, both result formats, consent gating, "no charge on failure", and that the task is deleted after success and after failure.

## Challenges we ran into

- **Our first version didn't qualify.** Hairstyle and beard are both under *Hair & Beard* in the YouCam docs, not Skin or Fashion. Rather than bolt on an unrelated API, we looked for the barbershop problem a Skin API could actually help with. That became the skin check.
- **The skin check wants a different photo from the hairstyle.** Skin Analysis needs the face wider than 60% of the image, while the hairstyle engine needs the shoulders in shot (`error_no_shoulder`). One selfie can't always satisfy both. We don't hide this: if YouCam answers `error_src_face_too_small`, the card explains and offers "Take a close-up for the skin check". That close-up is used for the skin check only, and a failed check costs nothing (the Skin Analysis docs say units are only used on success).
- **Redness on darker skin.** The NHS notes that redness from ingrown hairs may be harder to see on black or brown skin, and DermNet says razor bumps predominantly affect men of African ancestry. So the people who most need this check are the ones a redness score may under-read. We can't fix the model, so a *Low* result never reads as an all-clear: it says a camera can miss irritation, especially on darker skin, and asks the customer to tell the barber if their skin often reacts.
- **Not sounding like a doctor.** Every sentence the card can show lives in one tested file: guards and services, generic aftercare, no brands, no diagnoses, and the disclaimer on every result.
- **Units.** A skin check costs 9 units, more than a Cut + Beard (4). We added a site-wide daily unit cap, cache results by photo, and only count a check once it returns a result.

## Accomplishments that we're proud of

- The skin check changes what happens in the chair. It gives a guard number, "no razor", or a beard trim instead of a shave, and the barber gets it before the customer arrives.
- Privacy got stricter, not looser, with the new feature. The selfie is still never stored. Each YouCam task, including the skin analysis, is deleted as soon as we've read it. Raw scores are shown to the customer once and never stored. Marcus gets one derived line, only with consent, and it expires with the look.
- The server rebuilds Marcus's note from the levels, so a tampered request can't put its own words on his screen.

## What we learned

- Read a score's definition before building on it. YouCam's `ui_score` is deliberately flattering, which is fine for a beauty app but wrong for a caution flag. Our logic uses `raw_score`.
- Unit tiers shape the product: four concerns cost 9 units, five cost 12, so "which four matter to a barber?" was a design question.
- The shared file → task → poll → delete flow meant the Skin API needed one new client method, nothing else.
- Honest limits make better UX: the close-up fallback and the darker-skin caveat both came from reading the docs carefully.

## What's next

- Keep checking the thresholds against more real faces. We calibrated them on live results (a clear-skinned test face scored 88–99; a face with visible razor redness 57–71), and we'll only move them in the cautious direction.
- Try YouCam's Mobile Camera Kit, which guides the face into frame, to cut down on "face too small".
- Let Marcus confirm or adjust the suggested finish on his screen, so the note becomes his decision, not ours.
- Send the skin check alone as a pre-appointment link in the booking text.

## Built with

- **YouCam API:** AI Skin Analysis v2.1, AI Hairstyle Generator v2.1, AI Beard Style Generator, File API, task delete, unit balance
- Cloudflare Workers, Workers KV, Wrangler
- Model Context Protocol: `@modelcontextprotocol/sdk`, Streamable HTTP
- JavaScript (ES modules), HTML, CSS; node:test; Playwright (screenshots and video)
