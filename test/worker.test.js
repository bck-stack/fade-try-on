import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, resetCaches } from '../src/worker.js';
import { YouCamClient, YouCamError, MockYouCam } from '../src/youcam.js';
import { customerApp, adminApp } from '../src/client.js';
import { MockBookingClient } from '../src/booking.js';
import { SERVICES } from '../src/looks.js';
import { FakeKV, fakeYouCam, jpegDataUrl } from './helpers.js';

beforeEach(() => resetCaches());

const booking = new MockBookingClient({ today: '2026-09-25', services: SERVICES });
const selfie = jpegDataUrl(768, 1024);

function env(extra = {}) {
  return { YOUCAM_MOCK: '1', ADMIN_TOKEN: 'marcus-secret', LOOKS: new FakeKV(), ...extra };
}

async function call(e, deps, method, path, body, { headers = {}, ctx = {} } = {}) {
  const init = { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers } };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await handleRequest(new Request('https://tryon.test' + path, init), e, ctx, { booking, ...deps });
  const type = res.headers.get('content-type') || '';
  return { res, data: type.includes('json') ? await res.json() : await res.text() };
}

const fastMock = { youcam: new MockYouCam({ sleep: async () => {} }) };

test('customer page: mobile viewport, privacy line, CSP nonce matches the script', async () => {
  const { res, data } = await call(env(), {}, 'GET', '/');
  assert.equal(res.status, 200);
  assert.match(data, /<meta name="viewport"/);
  assert.match(data, /processed in memory, then deleted\. We never store it\./);
  const nonce = /<script nonce="([a-f0-9]+)">/.exec(data)[1];
  assert.match(res.headers.get('content-security-policy'), new RegExp(`script-src 'nonce-${nonce}'`));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('embedded browser code is valid, self-contained JavaScript', () => {
  for (const fn of [customerApp, adminApp]) {
    assert.doesNotThrow(() => new Function(`var __name = (f) => f; (${fn.toString()})`));
  }
});

test('MOCK try-on returns the sample image for the look as a data URL', async () => {
  const { res, data } = await call(env(), fastMock, 'POST', '/api/try-on', { lookId: 'short-boxed-beard', image: selfie });
  assert.equal(res.status, 200);
  assert.equal(data.lookId, 'short-boxed-beard');
  assert.match(data.image, /^data:image\/jpeg;base64,\/9j\//);
  assert.equal(data.mock, true);
  assert.equal(data.triesLeft, 7);
});

test('try-on validates look and image', async () => {
  assert.equal((await call(env(), fastMock, 'POST', '/api/try-on', { lookId: 'mullet', image: selfie })).res.status, 400);
  assert.equal((await call(env(), fastMock, 'POST', '/api/try-on', { lookId: 'high-skin-fade', image: 'data:text/plain;base64,aGk=' })).res.status, 400);
  assert.equal((await call(env(), fastMock, 'POST', '/api/try-on', 'not json')).res.status, 400);
  const huge = 'data:image/jpeg;base64,' + 'A'.repeat(4 * 1024 * 1024);
  assert.equal((await call(env(), fastMock, 'POST', '/api/try-on', { lookId: 'high-skin-fade', image: huge })).res.status, 413);
});

test('tries are capped per visitor per day; other visitors are unaffected', async () => {
  const e = env({ TRY_LIMIT: '2' });
  for (const left of [1, 0]) {
    const { data } = await call(e, fastMock, 'POST', '/api/try-on', { lookId: 'high-skin-fade', image: selfie });
    assert.equal(data.triesLeft, left);
  }
  const blocked = await call(e, fastMock, 'POST', '/api/try-on', { lookId: 'crop-mid-fade', image: selfie });
  assert.equal(blocked.res.status, 429);
  assert.equal(blocked.data.triesLeft, 0);
  const other = await call(e, fastMock, 'POST', '/api/try-on', { lookId: 'crop-mid-fade', image: selfie }, { headers: { 'cf-connecting-ip': '198.51.100.2' } });
  assert.equal(other.res.status, 200);
  const cfg = await call(e, {}, 'GET', '/api/config');
  assert.equal(cfg.data.triesLeft, 0);
  assert.equal(cfg.data.tryLimit, 2);
  // Stored counters use a hash, never the raw IP.
  assert.ok([...e.LOOKS.data.keys()].every((k) => !k.includes('203.0.113.7')));
});

test('failed try-ons do not use up a try', async () => {
  const e = env({ TRY_LIMIT: '1' });
  const failing = { youcam: { applyLook: async () => { throw new YouCamError('error_no_face'); }, deleteTask: async () => true } };
  const { res, data } = await call(e, failing, 'POST', '/api/try-on', { lookId: 'high-skin-fade', image: selfie });
  assert.equal(res.status, 422);
  assert.equal(data.code, 'error_no_face');
  assert.match(data.error, /couldn't find a face/);
  assert.equal((await call(e, fastMock, 'POST', '/api/try-on', { lookId: 'high-skin-fade', image: selfie })).res.status, 200);
});

test('real mode: full YouCam round trip, then the task (and selfie) is deleted', async () => {
  const fake = fakeYouCam();
  const youcam = new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: async () => {} });
  const waited = [];
  const { res, data } = await call(env({ YOUCAM_MOCK: '0', YOUCAM_API_KEY: 'test-key' }), { youcam }, 'POST', '/api/try-on',
    { lookId: 'fade-and-boxed-beard', image: selfie }, { ctx: { waitUntil: (p) => waited.push(p) } });
  assert.equal(res.status, 200);
  assert.match(data.image, /^data:image\/jpeg;base64,/);
  await Promise.all(waited);
  const deletes = fake.calls.filter((c) => c.path === '/s2s/v2.0/task/delete').map((c) => c.body.task_id);
  assert.deepEqual(deletes, ['TASK-1', 'TASK-2']);
});

test('real mode: tasks are deleted even when a later step fails', async () => {
  const fake = fakeYouCam({ taskResult: (id) => (id === 'TASK-2' ? { task_status: 'error', error: 'error_face_pose' } : { task_status: 'success', results: { url: 'https://results.example/out/1.jpg' } }) });
  const youcam = new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: async () => {} });
  const waited = [];
  const { res } = await call(env({ YOUCAM_MOCK: '0', YOUCAM_API_KEY: 'test-key' }), { youcam }, 'POST', '/api/try-on',
    { lookId: 'fade-and-boxed-beard', image: selfie }, { ctx: { waitUntil: (p) => waited.push(p) } });
  assert.equal(res.status, 422);
  await Promise.all(waited);
  assert.deepEqual(fake.calls.filter((c) => c.path === '/s2s/v2.0/task/delete').map((c) => c.body.task_id), ['TASK-1', 'TASK-2']);
});

test('real mode: only JPEG up to 1024px is sent on to YouCam', async () => {
  const e = env({ YOUCAM_MOCK: '0', YOUCAM_API_KEY: 'test-key' });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.equal((await call(e, {}, 'POST', '/api/try-on', { lookId: 'high-skin-fade', image: png })).res.status, 400);
  assert.equal((await call(e, {}, 'POST', '/api/try-on', { lookId: 'high-skin-fade', image: jpegDataUrl(1200, 1600) })).res.status, 400);
});

test('real mode without an API key: clear 503, booking still possible', async () => {
  const { res, data } = await call(env({ YOUCAM_MOCK: '0' }), {}, 'POST', '/api/try-on', { lookId: 'high-skin-fade', image: selfie });
  assert.equal(res.status, 503);
  assert.match(data.error, /still book/);
});

test('demo selfie only exists in MOCK mode', async () => {
  assert.equal((await call(env(), {}, 'GET', '/demo-selfie.jpg')).res.status, 200);
  assert.equal((await call(env({ YOUCAM_MOCK: '0' }), {}, 'GET', '/demo-selfie.jpg')).res.status, 404);
});

test('admin API needs the token', async () => {
  assert.equal((await call(env({ ADMIN_TOKEN: undefined }), {}, 'GET', '/api/admin/looks')).res.status, 503);
  assert.equal((await call(env(), {}, 'GET', '/api/admin/looks')).res.status, 401);
  assert.equal((await call(env(), {}, 'GET', '/api/admin/looks', undefined, { headers: { authorization: 'Bearer nope' } })).res.status, 401);
  const ok = await call(env(), {}, 'GET', '/api/admin/status', undefined, { headers: { authorization: 'Bearer marcus-secret' } });
  assert.deepEqual(ok.data, { mock: true, bookingMock: false, storage: true, units: null });
  const page = await call(env(), {}, 'GET', '/admin');
  assert.match(page.data, /Incoming looks/);
});

test('admin cannot read or delete keys outside look:', async () => {
  const e = env();
  await e.LOOKS.put('quota:abc:2026-09-25', '3');
  const auth = { headers: { authorization: 'Bearer marcus-secret' } };
  await call(e, {}, 'DELETE', '/api/admin/looks/' + encodeURIComponent('quota:abc:2026-09-25'), undefined, auth);
  assert.equal(e.LOOKS.data.has('quota:abc:2026-09-25'), true);
  assert.equal((await call(e, {}, 'GET', '/api/admin/looks/' + encodeURIComponent('quota:abc:2026-09-25') + '/image', undefined, auth)).res.status, 404);
});

test('unknown routes 404', async () => {
  assert.equal((await call(env(), {}, 'GET', '/api/nope')).res.status, 404);
  assert.equal((await call(env(), {}, 'GET', '/wp-admin')).res.status, 404);
});
