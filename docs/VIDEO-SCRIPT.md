# Demo video script: Fade & Co. Try-On

Target length: 2:45. Portrait phone recording for the customer side (screen capture or a phone on a stand), with cutaways to a laptop for the code and the admin view.

**Before recording**

- Deploy with `YOUCAM_MOCK=0` and a real key so the results are real. Keep a MOCK build ready as a fallback.
- Use the presenter's own face, or a volunteer who has agreed to be in the video. Good light, plain wall.
- Book into a day with free slots. With `BOOKING_MOCK=1` the booking won't go into the real diary; with it off, cancel the test booking afterwards.
- Open `/admin` on a second phone (Marcus's phone), already logged in.
- Before recording, try one look once so there's a cached result to show off instantly.

| Time | On screen | Voice-over |
|---|---|---|
| 0:00–0:12 | Shop exterior at 214 Kingsland Road (or a still photo), then a close-up of a customer holding up a phone photo to the barber. | "This is Fade & Co., a one-chair barbershop in Dalston. Marcus works alone, and most appointments start the same way: 'shorter on the sides… no, not like that.'" |
| 0:12–0:22 | Title card: **Fade & Co. Try-On**. "See the cut on your own face before you book it." | "So we built Try-On. You try the shop's actual services on your own face, then book the one you like." |
| 0:22–0:35 | Phone: start screen. Point at the privacy line, then tap **Take a selfie** and take the photo. | "Take a selfie. It's resized on the phone, used for the try-on, and deleted. We never store it." |
| 0:35–0:55 | Studio screen. Tap **Tapered Fade**. Loading overlay ("Trying Tapered Fade on you…"), then the result. Drag the before/after slider slowly across the face. | "Every look here is a real service with its real price. This one's a Skin Fade: forty-five minutes, twenty-eight pounds. The YouCam hairstyle API puts it on my face, and I can drag between before and after." |
| 0:55–1:15 | Tap **Anchor Beard**, show the result. Then **Tapered Fade + Anchor Beard**. Pause on the result. | "Beards use YouCam's beard style API. And Cut + Beard is both: we run the hairstyle, then feed that result straight into the beard model, so the picture matches the service Marcus will actually do." |
| 1:15–1:30 | Tap **Side by side**, then **All tried**. Tap back to a look already tried: it appears instantly. Tries-left pill visible in the header. | "Side by side, or everything I've tried in one grid. Going back to a look is instant and free. Results are cached, and each visitor gets a few free tries a day, so the shop's API units last." |
| 1:30–1:55 | Tap **Book this look · £38 · 60 min**. Soonest-free chips load; tap a day, show the times grid, pick a time. Type name and mobile. Tick the consent box and zoom in on its wording. | "Book this look. These times come live from the shop's booking system, the same MCP server its phone assistant uses, so they're really free. Name, mobile, and if I want, I send this one image to Marcus. Only this image, never the selfie, and it's deleted a week after the appointment." |
| 1:55–2:10 | Tap **Book it**. Confirmation screen: "You're booked in, …", the look image, time, price, confirmation sent to. | "Booked. The confirmation carries the look, so I can show it in the chair too." |
| 2:10–2:25 | Second phone: Marcus's **Incoming looks** page. Tap **Refresh** (it also refreshes every minute): the new card appears with time, name, look and image. Tap **Done, remove**. | "And this is Marcus's side. Before I walk in, he knows it's a skin fade with a boxed beard, and exactly what I mean by 'boxed'." |
| 2:25–2:40 | Laptop: split screen. `src/youcam.js` (upload, task, poll, delete) on one side, `npm test` passing on the other. Brief flash of `docs/API-NOTES.md`. | "Under the hood it's one Cloudflare Worker: YouCam's file upload, hairstyle v2.1 and beard tasks with polling, and a delete call so the selfie leaves YouCam straight away. Booking uses the official MCP SDK. Everything also runs in a mock mode with no key." |
| 2:40–2:45 | Back to the title card with the URL / repo. | "Fade & Co. Try-On. See the cut before the clippers come out." |

**Fallback lines** (if a real try-on errors during recording, keep it in and show the message):

- Hair too short: "Short hair is the hardest case for the model, so we say so, and point you at the beard looks. Failed tries don't count."
- Head turned: "It tells you what to fix: look straight at the camera."

**B-roll ideas:** clippers on the counter, the barber pole, Marcus's hands lining up a beard, a phone propped by the mirror showing the chosen look.
