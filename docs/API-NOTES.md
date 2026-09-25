# YouCam API notes

Exactly what Fade & Co. Try-On calls, with which parameters, what it costs, and where each thing is documented. The docs were read on 2026-09-25 from https://docs.perfectcorp.com, using both the rendered pages and the downloadable OpenAPI bundles (`https://docs.perfectcorp.com/_bundle/reference/<name>.yaml?download`). The code is in [`src/youcam.js`](../src/youcam.js).

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

- **TODO (content type):** the docs' examples declare JPEGs as `image/jpg` (not the standard `image/jpeg`). We send `image/jpg` to match the examples exactly.
- Cost: no units.

### 2. Upload the bytes: `PUT <requests[0].url>`

We use the method and headers returned in step 1, but leave out `Content-Length`: `fetch` sets it from the body, and some runtimes refuse a hand-set value. The hairstyle and beard pages both warn that skipping this step gives a 500 or 404 later.

### 3a. Hairstyle: `POST /s2s/v2.1/task/hair-transfer`

Docs: [AI Hairstyle Generator](https://docs.perfectcorp.com/reference/ai_hairstyle) (V2.1 tag)

Body (we send exactly one reference source):

| Field | When |
|---|---|
| `src_file_id` | The uploaded selfie (first step of a look) |
| `template_id` | Default: picked from the template list by keyword, or pinned via `LOOK_TEMPLATES` |
| `ref_file_url` | When `LOOK_REFS` gives a photo of Marcus's own cut for this look (custom mode) |
| `hair_color: "src"` | Only for templates whose listing says `keep_users_color: true`, so the customer keeps their own colour. Per the docs it only applies to those templates. |

Response: `{ "status": 200, "data": { "task_id": "…" } }`

Input limits (from the page's *File Specs & Errors*): JPG/JPEG only, < 10 MB, long side ≤ 1024, face width ≥ 128, pitch within ±10°, yaw ±45°, roll ±15°, one face, full face visible. Feature-specific errors: `error_no_shoulder`, `error_large_face_angle`, `error_insufficient_landmarks`, `error_hair_too_short`, `error_face_pose`.

**Units: 2 per task** (v2.1, preset or custom mode). v2.0 would be 1 for preset / 2 for custom. We use v2.1 because it supports both templates and reference photos with the newer engine.

### 3b. Template list: `GET /s2s/v2.1/task/template/hair-transfer`

Query: `page_size` (1–20, we use 20), `starting_token` (from the previous page's `next_token`). Response: `data.templates[] = { id, thumb, title, category_name, keep_users_color }`, plus `data.next_token`. We read up to 5 pages once per Worker instance and match look keywords against `title` and `category_name`. No units.

- **TODO (template ids):** we haven't seen the live template catalogue yet, so each look carries keywords (e.g. `['skin fade', 'high fade', 'fade', 'buzz']`) and falls back to the first template if nothing matches. Once the key is active, list the templates and pin the right ids with `LOOK_TEMPLATES`, for example:
  ```sh
  curl -s -H "Authorization: Bearer $YOUCAM_API_KEY" \
    "https://yce-api-01.makeupar.com/s2s/v2.1/task/template/hair-transfer?page_size=20" | jq '.data.templates[] | {id,title,category_name}'
  ```

### 4a. Beard: `POST /s2s/v2.0/task/beard-style`

Docs: [AI Beard Style Generator](https://docs.perfectcorp.com/reference/ai_beard_style)

Body: `template_id` plus either `src_file_id` (beard-only looks) or `src_file_url` (the Cut + Beard look, where the source is the hairstyle task's result URL). Response: `{ "status": 200, "data": { "task_id": "…" } }`.

Input limits: JPG/JPEG, < 10 MB, long side < 1024, face width > 256, yaw within ±30°, one face, full face visible. Feature errors: `error_no_face`, `error_src_face_too_small`, `error_inference`, `error_face_pose`.

**Units: 2 per task.**

The page resizes photos to 1000px on the long side, which fits both "≤ 1024" (hair) and "< 1024" (beard). The Worker rejects anything larger in real mode.

### 4b. Beard templates: `GET /s2s/v2.0/task/template/beard-style`

Same paging as the hairstyle list. Response: `data.templates[] = { id, thumb, title, category_name }`.

- **TODO (response shape):** in the bundle, the 200 response for this endpoint points at a schema (`#/components/schemas/TemplateResponse`) rather than a response object. We assume the same `{ status, data: { templates, next_token } }` shape as the hairstyle list.

### 5. Poll: `GET /s2s/v2.1/task/hair-transfer/{task_id}` and `GET /s2s/v2.0/task/beard-style/{task_id}`

Response: `{ "status": 200, "data": { "task_status": "running" | "success" | "error", "error": <engine code or null>, "error_message": "…", "results": { "url": "…" } } }`

- The docs say polling is mandatory: a task nobody polls times out and still uses units. They suggest polling at intervals ("e.g. every 10 seconds"); we use 3 s with a 120 s deadline, which stays well inside the rate limit. Up to 3 transient 429/5xx responses are retried.
- **TODO (results shape):** in the bundle, `TaskStatusResponseV2` has `results: null` with a sibling `$ref` to `{ url }`, so it's ambiguous. The prose examples show `"results": { "url": "…" }`. We read `results.url`, falling back to `results[0].url` or `result.url`.
- Task ids are URL-safe base64 in every example; we still `encodeURIComponent` them.
- No units while `running` (beard page: "no units will be consumed during this stage").
- **TODO (billing on error):** the docs don't say whether a task that ends in `error` is billed. We don't count failed tries against the visitor's cap either way.

### 6. Download: `GET <results.url>`

Presigned URL, valid 2 hours. We fetch it immediately and return the bytes to the phone as a data URL, so nothing depends on the link staying valid.

### 7. Delete: `POST /s2s/v2.0/task/delete`

Docs: [Task Management](https://docs.perfectcorp.com/reference/task_management)

Body: `{ "task_id": "…" }`. This deletes a finished task with all its input files and outputs, which is how the selfie leaves YouCam right after the try-on. We call it for every task in a look after the final image is downloaded, from `ctx.waitUntil` so it doesn't slow the response, and also when a later step fails. Errors such as `OperationInvalid` (task not finished) are logged and ignored. Files expire after 30 days anyway.

For Cut + Beard, the hairstyle task is deleted only after the beard task has finished, because the beard task reads the hairstyle result URL.

### 8. Units left (admin only): `GET /s2s/v1.0/client/credit`

Docs: [Unit System](https://docs.perfectcorp.com/reference/unit_system)

Response: `{ "status": 200, "results": [{ "type": "ApiPaygToken", "amount_dec": 990.5, "expiry": … }] }`. We sum `amount_dec` for Marcus's view.

- **TODO (auth):** this endpoint is documented under `BearerAuthentication` ("access_token obtained from authentication") rather than the API-key scheme used by v2 endpoints. We send the API key; if it's refused, the admin view shows no unit count and nothing else is affected.

## Unit budget

| Look | Tasks | Units |
|---|---|---|
| Any hairstyle look | hair-transfer v2.1 | 2 |
| Any beard look | beard-style | 2 |
| Skin Fade + Boxed Beard | hair-transfer v2.1 → beard-style | 4 |
| Revisiting a tried look | none (browser cache) | 0 |

With the hackathon's 1,000 units that's 250–500 try-ons, depending on how many are Cut + Beard. The per-visitor cap (`TRY_LIMIT`, default 8/day) limits one visitor to at most 32 units a day, and 16 if they stick to single-feature looks.

## Considered, not used (yet)

- **AI Hair Color** (`POST /s2s/v2.0/task/hair-color`, 1 unit, presets like "Ash Gray", or `palettes` + `pattern`): useful for grey blending if Marcus adds it as a service. [Docs](https://docs.perfectcorp.com/reference/ai_hair_color)
- **Webhooks** (Standard Webhooks, HMAC-SHA256 with a `whsec_` secret): would replace polling. It needs a Durable Object or queue to hand the result back to the waiting phone, so we kept polling for now. [Docs](https://docs.perfectcorp.com/develop/webhook)
- **Older hairstyle endpoints** (`/s2s/v2.0/task/hair-style` with templates, `/s2s/v2.0/task/hair-transfer` with a reference photo): the unit table lists v2.0 at 1 unit in preset mode (2 in custom), but they use the older engine. Worth comparing against v2.1 once live.

## MOCK mode

`YOUCAM_MOCK=1` replaces the client with `MockYouCam`, which waits ~0.9 s and returns the bundled illustration for the look from `src/mock-images.js` (generated by `npm run mock-images`). No network calls, no units, and the rest of the app (caching, try cap, booking, sharing with Marcus) behaves the same.
