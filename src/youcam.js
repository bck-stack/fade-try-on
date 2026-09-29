// YouCam API (Perfect Corp) client for the hair and beard try-on features.
//
// Flow per the docs (https://docs.perfectcorp.com/develop/quick_start_guide):
//   1. POST /s2s/v2.0/file              -> file_id + presigned upload request
//   2. PUT  <requests[0].url>           -> upload the selfie bytes
//   3. POST /s2s/v2.1/task/hair-transfer or /s2s/v2.0/task/beard-style -> task_id
//   4. GET  <same path>/{task_id}       -> poll until task_status is success | error
//   5. GET  results.url                 -> result image (URL valid for 2 hours)
//   6. POST /s2s/v2.0/task/delete       -> remove the task, its input selfie and output
// Endpoints, parameters and unit costs are listed in docs/API-NOTES.md.

import { MOCK_IMAGES, MOCK_IMAGE_TYPE } from './mock-images.js';
import { base64ToBytes } from './util.js';

export const YOUCAM_BASE_URL = 'https://yce-api-01.makeupar.com';

export const FEATURES = {
  hair: {
    label: 'hairstyle',
    run: '/s2s/v2.1/task/hair-transfer',
    templates: '/s2s/v2.1/task/template/hair-transfer',
  },
  beard: {
    label: 'beard style',
    run: '/s2s/v2.0/task/beard-style',
    templates: '/s2s/v2.0/task/template/beard-style',
  },
};

const MESSAGES = {
  error_no_face: "We couldn't find a face. Try a straight-on photo in good light.",
  error_face_pose: 'Your head is turned a bit too far. Look straight at the camera and try again.',
  error_large_face_angle: 'Your head is turned a bit too far. Look straight at the camera and try again.',
  error_pose: 'Your head is turned a bit too far. Look straight at the camera and try again.',
  error_hair_too_short:
    'Your hair is too short for the hairstyle preview to work from. Beard looks still work, or use a photo from before your last cut.',
  error_src_face_too_small: 'Your face is too small in the photo. Hold the phone a little closer.',
  error_insufficient_landmarks: 'Your face is too small or hidden in the photo. Hold the phone a little closer.',
  error_face_parsing: 'We could not read the photo clearly. Try brighter light and a plain background.',
  error_no_shoulder: 'Hairstyles need your shoulders in shot. Hold the phone a little further away.',
  error_multiple_people: 'Only one person in the photo, please.',
  error_nsfw_content_detected: "That photo can't be used. Please try another one.",
  exceed_nsfw_retry_limits: "That photo can't be used. Please try another one.",
  error_bald_image: 'The hairstyle preview needs some hair to work from. Beard looks still work.',
  exceed_max_filesize: "That photo is too big. Try another one.",
  error_exceed_max_image_size: "That photo is too big. Try another one.",
  error_below_min_image_size: 'That photo is too small. Try a sharper one.',
  error_unsupport_ratio: "That photo's shape doesn't work. Try a normal portrait photo.",
  error_decode_image: "We couldn't read that photo. Try a JPEG from your camera.",
  error_download_image: "The try-on service couldn't read the photo. Please try again.",
  CreditInsufficiency: "Try-on is out of credit for today. You can still book, and Marcus will talk it through in the chair.",
  InvalidApiKey: "Try-on isn't set up right now. You can still book.",
  InvalidAccessToken: "Try-on isn't set up right now. You can still book.",
  Unauthorized: "Try-on isn't set up right now. You can still book.",
  TooManyRequests: 'Lots of people trying looks right now. Give it a minute and try again.',
  timeout: 'That took too long. Please try again.',
};

// Photo problems the customer can fix vs. problems on our side.
const PHOTO_ERRORS = new Set([
  'error_no_face', 'error_face_pose', 'error_large_face_angle', 'error_pose', 'error_hair_too_short',
  'error_src_face_too_small', 'error_insufficient_landmarks', 'error_face_parsing', 'error_no_shoulder',
  'error_multiple_people', 'error_nsfw_content_detected', 'exceed_nsfw_retry_limits', 'error_bald_image',
  'exceed_max_filesize', 'error_exceed_max_image_size', 'error_below_min_image_size', 'error_unsupport_ratio',
  'error_decode_image',
]);

export class YouCamError extends Error {
  constructor(code, detail, { status } = {}) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'YouCamError';
    this.code = code;
    this.status = status;
  }

  get userMessage() {
    return MESSAGES[this.code] || 'Something went wrong with the try-on. Please try again.';
  }

  // HTTP status our own API should answer with.
  get httpStatus() {
    if (PHOTO_ERRORS.has(this.code)) return 422;
    if (this.code === 'TooManyRequests') return 429;
    if (this.code === 'timeout') return 504;
    if (['CreditInsufficiency', 'InvalidApiKey', 'InvalidAccessToken', 'Unauthorized'].includes(this.code)) return 503;
    return 502;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class YouCamClient {
  constructor({
    apiKey,
    fetch = globalThis.fetch.bind(globalThis),
    baseUrl = YOUCAM_BASE_URL,
    sleep = defaultSleep,
    pollIntervalMs = 3000,
    timeoutMs = 120000,
    now = () => Date.now(),
    templateCache = new Map(),
  } = {}) {
    if (!apiKey) throw new Error('YOUCAM_API_KEY is not set');
    this.apiKey = apiKey;
    this.fetch = fetch;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.sleep = sleep;
    this.pollIntervalMs = pollIntervalMs;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.templateCache = templateCache;
  }

  async request(method, path, body) {
    const res = await this.fetch(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      // Non-JSON error bodies fall through to the status checks below.
    }
    if (!res.ok || (json && typeof json.status === 'number' && json.status !== 200)) {
      const status = res.ok ? json.status : res.status;
      let code = json?.error_code;
      if (!code && status === 401) code = 'InvalidApiKey';
      if (!code && status === 429) code = 'TooManyRequests';
      throw new YouCamError(code || `http_${status}`, json?.error, { status });
    }
    return json;
  }

  // Steps 1 + 2: register the file, then PUT the bytes to the presigned URL.
  async uploadImage(bytes, contentType = 'image/jpeg', fileName = 'selfie.jpg') {
    // The docs' examples use the non-standard "image/jpg"; mirror them exactly.
    const declaredType = contentType === 'image/jpeg' ? 'image/jpg' : contentType;
    const json = await this.request('POST', '/s2s/v2.0/file', {
      files: [{ content_type: declaredType, file_name: fileName, file_size: bytes.byteLength }],
    });
    const file = json?.data?.files?.[0];
    const upload = file?.requests?.[0];
    if (!file?.file_id || !upload?.url) throw new YouCamError('bad_file_response', 'missing file_id or upload url');

    // Content-Length is set by fetch from the body; setting it by hand is refused by some runtimes.
    const headers = {};
    for (const [k, v] of Object.entries(upload.headers || {})) {
      if (k.toLowerCase() !== 'content-length') headers[k] = String(v);
    }
    const put = await this.fetch(upload.url, { method: upload.method || 'PUT', headers, body: bytes });
    if (!put.ok) throw new YouCamError('upload_failed', `upload returned ${put.status}`, { status: put.status });
    return file.file_id;
  }

  async listTemplates(feature, { maxPages = 5 } = {}) {
    const f = FEATURES[feature];
    if (!f) throw new RangeError(`Unknown feature ${feature}`);
    const templates = [];
    let token = null;
    for (let page = 0; page < maxPages; page++) {
      const qs = new URLSearchParams({ page_size: '20' });
      if (token) qs.set('starting_token', token);
      const json = await this.request('GET', `${f.templates}?${qs}`);
      templates.push(...(json?.data?.templates || []));
      token = json?.data?.next_token;
      if (!token) break;
    }
    return templates;
  }

  // Pick the first template whose title or category contains a keyword (keywords in
  // priority order). The template list is cached per client/isolate; it costs no units.
  async resolveTemplate(feature, keywords) {
    const cacheKey = `${feature}:${keywords.join('|')}`;
    if (this.templateCache.has(cacheKey)) return this.templateCache.get(cacheKey);

    let list = this.templateCache.get(`list:${feature}`);
    if (!list) {
      list = await this.listTemplates(feature);
      this.templateCache.set(`list:${feature}`, list);
    }
    if (list.length === 0) throw new YouCamError('no_templates', `no ${feature} templates available`);
    const text = (t) => `${t.title || ''} ${t.category_name || ''}`.toLowerCase();
    let match = null;
    for (const kw of keywords) {
      match = list.find((t) => text(t).includes(kw.toLowerCase()));
      if (match) break;
    }
    const id = (match || list[0]).id;
    this.templateCache.set(cacheKey, id);
    return id;
  }

  // True only for templates we've listed and that declare keep_users_color; pinned ids
  // we haven't seen get the API default.
  keepsUsersColor(templateId) {
    const list = this.templateCache.get('list:hair') || [];
    return list.some((t) => t.id === templateId && t.keep_users_color === true);
  }

  // Step 3.
  async runTask(feature, input) {
    const f = FEATURES[feature];
    if (!f) throw new RangeError(`Unknown feature ${feature}`);
    const json = await this.request('POST', f.run, input);
    const taskId = json?.data?.task_id;
    if (!taskId) throw new YouCamError('bad_task_response', 'missing task_id');
    return taskId;
  }

  // Step 4. Polling is required: the docs warn a task times out (units still spent)
  // if nobody polls it.
  async waitForTask(feature, taskId) {
    const path = `${FEATURES[feature].run}/${encodeURIComponent(taskId)}`;
    const deadline = this.now() + this.timeoutMs;
    let transientFailures = 0;
    while (this.now() < deadline) {
      await this.sleep(this.pollIntervalMs);
      let json;
      try {
        json = await this.request('GET', path);
      } catch (err) {
        const transient = err instanceof YouCamError && (err.status === 429 || err.status >= 500);
        if (transient && ++transientFailures <= 3) continue;
        throw err;
      }
      const data = json?.data || {};
      if (data.task_status === 'success') {
        const url = data.results?.url || data.results?.[0]?.url || data.result?.url;
        if (!url) throw new YouCamError('bad_result', 'success without results.url');
        return url;
      }
      if (data.task_status === 'error') {
        throw new YouCamError(data.error || 'unknown_internal_error', data.error_message);
      }
    }
    throw new YouCamError('timeout', `${feature} task ${taskId} still running`);
  }

  // Step 5.
  async download(url) {
    const res = await this.fetch(url);
    if (!res.ok) throw new YouCamError('download_failed', `result download returned ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, contentType: sniffImageType(bytes) || res.headers.get('content-type') || 'image/jpeg' };
  }

  // Step 6. Best effort: a failed delete never fails the try-on (files expire after 30 days anyway).
  async deleteTask(taskId) {
    try {
      await this.request('POST', '/s2s/v2.0/task/delete', { task_id: taskId });
      return true;
    } catch (err) {
      console.warn(`YouCam task delete failed: ${err.message}`);
      return false;
    }
  }

  // Run every step of a look. The first step reads the uploaded selfie; each later
  // step reads the previous step's result URL (Cut + Beard = hairstyle, then beard).
  // Returns the final image plus the task ids so the caller can delete them afterwards.
  async applyLook({ steps }, { bytes, contentType }) {
    const taskIds = [];
    try {
      const fileId = await this.uploadImage(bytes, contentType);
      let source = { src_file_id: fileId };
      let resultUrl = null;
      for (const step of steps) {
        const input = { ...source };
        if (step.refUrl) input.ref_file_url = step.refUrl;
        else input.template_id = step.templateId || (await this.resolveTemplate(step.feature, step.keywords || []));
        // Keep the customer's own hair colour where the template allows it (v2.1 `hair_color`).
        if (step.feature === 'hair' && input.template_id && (step.keepColor || this.keepsUsersColor(input.template_id))) input.hair_color = 'src';
        const taskId = await this.runTask(step.feature, input);
        taskIds.push(taskId);
        resultUrl = await this.waitForTask(step.feature, taskId);
        source = { src_file_url: resultUrl };
      }
      const image = await this.download(resultUrl);
      return { ...image, taskIds };
    } catch (err) {
      err.taskIds = taskIds;
      throw err;
    }
  }

  // Remaining units (GET /s2s/v1.0/client/credit). Returns null if the call is refused.
  async getUnits() {
    try {
      const json = await this.request('GET', '/s2s/v1.0/client/credit');
      const rows = json?.results || json?.data?.results || [];
      return rows.reduce((sum, r) => sum + Number(r.amount_dec ?? r.amount ?? 0), 0);
    } catch {
      return null;
    }
  }
}

// MOCK mode: same interface, no network, returns the bundled sample for the look.
export class MockYouCam {
  constructor({ sleep = defaultSleep, delayMs = 900 } = {}) {
    this.sleep = sleep;
    this.delayMs = delayMs;
    this.mock = true;
  }

  async applyLook({ lookId }) {
    await this.sleep(this.delayMs);
    const b64 = MOCK_IMAGES[lookId];
    if (!b64) throw new YouCamError('invalid_parameter', `no mock image for ${lookId}`);
    return { bytes: base64ToBytes(b64), contentType: MOCK_IMAGE_TYPE, taskIds: [] };
  }

  async deleteTask() {
    return true;
  }

  async getUnits() {
    return null;
  }
}

export function sniffImageType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export function createYouCam(env, options = {}) {
  if (env.YOUCAM_MOCK === '1' || env.YOUCAM_MOCK === 'true') return new MockYouCam(options);
  return new YouCamClient({ apiKey: env.YOUCAM_API_KEY, ...options });
}
