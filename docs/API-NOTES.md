# YouCam API notes

Exactly what Fade & Co. Try-On calls, with which parameters, what it costs, and where each thing is documented. The docs were read on 2026-09-25 (hair, beard) and 2026-09-29 (skin analysis, categories, hackathon rules) from https://docs.perfectcorp.com, using both the rendered pages and the downloadable OpenAPI bundles (`https://docs.perfectcorp.com/_bundle/reference/<name>.yaml?download`). The code is in [`src/youcam.js`](../src/youcam.js) and [`src/skin.js`](../src/skin.js).

## Which category do our APIs fall under?

The hackathon's one hard rule ([Official Rules](https://youcam-api.devpost.com/rules), "Project Requirements → What to Create"): *"Entrants must create a working application that integrates at least one Perfect Corp. YouCam API from the Skin or Fashion category and demonstrate clear consumer or retail value."* The judging criteria "Technological Implementation" and "Quality of the Idea" repeat "from the Skin or Fashion category".

The YouCam API reference sidebar ([docs.perfectcorp.com/reference](https://docs.perfectcorp.com/reference/ai_skin_analysis)) groups the AI APIs under these headings, in this order: *Utility*, *Skin, Face & Body*, *Beauty*, *Hair & Beard*, *Fashion*, *Jewelry & Watches*, *Image*, *Video*.

| API we use | Docs heading | Counts for the rule? |
|---|---|---|
| AI Hairstyle Generator (v2.1) | Hair & Beard | **No** |
| AI Beard Style Generator | Hair & Beard | **No** |
| **AI Skin Analysis** (v2.1) | Skin, Face & Body | **Yes** (Skin) |

So before this change the project used only *Hair & Beard* APIs and did not meet the rule on its own. The skin check adds **AI Skin Analysis**, which sits under the *Skin, Face & Body* heading.

- **TODO (category naming):** the rules say "Skin or Fashion category", but the docs heading is "Skin, Face & Body", and neither page lists which APIs belong to which category. We read "Skin" as that heading. AI Skin Analysis is the Skin API used in the hackathon's own banner text ("Skin AI"), so we think this reading is safe, but it's an inference.
- **TODO (dates):** on 29 Sep 2026 both the hackathon overview and the rules page show the Submission Period as **Jul 6 – Aug 17, 2026** (judging to Aug 31, winners ~Sep 4). We could not find the 2 Nov 2026 deadline on either page. Confirm the round and deadline you are entering before submitting.

Items marked **TODO** are places where the docs were unclear or couldn't be checked without a live key. For each one we implemented our best reading, and MOCK mode doesn't depend on it.

## Basics

| Topic | What we use | Docs |
|---|---|---|
| Server | `https://yce-api-01.makeupar.com` | [API Server](https://docs.perfectcorp.com/develop/api_server) |
| Auth | `Authorization: Bearer <YOUCAM_API_KEY>` on every `/s2s/...` call (key from the Worker secret, never in code) | [Quick Start Guide](https://docs.perfectcorp.com/develop/quick_start_guide) |
| Workflow | upload file → run task → poll status → download result | [Quick Start Guide](https://docs.perfectcorp.com/develop/quick_start_guide) |
| Rate limit | 250 requests / 300 s per IP and per key; ~5 QPS recommended. We poll every 3 s, so one try-on is ~5–15 requests. | [Rate Limit](https://docs.perfectcorp.com/develop/rate_limit) |
| Retention | Files and task ids last 30 days; result URLs are valid for 2 hours. We download the result immediately, then delete the task. | [File Retention Period](https://docs.perfectcorp.com/develop/file_retention_period) |
| Errors | Engine error codes such as `error_no_face` and `error_hair_too_short`, mapped to customer messages in `MESSAGES` in `src/youcam.js` | [Error Codes](https://docs.perfectcorp.com/develop/error_codes) |

## Endpoints used

### 1. Register an upload: `POST /s2s/v2.0/file`

Docs: [File Management](https://docs.perfectcorp.com/reference/file)

Request:

```json
{ "files": [{ "content_type": "image/jpg", "file_name": "selfie.jpg", "file_size": 183422 }] }
```

Response (fields we read):

```json
{ "status": 200, "data": { "files": [{ "file_id": "…", "requests": [{ "method": "PUT", "url": "https://…presigned…", "headers": { "Content-Type": "image/jpg", "Content-Length": "183422" } }] }] } }
```

- **Checked live (content type), 25 Sep 2026:** uploads declared as `image/jpg` went through for all seven looks. Original note: the docs' examples declare JPEGs as `image/jpg` (not the standard `image/jpeg`). We send `image/jpg` to match the examples exactly.
- Cost: no units.

### 2. Upload the bytes: `PUT <requests[0].url>`

We use the method and headers returned in step 1, but leave out `Content-Length`: `fetch` sets it from the body, and some runtimes refuse a hand-set value. The hairstyle and beard pages both warn that skipping this step gives a 500 or 404 later.

### 3s. Skin check: `POST /s2s/v2.1/task/skin-analysis`

Docs: [AI Skin Analysis](https://docs.perfectcorp.com/reference/ai_skin_analysis) (V2.1 and V2.0 tags; bundle `ai_skin_analysis.yaml`)

Body (exactly what `analyzeSkin` in `src/youcam.js` sends):

```json
{ "src_file_id": "<file_id from step 1>", "dst_actions": ["redness", "acne", "texture", "oiliness"], "format": "json" }
```

| Field | What we send | Why |
|---|---|---|
| `src_file_id` | The selfie uploaded in steps 1–2 | `src_file_url` is also allowed, but that would need a public URL of the selfie |
| `dst_actions` | 4 **SD** concerns: `redness`, `acne`, `texture`, `oiliness` | The four that change a barber's decision (see below). HD concerns (`hd_*`) need a 1080px short side, and mixing HD and SD gives `400 InvalidParameters` ("cannot mix HD and SD dst_actions") |
| `format` | `json` | Scores come back inline in the status response. The default `zip` would mean downloading and unzipping `score_info.json` inside the Worker |
| `miniserver_args` | not sent | Only controls the mask images, which we don't show or keep |
| `pf_camera_kit` (v2.1 only) | not sent | We don't use YouCam's camera kit |

Response: `{ "status": 200, "data": { "task_id": "…" } }`. Poll `GET /s2s/v2.1/task/skin-analysis/{task_id}` exactly as in step 5.

Result with `format=json` (fields we read; example from the bundle's `format_json_success`):

```json
{ "status": 200, "data": { "task_status": "success", "results": { "output": [
  { "type": "redness", "region": "whole", "raw_score": 34.6, "ui_score": 63, "mask_urls": ["https://…"] },
  { "type": "skin_age", "score": 29 }, { "type": "all", "score": 64.2 }
] } } }
```

- `raw_score` is 1–100 "directly predicted by the AI model"; `ui_score` is 1–100 and, in YouCam's own words, adjusted "to produce more favorable results… a psychological motivator". **Higher means healthier skin for both.** We read `raw_score` because the flattered `ui_score` would hide exactly the irritation we're looking for.
- We keep only `type` + `raw_score` for the four concerns (`readScores` in `src/skin.js`). `mask_urls`, `skin_age` and `all` are dropped. We never download the masks.
- `readScores` also accepts the `score_info.json` shape from the zip format (`{ "redness": { "raw_score": … } }`), in case the JSON format ever changes.
- **TODO (format ignored):** if the API ever answered with the ZIP form (`results` as a URL string) despite `format: "json"`, we don't unzip it: the check returns "didn't work this time" (502), the visitor isn't charged, and the 9 units are still recorded against the site budget because YouCam billed them.

**One photo, one upload per task.** The customer takes one selfie; the page resizes it once, keeps it in memory, and sends the same bytes for the skin check and every look. The Worker registers a fresh YouCam file for each task rather than sharing one `file_id`, because we delete each task as soon as its result is read, and the delete endpoint removes the input file too: *"Delete a finished task identified by task_id, including all associated input files and generated outputs"* ([Task Management](https://docs.perfectcorp.com/reference/task_management), `task_management.yaml`). A shared `file_id` would either keep the selfie on YouCam until the last look is tried, or be gone when the next task needs it. The File API costs no units, so the only cost is one extra small upload per task. Cut + Beard still chains on the hairstyle result URL, as before.

- **Trade-off, not a TODO:** "one YouCam upload for hair, beard and skin" and "delete the task right after reading the result" can't both hold, because the skin check and each look happen at different moments (the customer taps them one by one). A shared `file_id` would have to outlive the first task, so the selfie would stay on YouCam until the last look (or until the 30-day expiry if the customer just leaves). We kept the privacy rule. The phone still uploads the photo to us once; the extra YouCam file registrations cost no units.
- **TODO (file reuse):** the File API page doesn't say whether one `file_id` may be used by several tasks. We don't rely on it.

**Why these four concerns.** The skin check exists to answer one barbershop question: *is a close foil or razor finish a bad idea today?* Redness and acne/bumps are the direct signals (razor irritation, bumps from ingrown hairs). Texture picks up rough, bumpy skin; oiliness only changes the aftercare tip. Pores, wrinkles, eye bags, radiance and the rest don't change anything a barber does, so we don't pay for them. There is no "sensitivity" concern in the API: the closest is `skin_type`, which can say "Redness", but it's a fifth concern and would move the price from 9 to 12 units.

**Input limits** (*File Specs & Errors*): jpg/jpeg/png, < 10 MB; SD needs the **short side ≥ 480 px** (HD ≥ 1080 px); the long side is resized to 2560 automatically. **The face must be wider than 60% of the image width**; forehead visible, even light, front-facing, mouth closed, glasses off recommended. Our page sends a 1000px JPEG, so a portrait photo has an 800px short side. The Worker rejects anything under 480px before calling YouCam.

The 60% face-width rule is the real limitation: a head-and-shoulders selfie that works well for hairstyles (the hairstyle engine *needs* shoulders, `error_no_shoulder`) often has the face at 40–50% of the width. When YouCam answers `error_src_face_too_small`, the card says so plainly and offers **"Take a close-up for the skin check"**. That close-up is used only for the skin check; the try-ons keep the original photo. A failed task costs nothing.

- **TODO (face width in practice):** we could not test how strictly the 60% rule is enforced on real phone selfies without spending units. Our FLUX test face (`docs/samples/flux-selfie.jpg`) has the face at roughly 45% of the width, so we expect the first live call on it to fail with `error_src_face_too_small`. `scripts/screens.mjs` and `scripts/demo-video.mjs` then retry with `docs/samples/flux-closeup.jpg` (face ~75% of the width), which is an upscaled crop of the same AI face.

**Skin-specific error codes** (from *File Specs & Errors*, on top of the shared engine codes like `error_no_face`, `error_pose`, `error_face_parsing`): `error_below_min_image_size`, `error_exceed_max_image_size`, `error_src_face_too_small`, `error_src_face_out_of_bound`, `error_lighting_dark`. Each has its own customer message in `SKIN_MESSAGES` (`src/youcam.js`) and returns HTTP 422 from our API.

**Units** (*Unit Consumption*, V2.0 and V2.1 alike):

| Concerns | SD | HD |
|---|---|---|
| 1–4 | **9** | 12 |
| 5–8 | 12 | 16 |
| 9–12 | 14 | 20 |
| 13–16 | 16 | 22 |

We use 4 SD concerns: **9 units per skin check.**

**Billing on failure — documented here, unlike hair/beard:** the Skin Analysis page says *"Your units will only be consumed in this case [success]. If the engine fails to process the task, the task's status will change to 'error' and no unit will be consumed."* It also says a task stays `running` with no units consumed until the engine finishes.

**Retention:** the page says processed results are kept 24 hours and the task id is valid for 24 hours. We delete the task (`POST /s2s/v2.0/task/delete`, step 7) right after reading the scores, on success and on failure, from `ctx.waitUntil`.

- **TODO (v2.0 vs v2.1):** both versions have the same body and unit table. v2.1 is described as "updated AI engines" with up to 2560px output. We use v2.1. We have not compared their scores on the same photo.
- **TODO (`region` on SD rows):** the JSON example only shows HD concerns, which carry a `region` (`whole`, `forehead`, …). We assume SD rows are either `region: "whole"` or have no `region`, and read both. Rows for other regions are ignored.
- **Thresholds (calibrated 30 Sep 2026 on live results):** our cut-offs (raw_score < 65 = "noticeable", 65–79.99 = "some", ≥ 80 = "low") are **our own, not YouCam's**, and not clinical. Live raw scores cluster high: a clear-skinned AI test face scored 88–99, a face with visible razor redness scored 57–71 on redness, so the first guess (40/60) flagged nothing. YouCam publishes no bands for `raw_score`. They are deliberately cautious: the worst outcome of a false "noticeable" is a slightly longer guard. They should be checked against a handful of real results once units allow. They live in `THRESHOLDS` in `src/skin.js`, and the tests pin every boundary.
- **TODO (Mobile Camera Kit):** the page mentions a JS camera kit that guides the face into frame (and `pf_camera_kit: true` in v2.1). It would probably fix the face-width problem, but it's a separate SDK we haven't evaluated.

### 3a. Hairstyle: `POST /s2s/v2.1/task/hair-transfer`

Docs: [AI Hairstyle Generator](https://docs.perfectcorp.com/reference/ai_hairstyle) (V2.1 tag)

Body (we send exactly one reference source):

| Field | When |
|---|---|
| `src_file_id` | The uploaded selfie (first step of a look) |
| `template_id` | Pinned per look in `src/looks.js` (overridable via `LOOK_TEMPLATES`); keyword match against the template list only as a fallback |
| `ref_file_url` | When `LOOK_REFS` gives a photo of Marcus's own cut for this look (custom mode) |
| `hair_color: "src"` | Only for templates whose listing says `keep_users_color: true`, so the customer keeps their own colour. Per the docs it only applies to those templates. |

Response: `{ "status": 200, "data": { "task_id": "…" } }`

Input limits (from the page's *File Specs & Errors*): JPG/JPEG only, < 10 MB, long side ≤ 1024, face width ≥ 128, pitch within ±10°, yaw ±45°, roll ±15°, one face, full face visible. Feature-specific errors: `error_no_shoulder`, `error_large_face_angle`, `error_insufficient_landmarks`, `error_hair_too_short`, `error_face_pose`.

**Units: 2 per task** (v2.1, preset or custom mode). v2.0 would be 1 for preset / 2 for custom. We use v2.1 because it supports both templates and reference photos with the newer engine.

### 3b. Template list: `GET /s2s/v2.1/task/template/hair-transfer`

Query: `page_size` (1–20, we use 20), `starting_token` (from the previous page's `next_token`). Response: `data.templates[] = { id, thumb, title, category_name, keep_users_color }`, plus `data.next_token`. Pinned looks never call it. The keyword fallback reads up to 5 pages once per Worker instance and matches `title` and `category_name`; the admin listing reads up to 20. No units.

- **Resolved (template ids), 25 Sep 2026:** with the key active, `GET /api/admin/templates` (admin token) lists the live catalogue: 116 hairstyles and 15 beards. Every look now pins its id in `src/looks.js` (`all_messy_tapered_fade`, `male_textured_crop`, `all_side_swept_undercut`, `all_buzz_cut`, `all_anchor`, `all_goatee`). Keyword matching was unsafe ("fade" can hit `all_pink_blue_fade`), and there is no short boxed beard or stubble template, so those looks were renamed to Anchor Beard and Goatee. Each look was run once on an AI-generated face: hairstyles took 10–13 s, beards 5–6 s, Cut + Beard 16 s, and each hairstyle or beard task cost 2 units as documented.

### 4a. Beard: `POST /s2s/v2.0/task/beard-style`

Docs: [AI Beard Style Generator](https://docs.perfectcorp.com/reference/ai_beard_style)

Body: `template_id` plus either `src_file_id` (beard-only looks) or `src_file_url` (the Cut + Beard look, where the source is the hairstyle task's result URL). Response: `{ "status": 200, "data": { "task_id": "…" } }`.

Input limits: JPG/JPEG, < 10 MB, long side < 1024, face width > 256, yaw within ±30°, one face, full face visible. Feature errors: `error_no_face`, `error_src_face_too_small`, `error_inference`, `error_face_pose`.

**Units: 2 per task.**

The page resizes photos to 1000px on the long side, which fits both "≤ 1024" (hair) and "< 1024" (beard). The Worker rejects anything larger in real mode.

### 4b. Beard templates: `GET /s2s/v2.0/task/template/beard-style`

Same paging as the hairstyle list. Response: `data.templates[] = { id, thumb, title, category_name }`.

- **TODO (response shape):** in the bundle, the 200 response for this endpoint points at a schema (`#/components/schemas/TemplateResponse`) rather than a response object. We assume the same `{ status, data: { templates, next_token } }` shape as the hairstyle list.

### 5. Poll: `GET /s2s/v2.1/task/skin-analysis/{task_id}`, `GET /s2s/v2.1/task/hair-transfer/{task_id}` and `GET /s2s/v2.0/task/beard-style/{task_id}`

Response: `{ "status": 200, "data": { "task_status": "running" | "success" | "error", "error": <engine code or null>, "error_message": "…", "results": { "url": "…" } } }`

- The docs say polling is mandatory: a task nobody polls times out and still uses units. They suggest polling at intervals ("e.g. every 10 seconds"); we use 3 s with a 120 s deadline, which stays well inside the rate limit. Up to 3 transient 429/5xx responses are retried.
- **Checked live (results shape), 25 Sep 2026:** the parser below found the result URL on every live task. Original note: in the bundle, `TaskStatusResponseV2` has `results: null` with a sibling `$ref` to `{ url }`, so it's ambiguous. The prose examples show `"results": { "url": "…" }`. We read `results.url`, falling back to `results[0].url` or `result.url`.
- Task ids are URL-safe base64 in every example; we still `encodeURIComponent` them.
- No units while `running` (beard page: "no units will be consumed during this stage").
- **TODO (billing on error, hair/beard):** the hairstyle and beard pages don't say whether a task that ends in `error` is billed (the Skin Analysis page says it isn't; see 3s). We don't count failed tries against any cap either way.

### 6. Download: `GET <results.url>`

Presigned URL, valid 2 hours. We fetch it immediately and return the bytes to the phone as a data URL, so nothing depends on the link staying valid.

### 7. Delete: `POST /s2s/v2.0/task/delete`

Docs: [Task Management](https://docs.perfectcorp.com/reference/task_management)

Body: `{ "task_id": "…" }`. This deletes a finished task with all its input files and outputs, which is how the selfie leaves YouCam right after the skin check or try-on. We call it for every task in a look after the final image is downloaded, from `ctx.waitUntil` so it doesn't slow the response, and also when a later step fails. Errors such as `OperationInvalid` (task not finished) are logged and ignored. Files expire after 30 days anyway.

For Cut + Beard, the hairstyle task is deleted only after the beard task has finished, because the beard task reads the hairstyle result URL.

### 8. Units left (admin only): `GET /s2s/v1.0/client/credit`

Docs: [Unit System](https://docs.perfectcorp.com/reference/unit_system)

Response: `{ "status": 200, "results": [{ "type": "ApiPaygToken", "amount_dec": 990.5, "expiry": … }] }`. We sum `amount_dec` for Marcus's view.

- **Checked live (auth), 25 Sep 2026:** the API key works here: the admin view reported the account's 40 units, then 24 after the test runs. Original note: this endpoint is documented under `BearerAuthentication` ("access_token obtained from authentication") rather than the API-key scheme used by v2 endpoints. We send the API key; if it's refused, the admin view shows no unit count and nothing else is affected.

## Unit budget

| Action | Tasks | Units |
|---|---|---|
| Skin check | skin-analysis v2.1, 4 SD concerns | **9** |
| Skin check on a photo already checked (same bytes) | none: browser cache, or the Worker's 6-hour cache by photo hash | 0 |
| Skin check that fails (`error_*`) | the task ends in `error` | 0 (documented) |
| Any hairstyle look | hair-transfer v2.1 | 2 |
| Any beard look | beard-style | 2 |
| Tapered Fade + Anchor Beard | hair-transfer v2.1 → beard-style | 4 |
| Revisiting a tried look | none (browser cache) | 0 |

**Per visitor.** A typical visit is one skin check and three looks, as in the demo: 9 + 2 (Tapered Fade) + 2 (Anchor Beard) + 4 (Fade + Anchor) = **17 units**. A visit with just the skin check and one cut is 11. The worst case one visitor can reach in a day is `SKIN_LIMIT` × 9 + `TRY_LIMIT` × 4 = 2 × 9 + 8 × 4 = **50 units**, and only if every try is the combined look.

**Whole site.** Two caps, both per UTC day and both counted only on success:

- `DAILY_TRY_LIMIT` (default 40): number of try-ons, as before.
- `DAILY_UNIT_LIMIT` (default 200, new): units spent on skin checks *and* try-ons together. A skin check needs 9 units of headroom and a try-on needs its look's units (2 or 4). The counter (`units:site:<date>` in KV) only moves in real mode.

200 units a day is about 11 typical visitors. With 1,000 units that's about five full days at the cap, or about 58 typical visitors overall. Change the cap in `wrangler.toml`; no code change is needed.

**Never charged for a failure.** Visitor counters (`quota:…`, `skinq:…`) only move after a result has been returned. The site unit counter moves when YouCam reports `success`, because that is when YouCam bills. If we then can't read the scores (no usable rows), the site counter still records the 9 units, but the visitor's check isn't used up.

**Balance.** Earlier live tests reported **40 units, then 24 left** on the account (see step 8). A live pass of `scripts/screens.mjs` needs about 9 + 12 = 21 units (skin check plus five looks), and `scripts/demo-video.mjs` about 8 more (three looks; the skin check on the same photo is a cache hit within 6 hours). Check the balance on `/admin` before a live run.

KV is eventually consistent, so all of these are soft limits against casual overuse, not a hard security boundary (same as before).
## Considered, not used (yet)

- **AI Hair Color** (`POST /s2s/v2.0/task/hair-color`, 1 unit, presets like "Ash Gray", or `palettes` + `pattern`): useful for grey blending if Marcus adds it as a service. [Docs](https://docs.perfectcorp.com/reference/ai_hair_color)
- **Webhooks** (Standard Webhooks, HMAC-SHA256 with a `whsec_` secret): would replace polling. It needs a Durable Object or queue to hand the result back to the waiting phone, so we kept polling for now. [Docs](https://docs.perfectcorp.com/develop/webhook)
- **Older hairstyle endpoints** (`/s2s/v2.0/task/hair-style` with templates, `/s2s/v2.0/task/hair-transfer` with a reference photo): the unit table lists v2.0 at 1 unit in preset mode (2 in custom), but they use the older engine. Worth comparing against v2.1 once live.

## MOCK mode

`YOUCAM_MOCK=1` replaces the client with `MockYouCam`, which waits ~0.9 s and returns the bundled illustration for the look from `src/mock-images.js` (generated by `npm run mock-images`). For the skin check it returns `MOCK_SKIN_RESULTS`: the documented `format=json` shape (`output[]` rows with `type`, `region: "whole"`, `raw_score`, `ui_score`, `mask_urls`, plus `skin_age` and `all` rows) with scores chosen to show the interesting case (redness 34.6 → noticeable, acne 52.2 → some, texture and oiliness low). No network calls, no units, and the rest of the app (caching, caps, booking, sharing with Marcus) behaves the same.
