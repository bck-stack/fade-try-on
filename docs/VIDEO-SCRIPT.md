# Demo video script: Fade & Co. Try-On

**Length: 2:27** (the recording is 2:27–2:28; the hard limit is 3:00). Portrait phone, 390×844, recorded by [`scripts/demo-video.mjs`](../scripts/demo-video.mjs) with Playwright. The voice-over below is timed to that recording, second by second. The on-screen captions are drawn by the script and name the YouCam API behind each step.

- **Fade & Co. and Marcus are fictional.** The video says so on its title card and the voice-over never claims otherwise.
- **The face is AI-generated** (FLUX, `docs/samples/flux-selfie.jpg`) in live mode, or the drawn demo face in MOCK mode. Never a real person's photo.

## Recording it

The owner runs this against the live deployment with a real key (it spends YouCam units: about 9 for the skin check + 8 for three looks; check the balance on `/admin` first):

```sh
npm install
npx playwright install chromium
ADMIN_TOKEN='<your admin token>' node scripts/demo-video.mjs https://<your-worker>.workers.dev --live
sh scripts/webm-to-mp4.sh            # out/fade-try-on-demo.webm -> out/fade-try-on-demo.mp4 (needs ffmpeg)
```

Rehearsal without units: `npm run dev` with `.dev.vars` from `.dev.vars.example` (`YOUCAM_MOCK=1`, `BOOKING_MOCK=1`, `ADMIN_TOKEN=local-demo-token`), then `node scripts/demo-video.mjs`.

Every scene waits until a fixed second on the timeline (`TIMELINE` in the script), so the video is the same length whether YouCam answers in 1 second (MOCK) or 15 (live). If a live step takes longer than its slot, the following pauses shrink. The skin-check and Marcus captions quote what the page actually shows, so in a live run they may differ from the MOCK wording below; read the voice-over lines in *italics* from the screen if they do.

Record the voice-over separately and lay it over the MP4 (any editor; `ffmpeg -i out/fade-try-on-demo.mp4 -i voice.m4a -c:v copy -c:a aac -shortest final.mp4` also works).

## Timeline and voice-over

| Time | On screen (caption in **bold**) | Voice-over |
|---|---|---|
| 0:00–0:07 | Title card: "Fade & Co. Try-On. Skin check before the cut, then try the look and book it. Fade & Co. is a fictional demo barbershop. The face is AI-generated (FLUX), not a real person." | "Close cuts are hard on skin. This is Try-On, built on three YouCam APIs, for a fictional barbershop called Fade and Co." |
| 0:07–0:17 | Start screen; the page scrolls to the consent box and ticks it. **"A customer opens the shop's page on their phone. First, consent: the photo goes to the YouCam API and is deleted after each result."** | "The customer opens the shop's page. Before any camera opens, they agree to how the photo is used: it goes to YouCam, and it's deleted after every result." |
| 0:17–0:24 | The selfie appears on the studio screen. **"One selfie, resized on the phone. It serves the skin check and every try-on."** | "One selfie, resized on the phone. The same photo does everything that follows." |
| 0:24–0:52 | The Skin check card. Caption **YouCam AI Skin Analysis: "Checks redness, bumps, texture and oiliness on the same photo (4 concerns, 9 units)."** A spinner, then the result: Redness *Noticeable*, Spots/bumps *Some*, Texture and Oiliness *Low*. Caption changes to the card's own headline and finish, e.g. **"Your photo showed noticeable redness. → Consider a #1 guard instead of a foil or razor finish today."** The card scrolls to Aftercare and the disclaimer: **"Plain aftercare, no brands, and a clear line: this is not a medical assessment."** | (0:24) "First, the skin check. This is YouCam AI Skin Analysis, looking at four things a barber cares about: redness, bumps, texture and oiliness." (0:34) *"Here it found noticeable redness. So instead of a foil or razor finish, it suggests a number one guard today, and a beard trim rather than a clean shave."* (0:44) "Then two or three plain aftercare tips. No brands, nothing to buy, and it says clearly: this is not a medical assessment." |
| 0:52–1:10 | Back to the photo. Caption **AI Hairstyle Generator v2.1: "Tapered Fade: a real Skin Fade service, £28, 45 min."** The look loads; the before/after slider sweeps left, right and back. | "Now the cut. Tapered Fade is a real service on the price list. YouCam's Hairstyle Generator, version two point one, puts it on the customer's own face, and they can drag between before and after." |
| 1:10–1:23 | Caption **AI Beard Style Generator: "Anchor Beard: Beard Trim & Shape, £14, 20 min."** The beard result. | "Beards use YouCam's Beard Style Generator. Here's the Anchor Beard, the shop's twenty-minute trim and shape." |
| 1:23–1:41 | Caption **AI Hairstyle Generator v2.1 → AI Beard Style Generator: "Cut + Beard: the hairstyle result is fed straight into the beard task."** The combined look; the slider sweeps again. | "And Cut plus Beard chains both: the hairstyle result goes straight into the beard task, so the picture matches the full service the barber will actually do." |
| 1:41–1:53 | **"Compare: side by side, or everything tried. Going back to a look is free."** Side by side tab, then the All tried grid. | "Side by side, or every look tried so far. Going back to one costs nothing: results are cached on the phone." |
| 1:53–2:07 | Booking screen: the skin note under the look, soonest free times, a day's times grid, name and mobile, then the consent box is ticked. **"Book this look. Times come live from the shop's booking server (MCP)."** then **"The same consent box shares the look and a one-line skin note with Marcus. Never the selfie or the scores."** | "Booking uses the shop's real diary through an MCP server, so these times are genuinely free. One consent box sends the look and a one-line skin note to the barber. Never the selfie, never the scores." |
| 2:07–2:14 | Confirmation screen. **"Booked. The confirmation carries the look and the suggested finish."** | "Booked. The confirmation shows the look and the suggested finish." |
| 2:14–2:23 | Marcus's Incoming looks page (staff token entered). The card shows the look image and the skin note. Caption quotes the note, e.g. **"Skin check: noticeable redness, some spots or bumps. Suggested #1 guard, no razor."** | *"And this is the barber's view. Before the customer sits down, he knows: noticeable redness, number one guard, no razor."* |
| 2:23–2:27 | End card: "YouCam AI Skin Analysis · AI Hairstyle Generator v2.1 · AI Beard Style Generator · Selfie never stored. YouCam tasks deleted after each result." | "Three YouCam APIs, one selfie, and nothing stored. Fade and Co. Try-On." |

About 330 words of voice-over for 147 seconds, a comfortable pace.

## If something goes wrong on a live run

- **"Face too small" on the skin check.** The script retries automatically with `docs/samples/flux-closeup.jpg`. If you narrate it: "Skin analysis needs the face to fill most of the photo, so it asks for a close-up just for this step. Failed checks cost nothing."
- **"Hair too short" or "head turned" on a look.** The script stops. Re-run it: results already made are free, since they're cached per photo.
- **Out of tries for the day.** Screenshots (5 looks) plus the video (3 looks) use exactly the default `TRY_LIMIT` of 8 for one visitor. Raise `TRY_LIMIT` in `wrangler.toml` for the recording day, or record from another network.
