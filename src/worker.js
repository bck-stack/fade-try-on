// Fade & Co. Try-On: Cloudflare Worker entry point.
//
//   GET  /                         customer app (selfie -> try looks -> book)
//   GET  /admin                    Marcus's "incoming looks" view
//   GET  /api/config               looks, live prices, tries left, mode flags
//   POST /api/try-on               { lookId, image: data URL } -> { image: data URL }
//   GET  /api/availability         ?lookId=&date=  (no date = next available days)
//   POST /api/book                 book through the MCP server, store the chosen look
//   GET  /api/admin/looks          (Bearer ADMIN_TOKEN) list stored looks
//   GET  /api/admin/looks/:id/image
//   DELETE /api/admin/looks/:id
//   GET  /api/admin/status         units left, mode flags
//   GET  /demo-selfie.jpg          illustrated demo face (MOCK mode only)

import { LOOKS, getLook, catalogue, mergeServices, serviceForLook, planSteps, SERVICES } from './looks.js';
import { createYouCam, YouCamError } from './youcam.js';
import { BookingClient, MockBookingClient, BookingError, BOOKING_MCP_URL, DATE_RE, TIME_RE, PHONE_RE } from './booking.js';
import { LookStore, TryQuota, visitorId } from './store.js';
import { MOCK_IMAGES } from './mock-images.js';
import { customerPage, adminPage } from './page.js';
import { json, errorJson, readJson, parseDataUrl, toDataUrl, jpegSize, timingSafeEqual, base64ToBytes } from './util.js';

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // JSON body with a base64 image
const MAX_LONG_SIDE = 1000; // hairstyle: long side <= 1024; beard: long side < 1024
const DEFAULT_TRY_LIMIT = 8;
// Whole-site cap per UTC day, so a run of visitors (or one visitor rotating IPs) can't drain the unit balance.
const DEFAULT_DAILY_TRY_LIMIT = 40;
const SERVICES_TTL_MS = 5 * 60 * 1000;

// Per-isolate caches. Nothing here holds customer images.
const templateCache = new Map();
let servicesCache = null; // { at, business, services }
let mockBooking = null;

export function isMock(env) {
  return env.YOUCAM_MOCK === '1' || env.YOUCAM_MOCK === 'true';
}

function bookingMock(env) {
  return env.BOOKING_MOCK === '1' || env.BOOKING_MOCK === 'true';
}

export function bookingClient(env, deps = {}) {
  if (deps.booking) return deps.booking;
  if (bookingMock(env)) {
    mockBooking ||= new MockBookingClient({ services: SERVICES });
    return mockBooking;
  }
  // A Worker can't fetch another *.workers.dev Worker on the same account over the
  // public URL, so in production the MCP calls go through the BOOKING service binding.
  const bindingFetch = env.BOOKING ? (input, init) => env.BOOKING.fetch(new Request(input, init)) : undefined;
  return new BookingClient({ url: env.BOOKING_MCP_URL || BOOKING_MCP_URL, fetch: deps.mcpFetch || bindingFetch });
}

function dailyTryLimit(env) {
  const n = Number(env.DAILY_TRY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_TRY_LIMIT;
}

function tryLimit(env) {
  const n = Number(env.TRY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TRY_LIMIT;
}

async function businessAndServices(env, deps, now = Date.now()) {
  if (servicesCache && now - servicesCache.at < SERVICES_TTL_MS && !deps.booking) return servicesCache;
  try {
    const info = await bookingClient(env, deps).businessInfo();
    const entry = { at: now, online: true, business: info, services: mergeServices(info.services) };
    if (!deps.booking) servicesCache = entry;
    return entry;
  } catch (err) {
    console.warn(`get_business_info failed: ${err.message}`);
    return { at: now, online: false, business: null, services: mergeServices(null) };
  }
}

export function resetCaches() {
  servicesCache = null;
  mockBooking = null;
  templateCache.clear();
}

function securityHeaders(nonce) {
  return {
    'Content-Security-Policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  };
}

function html(body, nonce) {
  return new Response(body, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...securityHeaders(nonce) },
  });
}

function checkAdmin(request, env) {
  if (!env.ADMIN_TOKEN) return errorJson('Set the ADMIN_TOKEN secret to use the looks view.', 503);
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!timingSafeEqual(token, env.ADMIN_TOKEN)) return errorJson('Wrong token.', 401);
  return null;
}

// ---- handlers ---------------------------------------------------------------

async function handleConfig(request, env, deps) {
  const { online, business, services } = await businessAndServices(env, deps);
  const quota = new TryQuota(env.LOOKS, tryLimit(env));
  const visitor = await visitorId(request, env.VISITOR_SALT);
  return json({
    mock: isMock(env),
    bookingMock: bookingMock(env),
    bookingOnline: online,
    business: business
      ? { name: business.name, address: business.address, owner: business.owner, today: business.today, hours: business.hours, depositRule: business.deposit_rule }
      : { name: 'Fade & Co.', address: '214 Kingsland Road, Dalston, London', owner: 'Marcus', today: new Date().toISOString().slice(0, 10) },
    looks: catalogue(services),
    tryLimit: quota.limit,
    triesLeft: await quota.left(visitor),
    sharing: Boolean(env.LOOKS),
  });
}

async function handleTryOn(request, env, deps, ctx) {
  let body;
  try {
    body = await readJson(request, MAX_UPLOAD_BYTES);
  } catch (err) {
    if (err instanceof RangeError) return errorJson('That photo is too big to send. Try another one.', 413);
    return errorJson('Bad request.', 400);
  }

  let look;
  try {
    look = getLook(body.lookId);
  } catch {
    return errorJson('Unknown look.', 400);
  }

  const image = parseDataUrl(body.image);
  if (!image) return errorJson('Please send a JPEG photo.', 400);
  if (!isMock(env)) {
    // YouCam's hairstyle feature takes JPEG only; beard wants the long side under 1024 (the page resizes for you).
    const size = jpegSize(image.bytes);
    if (image.contentType !== 'image/jpeg' || !size) return errorJson('Please send a JPEG photo.', 400);
    if (Math.max(size.width, size.height) > MAX_LONG_SIDE) return errorJson('Photo is too large; the page should resize it to 1000px.', 400);
  }

  const quota = new TryQuota(env.LOOKS, tryLimit(env));
  const visitor = await visitorId(request, env.VISITOR_SALT);
  if ((await quota.left(visitor)) <= 0) {
    return errorJson(
      `That's your ${quota.limit} free try-ons for today. Book your favourite, or ask Marcus in the chair.`,
      429,
      { triesLeft: 0 },
    );
  }

  const siteQuota = new TryQuota(env.LOOKS, dailyTryLimit(env));
  if ((await siteQuota.left('site')) <= 0) {
    return errorJson("Try-on has hit today's limit. You can still book, and Marcus will talk looks through in the chair.", 429, { triesLeft: 0 });
  }

  let youcam;
  try {
    youcam = deps.youcam || createYouCam(env, { templateCache });
  } catch {
    return errorJson("Try-on isn't set up right now. You can still book.", 503);
  }

  const cleanup = (ids) => {
    if (!ids?.length) return;
    const work = Promise.all(ids.map((id) => youcam.deleteTask(id)));
    if (ctx?.waitUntil) ctx.waitUntil(work);
  };

  try {
    const result = await youcam.applyLook({ lookId: look.id, steps: planSteps(look, env) }, image);
    // The selfie and result are deleted from YouCam once we have the bytes.
    cleanup(result.taskIds);
    const triesLeft = await quota.spend(visitor);
    await siteQuota.spend('site');
    return json({ lookId: look.id, image: toDataUrl(result.bytes, result.contentType), triesLeft, mock: isMock(env) });
  } catch (err) {
    cleanup(err.taskIds);
    if (err instanceof YouCamError) {
      console.warn(`try-on ${look.id} failed: ${err.message}`);
      return errorJson(err.userMessage, err.httpStatus, { code: err.code });
    }
    console.error(`try-on ${look.id} crashed`, err);
    return errorJson('Something went wrong with the try-on. Please try again.', 500);
  }
}

async function handleAvailability(request, env, deps) {
  const url = new URL(request.url);
  let look;
  try {
    look = getLook(url.searchParams.get('lookId'));
  } catch {
    return errorJson('Unknown look.', 400);
  }
  const { services } = await businessAndServices(env, deps);
  const service = serviceForLook(look, services);
  const date = url.searchParams.get('date');
  try {
    if (date) {
      if (!DATE_RE.test(date)) return errorJson('Date must be YYYY-MM-DD.', 400);
      return json(await bookingClient(env, deps).findTimes(service.name, date));
    }
    return json({ service: service.name, items: await bookingClient(env, deps).nextAvailable(service.name) });
  } catch (err) {
    return errorJson(err.unavailable ? "Can't reach the diary right now. Please try again." : err.message, err.unavailable ? 503 : 400);
  }
}

async function handleBook(request, env, deps) {
  let body;
  try {
    body = await readJson(request, MAX_UPLOAD_BYTES);
  } catch (err) {
    return err instanceof RangeError ? errorJson('Request too large.', 413) : errorJson('Bad request.', 400);
  }
  let look;
  try {
    look = getLook(body.lookId);
  } catch {
    return errorJson('Unknown look.', 400);
  }
  const customer = String(body.customer || '').trim();
  const phone = String(body.phone || '').trim();
  if (!DATE_RE.test(body.date || '') || !TIME_RE.test(body.time || '')) return errorJson('Pick a day and a time.', 400);
  if (customer.length < 2 || customer.length > 80) return errorJson('Please add your name.', 400);
  if (!PHONE_RE.test(phone)) return errorJson('Please add a mobile number we can text.', 400);

  let image = null;
  if (body.consent === true && body.image) {
    image = parseDataUrl(body.image);
    if (!image) return errorJson('The look image could not be read.', 400);
  }

  const { services } = await businessAndServices(env, deps);
  const service = serviceForLook(look, services);

  let booking;
  try {
    booking = await bookingClient(env, deps).book({ service: service.name, date: body.date, time: body.time, customer, phone });
  } catch (err) {
    if (err instanceof BookingError) {
      return errorJson(err.unavailable ? "Can't reach the diary right now. Nothing was booked; please try again." : err.message, err.unavailable ? 503 : 409);
    }
    throw err;
  }

  const store = new LookStore(env.LOOKS);
  let stored = false;
  try {
    stored = Boolean(await store.save({ booking, look, customer, image }));
  } catch (err) {
    // The appointment is booked either way; losing the preview must not look like a failed booking.
    console.error('saving look failed', err);
  }

  return json({
    booking,
    look: { id: look.id, name: look.name, service: service.name, price: service.price, minutes: service.minutes },
    shared: stored && Boolean(image),
    stored,
  });
}

async function handleAdmin(request, env, deps, path) {
  const denied = checkAdmin(request, env);
  if (denied) return denied;
  const store = new LookStore(env.LOOKS);

  if (path === '/api/admin/status') {
    let units = null;
    if (!isMock(env) && env.YOUCAM_API_KEY) {
      try {
        units = await (deps.youcam || createYouCam(env)).getUnits();
      } catch {
        units = null;
      }
    }
    return json({ mock: isMock(env), bookingMock: bookingMock(env), storage: store.enabled, units });
  }

  // Template catalogue (listing costs no units), for pinning LOOK_TEMPLATES.
  if (path === '/api/admin/templates') {
    if (isMock(env)) return errorJson('Templates are only listed in real mode.', 409);
    const youcam = deps.youcam || createYouCam(env);
    const out = {};
    for (const feature of ['hair', 'beard']) {
      out[feature] = (await youcam.listTemplates(feature, { maxPages: 20 })).map((t) => ({
        id: t.id, title: t.title, category: t.category_name, keepUsersColor: t.keep_users_color,
      }));
    }
    return json(out);
  }
  if (path === '/api/admin/looks' && request.method === 'GET') {
    return json({ looks: await store.list() });
  }
  const m = /^\/api\/admin\/looks\/([^/]+)(\/image)?$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (m[2] && request.method === 'GET') {
      const img = await store.getImage(id);
      if (!img) return errorJson('No image for this look.', 404);
      return new Response(img.bytes, { headers: { 'Content-Type': img.contentType, 'Cache-Control': 'no-store' } });
    }
    if (!m[2] && request.method === 'DELETE') {
      await store.remove(id);
      return json({ deleted: id });
    }
  }
  return errorJson('Not found.', 404);
}

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#141414"/><path d="M18 12h28v8H28v8h14v8H28v16H18z" fill="#f4efe6"/><path d="M40 40l10 10" stroke="#b8322a" stroke-width="6" stroke-linecap="round"/></svg>`;

export async function handleRequest(request, env = {}, ctx = {}, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  try {
    if (method === 'GET' && (path === '/' || path === '/index.html')) {
      const nonce = crypto.randomUUID().replace(/-/g, '');
      return html(customerPage({ nonce, mock: isMock(env) }), nonce);
    }
    if (method === 'GET' && path === '/admin') {
      const nonce = crypto.randomUUID().replace(/-/g, '');
      return html(adminPage({ nonce }), nonce);
    }
    if (method === 'GET' && path === '/favicon.svg') {
      return new Response(FAVICON, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
    }
    if (method === 'GET' && path === '/demo-selfie.jpg') {
      if (!isMock(env)) return new Response('Not found', { status: 404 });
      return new Response(base64ToBytes(MOCK_IMAGES['demo-selfie']), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' } });
    }
    if (method === 'GET' && path === '/api/config') return await handleConfig(request, env, deps);
    if (method === 'POST' && path === '/api/try-on') return await handleTryOn(request, env, deps, ctx);
    if (method === 'GET' && path === '/api/availability') return await handleAvailability(request, env, deps);
    if (method === 'POST' && path === '/api/book') return await handleBook(request, env, deps);
    if (path.startsWith('/api/admin/')) return await handleAdmin(request, env, deps, path);
    if (path.startsWith('/api/')) return errorJson('Not found.', 404);
    return new Response('Not found', { status: 404 });
  } catch (err) {
    console.error('unhandled', err);
    return errorJson('Something went wrong. Please try again.', 500);
  }
}

export default {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
};

export { LOOKS };
