# Fade & Co. Try-On

**See the cut on your own face before you book it.**

## Inspiration

Fade & Co. is a one-chair barbershop at 214 Kingsland Road in Dalston, London. Marcus runs it on his own. Watching a day in the shop, the slowest part of most appointments isn't the cut. It's the first two minutes: "shorter on the sides… no, not like that", or a customer holding up a phone with a photo of a footballer who has completely different hair.

Barbers work from pictures because words don't carry length, shape or how a fade sits against someone's head. The picture the customer actually needs is of *themselves*. The YouCam API can produce that picture, so we built the smallest useful thing around it: try the shop's real services on your own face, pick one, and book it at a time the chair is free.

## What it does

On their phone, a customer:

1. **Takes or uploads a selfie.** The page resizes it to 1024px and re-encodes it as JPEG before anything leaves the phone, which also strips EXIF and GPS data.
2. **Tries Fade & Co.'s looks.** There are seven looks, and each one is a real service on the price list: High Skin Fade and Crop & Mid Fade (Skin Fade, 45 min, £28), Classic Side Part (Classic Cut, 30 min, £22), Short Boxed Beard and Clean Stubble Line-up (Beard Trim & Shape, 20 min, £14), Skin Fade + Boxed Beard (Cut + Beard, 60 min, £38) and Kids Crew Cut (Kids Cut, 30 min, £16).
3. **Compares them.** There's a before/after slider you drag across your face, a side-by-side view, and an "all tried" grid for picking between looks. Looks you've already tried open instantly and don't cost anything again.
4. **Books the look.** "Book this look · £38 · 60 min" shows the soonest free slots and a 14-day picker, then books through the shop's existing booking system (the Chair Ready Voice MCP server). Prices and durations come live from that server, so the try-on page never disagrees with the diary.
5. **Shares it with Marcus, if they want.** A consent box (off by default) sends the chosen result image to Marcus. He opens a small "Incoming looks" page on his phone and sees who's coming, when, and the look they picked, before they sit down.

The confirmation screen shows the chosen look alongside the booking (time, price, deposit if it's a Saturday, where the confirmation text went), so the customer can show it in the shop even if they didn't share it.

## How we built it

- **One Cloudflare Worker**, plain ES modules, no framework. The pages are inline HTML and CSS. The browser code is written as ordinary functions and serialised into a nonce'd `<script>`, so the Content Security Policy doesn't need `unsafe-inline` for scripts.
- **YouCam API**, following the documented flow: `POST /s2s/v2.0/file` to register the upload, `PUT` the bytes to the presigned URL, start a task, poll it, download the result. Hairstyles use **AI Hairstyle Generator v2.1** (`/s2s/v2.1/task/hair-transfer`); beards use **AI Beard Style Generator** (`/s2s/v2.0/task/beard-style`).
- **Chaining for Cut + Beard.** The combined service is two YouCam tasks in a row. The hairstyle runs on the uploaded selfie, and its result URL goes straight into the beard task as `src_file_url`. One upload, two features, one image that matches the service Marcus will do.
- **Marcus's own cuts as references.** The hairstyle endpoint accepts a reference photo (`ref_file_url`) as well as templates. Set `LOOK_REFS` and each look uses a photo of a cut Marcus has actually done, so a customer tries *his* skin fade rather than a stock one. Without it, the Worker picks a YouCam template by keyword, or uses one pinned in `LOOK_TEMPLATES`.
- **Cleaning up after ourselves.** Once the result is downloaded, the Worker calls `POST /s2s/v2.0/task/delete`, which removes the task along with its input and output files. The selfie is gone from YouCam within seconds rather than the default 30 days.
- **Booking over MCP.** The Worker uses the official `@modelcontextprotocol/sdk` client over Streamable HTTP (protocol 2025-11-25) to call `get_business_info`, `next_available`, `find_available_times` and `book_appointment`. That's the same server the shop's voice assistant uses, so a phone booking and a try-on booking can't collide.
- **Storage.** A Cloudflare KV namespace (`LOOKS`) holds the chosen images (with consent) and the per-visitor try counters. Chosen looks expire a week after the appointment.
- **MOCK mode.** `YOUCAM_MOCK=1` swaps the YouCam client for one that returns bundled sample illustrations (drawn as SVG and rasterised, no real faces), so the app, the tests and the demo all run without a key or units. `BOOKING_MOCK=1` does the same for the diary.
- **Tests** run with `npm test` (node:test, 54 tests, no network). They use a fake YouCam API that follows the documented request and response shapes, and a fake MCP server built from the SDK's own server classes.

## Challenges we ran into

- **Short hair is the hard case.** The hairstyle engine has an `error_hair_too_short` code, and a barbershop's regulars are exactly the people with short hair. We couldn't fix the model, so we made the failure useful: the message tells the customer that beard looks still work, or to use a photo from before their last cut, and the failed attempt doesn't count against their free tries.
- **Input limits differ per feature.** Hairstyles want JPEG with the long side at most 1024px, beards want the face wider than 256px, and both want a straight-on head. We resize on the phone to fit the strictest limit, check the JPEG header on the server, and turn each documented error code into one plain sentence the customer can act on.
- **Polling inside a Worker.** YouCam tasks are asynchronous, and the docs warn that a task nobody polls times out while still using units. The Worker polls every 3 seconds with a deadline, retries brief 429/5xx responses, and still deletes the task when a later step fails.
- **Templates we couldn't see yet.** Template IDs come from a list endpoint, and we built most of this before redeeming units. So looks describe what they want as keywords, the Worker matches them against the template list, and the owner can pin exact IDs later without changing code.
- **Workers aren't Node.** The MCP SDK's default JSON Schema validator compiles code with `new Function`, which Workers forbid. We switched to the SDK's Cloudflare validator. Wrangler's bundler also inserts `__name()` calls into functions, which broke our serialised browser code until we added a one-line shim.
- **Privacy vs. usefulness.** Marcus wants to see the look, but nobody wants their selfie sitting on a barbershop's server. The answer was to store only the generated image, only on an explicit opt-in, with a fixed expiry, and never the phone number.

## Accomplishments that we're proud of

- The whole loop works end to end: selfie, try-on, compare, a real free slot from the real diary, a booking, and Marcus seeing the look. It runs in mock mode on any laptop with `npm run dev`.
- Every look maps to a service with a real price and duration, and the booking goes through the same system as the shop's phone line.
- The selfie is never stored by us, and the YouCam copy is deleted as soon as we have the result.
- It works one-handed on a phone: big targets, a draggable slider, and a sticky "Book this look" button that always shows the price and time.

## What we learned

- The YouCam APIs share one shape (file → task → poll → result) across features, which made chaining two features in one request straightforward.
- Reading the unit table early changed the design. Hairstyle v2.1 and beard each cost 2 units, so a combined look is 4, and caching, per-visitor caps and "failed tries don't count" all came from doing that sum.
- MCP turned out to be a practical way to share one booking backend between very different front ends: a voice agent and a web page.
- Error codes are UX. Most of the work in "what happens when it fails" was writing sentences, not code.

## What's next

- Run the real-API pass with the hackathon units: pin template IDs per look and photograph Marcus's own cuts for `LOOK_REFS`.
- Use the YouCam webhook instead of polling, so the Worker doesn't hold a request open.
- Add AI Hair Color for grey blending, once Marcus decides whether to offer it.
- Put a QR code on the shop window that opens the try-on page with the demo face ready.
- Offer the waitlist (`join_waitlist` on the same MCP server) when a day is full.
- Let Marcus add a note to an incoming look ("bring clippers #1") that shows on the confirmation text.

## Built with

- YouCam API (AI Hairstyle Generator v2.1, AI Beard Style Generator, File API, Task delete, unit info)
- Cloudflare Workers, Workers KV, Wrangler
- Model Context Protocol: `@modelcontextprotocol/sdk` client, Streamable HTTP, protocol 2025-11-25
- JavaScript (ES modules), HTML, CSS
- node:test
