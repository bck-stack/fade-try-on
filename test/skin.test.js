import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { YouCamClient, YouCamError, MockYouCam, MOCK_SKIN_RESULTS } from '../src/youcam.js';
import { SKIN_ACTIONS, SKIN_UNITS, THRESHOLDS, DISCLAIMER, levelFor, readScores, assess, summarise } from '../src/skin.js';
import { handleRequest, resetCaches } from '../src/worker.js';
import { MockBookingClient } from '../src/booking.js';
import { SERVICES } from '../src/looks.js';
import { FakeKV, fakeYouCam, tinyJpeg, jpegDataUrl } from './helpers.js';

beforeEach(() => resetCaches());

const noSleep = async () => {};
const selfie = jpegDataUrl(750, 1000);
const booking = new MockBookingClient({ today: '2026-09-25', services: SERVICES });

// A fake YouCam server that also speaks /s2s/v2.1/task/skin-analysis (format=json).
function skinFake({ result = { task_status: 'success', results: MOCK_SKIN_RESULTS }, runStatus = 200 } = {}) {
  const fake = fakeYouCam();
  fake.state.intercept = async (call) => {
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (call.method === 'POST' && call.path === '/s2s/v2.1/task/skin-analysis') {
      if (runStatus !== 200) return reply({ status: runStatus, error: 'nope', error_code: 'InvalidParameters' }, runStatus);
      return reply({ status: 200, data: { task_id: 'SKIN-1' } });
    }
    if (call.method === 'GET' && call.path === '/s2s/v2.1/task/skin-analysis/SKIN-1') {
      fake.state.skinPolls = (fake.state.skinPolls || 0) + 1;
      if (fake.state.skinPolls < 2) return reply({ status: 200, data: { task_status: 'running' } });
      return reply({ status: 200, data: result });
    }
    return null;
  };
  return fake;
}

function env(extra = {}) {
  return { YOUCAM_MOCK: '1', ADMIN_TOKEN: 'marcus-secret', LOOKS: new FakeKV(), BOOKING_MOCK: '1', ...extra };
}

async function call(e, deps, method, path, body, { headers = {}, ctx = {} } = {}) {
  const init = { method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await handleRequest(new Request('https://tryon.test' + path, init), e, ctx, { booking, ...deps });
  return { res, data: await res.json() };
}

const fastMock = { youcam: new MockYouCam({ sleep: noSleep }) };

// ---- request shape -----------------------------------------------------------

test('skin analysis: upload, run with SD dst_actions and format=json, poll, per the docs', async () => {
  const fake = skinFake();
  const yc = new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: noSleep });
  const out = await yc.analyzeSkin({ bytes: tinyJpeg(750, 1000), contentType: 'image/jpeg' });

  assert.equal(fake.calls[0].path, '/s2s/v2.0/file');
  assert.equal(fake.calls[1].method, 'PUT');
  const run = fake.calls.find((c) => c.method === 'POST' && c.path === '/s2s/v2.1/task/skin-analysis');
  assert.equal(run.headers.authorization, 'Bearer test-key');
  assert.deepEqual(run.body, { src_file_id: 'FILE-1', dst_actions: ['redness', 'acne', 'texture', 'oiliness'], format: 'json' });
  // Never mixes HD (hd_*) and SD concerns, which the API rejects.
  assert.ok(run.body.dst_actions.every((a) => !a.startsWith('hd_')));
  assert.equal(fake.calls.filter((c) => c.path === '/s2s/v2.1/task/skin-analysis/SKIN-1').length, 2);
  assert.deepEqual(out.taskIds, ['SKIN-1']);
  assert.deepEqual(out.results, MOCK_SKIN_RESULTS);
});

test('four concerns keeps the skin check in the cheapest unit tier (1-4 concerns = 9 units)', () => {
  assert.equal(SKIN_ACTIONS.length, 4);
  assert.equal(SKIN_UNITS, 9);
});

test('skin errors carry the task id and skin-specific wording', async () => {
  const fake = skinFake({ result: { task_status: 'error', error: 'error_src_face_too_small' } });
  const yc = new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: noSleep });
  await assert.rejects(yc.analyzeSkin({ bytes: tinyJpeg(), contentType: 'image/jpeg' }), (err) => {
    assert.ok(err instanceof YouCamError);
    assert.equal(err.code, 'error_src_face_too_small');
    assert.deepEqual(err.taskIds, ['SKIN-1']);
    assert.match(err.userMessage, /close-up just for the skin check/);
    assert.equal(err.httpStatus, 422);
    return true;
  });
});

// ---- scores -> suggestions -----------------------------------------------------

test('levelFor: thresholds at each boundary (raw_score, higher = healthier)', () => {
  assert.deepEqual(THRESHOLDS, { noticeable: 65, some: 80 });
  assert.equal(levelFor(1), 'noticeable');
  assert.equal(levelFor(64.99), 'noticeable');
  assert.equal(levelFor(65), 'some');
  assert.equal(levelFor(79.99), 'some');
  assert.equal(levelFor(80), 'low');
  assert.equal(levelFor(100), 'low');
  assert.equal(levelFor(undefined), null);
  assert.equal(levelFor(NaN), null);
});

test('readScores reads the format=json rows and the score_info.json shape, ignoring extras', () => {
  assert.deepEqual(readScores(MOCK_SKIN_RESULTS), { redness: 58.4, acne: 72.1, texture: 86.9, oiliness: 84.3 });
  const zipShape = { redness: { raw_score: 72.01, ui_score: 77 }, hd_acne: { whole: { raw_score: 59.9, ui_score: 76 } }, pore: { raw_score: 10 }, all: { score: 75 }, skin_age: 37 };
  assert.deepEqual(readScores(zipShape), { redness: 72.01, acne: 59.9 });
  // Region rows other than "whole" are skipped.
  assert.deepEqual(readScores({ output: [{ type: 'hd_redness', region: 'cheek', raw_score: 5 }, { type: 'hd_redness', region: 'whole', raw_score: 55 }] }), { redness: 55 });
  assert.deepEqual(readScores(null), {});
});

test('noticeable redness -> #1 guard, no razor, beard trim nudge, disclaimer', () => {
  const s = assess({ redness: 'noticeable', acne: 'low', texture: 'low', oiliness: 'low' }, SERVICES);
  assert.equal(s.headline, 'Your photo showed noticeable redness.');
  assert.deepEqual(s.finish, { guard: '#1', razor: false, text: 'Consider a #1 guard instead of a foil or razor finish today.' });
  assert.equal(s.nudges.length, 1);
  assert.match(s.nudges[0], /Beard Trim & Shape \(£14\) is easier on the skin/);
  assert.equal(s.note, 'Skin check: noticeable redness. Suggested #1 guard, no razor.');
  assert.equal(s.disclaimer, DISCLAIMER);
  assert.match(s.disclaimer, /This is not a medical assessment\./);
  assert.ok(s.aftercare.length >= 2 && s.aftercare.length <= 3);
});

test('some bumps -> #0.5, no razor; nothing flagged -> usual finish, no nudges', () => {
  const some = assess({ redness: 'low', acne: 'some' }, SERVICES);
  assert.equal(some.finish.guard, '#0.5');
  assert.equal(some.finish.razor, false);
  assert.match(some.aftercare.join(' '), /Don't pick at bumps/);
  const calm = assess({ redness: 'low', acne: 'low', texture: 'some', oiliness: 'low' }, SERVICES);
  assert.equal(calm.irritation, 'low');
  assert.equal(calm.finish.razor, true);
  assert.deepEqual(calm.nudges, []);
  assert.equal(calm.note, 'Skin check: some uneven texture. Usual finish.');
});

test('a hot towel prep is only suggested when the price list sells one', () => {
  const withTowel = [...SERVICES, { id: 9, name: 'Hot Towel Prep', minutes: 10, price: 6 }];
  assert.ok(assess({ redness: 'noticeable' }, withTowel).nudges.some((n) => /Hot Towel Prep \(£6\)/.test(n)));
  assert.ok(!assess({ redness: 'noticeable' }, SERVICES).nudges.some((n) => /towel/i.test(n)));
});

test('summarise: scores to levels to advice; nothing usable -> null; no brand names', () => {
  const s = summarise(readScores(MOCK_SKIN_RESULTS), SERVICES);
  assert.deepEqual(s.levels, { redness: 'noticeable', acne: 'some', texture: 'low', oiliness: 'low' });
  assert.equal(summarise({}, SERVICES), null);
  assert.equal(assess({ redness: 'bogus' }), null);
  const text = [s.headline, s.finish.text, ...s.nudges, ...s.aftercare].join(' ');
  assert.doesNotMatch(text, /®|™|buy|shop now|treat|cure|diagnos/i);
});

// ---- endpoint: budget, caching, cleanup ------------------------------------------

test('MOCK skin check returns a realistic summary without spending units', async () => {
  const e = env();
  const { res, data } = await call(e, fastMock, 'POST', '/api/skin-check', { image: selfie });
  assert.equal(res.status, 200);
  assert.equal(data.skin.levels.redness, 'noticeable');
  assert.deepEqual(data.scores, { redness: 58, acne: 72, texture: 87, oiliness: 84 });
  assert.equal(data.checksLeft, 1);
  assert.equal(data.mock, true);
  assert.ok(![...e.LOOKS.data.keys()].some((k) => k.startsWith('units:')));
});

test('same photo again is served from the cache: no YouCam call, no check used', async () => {
  const e = env({ YOUCAM_MOCK: '0', YOUCAM_API_KEY: 'test-key' });
  const fake = skinFake();
  const youcam = new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: noSleep });
  const first = await call(e, { youcam }, 'POST', '/api/skin-check', { image: selfie });
  assert.equal(first.data.cached, false);
  const runs = () => fake.calls.filter((c) => c.path === '/s2s/v2.1/task/skin-analysis').length;
  assert.equal(runs(), 1);
  const second = await call(e, { youcam }, 'POST', '/api/skin-check', { image: selfie });
  assert.equal(second.res.status, 200);
  assert.equal(second.data.cached, true);
  assert.equal(second.data.checksLeft, 1);
  assert.equal(second.data.scores, undefined); // raw scores are never stored
  assert.equal(runs(), 1);
  // The cache holds only levels.
  const cached = [...e.LOOKS.data.entries()].find(([k]) => k.startsWith('skin:'));
  assert.deepEqual(JSON.parse(cached[1].value), { redness: 'noticeable', acne: 'some', texture: 'low', oiliness: 'low' });
  assert.ok(cached[1].ttl <= 6 * 3600);
});

test('real mode: task (and selfie) is deleted after success, units counted against the site budget', async () => {
  const e = env({ YOUCAM_MOCK: '0', YOUCAM_API_KEY: 'test-key' });
  const fake = skinFake();
  const youcam = new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: noSleep });
  const waited = [];
  const { res } = await call(e, { youcam }, 'POST', '/api/skin-check', { image: selfie }, { ctx: { waitUntil: (p) => waited.push(p) } });
  assert.equal(res.status, 200);
  await Promise.all(waited);
  assert.deepEqual(fake.calls.filter((c) => c.path === '/s2s/v2.0/task/delete').map((c) => c.body.task_id), ['SKIN-1']);
  const units = [...e.LOOKS.data.entries()].find(([k]) => k.startsWith('units:site:'));
  assert.equal(units[1].value, String(SKIN_UNITS));
});

test('real mode: a failed skin check is deleted and never charged', async () => {
  const e = env({ YOUCAM_MOCK: '0', YOUCAM_API_KEY: 'test-key', SKIN_LIMIT: '1' });
  const fake = skinFake({ result: { task_status: 'error', error: 'error_lighting_dark' } });
  const youcam = new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: noSleep });
  const waited = [];
  const { res, data } = await call(e, { youcam }, 'POST', '/api/skin-check', { image: selfie }, { ctx: { waitUntil: (p) => waited.push(p) } });
  assert.equal(res.status, 422);
  assert.equal(data.code, 'error_lighting_dark');
  assert.match(data.error, /too dark/);
  await Promise.all(waited);
  assert.deepEqual(fake.calls.filter((c) => c.path === '/s2s/v2.0/task/delete').map((c) => c.body.task_id), ['SKIN-1']);
  assert.ok(![...e.LOOKS.data.keys()].some((k) => k.startsWith('units:') || k.startsWith('skinq:')));
  // The visitor's one check is still available.
  const cfg = await call(e, {}, 'GET', '/api/config');
  assert.equal(cfg.data.skin.checksLeft, 1);
});

test('a failure before a task exists deletes nothing and charges nothing', async () => {
  const e = env({ YOUCAM_MOCK: '0', YOUCAM_API_KEY: 'test-key' });
  const fake = skinFake({ runStatus: 400 });
  const youcam = new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: noSleep });
  const { res } = await call(e, { youcam }, 'POST', '/api/skin-check', { image: selfie });
  assert.equal(res.status, 502);
  assert.equal(fake.calls.filter((c) => c.path === '/s2s/v2.0/task/delete').length, 0);
  assert.ok(![...e.LOOKS.data.keys()].some((k) => k.startsWith('units:') || k.startsWith('skinq:')));
});

test('per-visitor skin limit and the site unit budget both apply', async () => {
  const e = env({ SKIN_LIMIT: '1' });
  const other = jpegDataUrl(760, 1000);
  assert.equal((await call(e, fastMock, 'POST', '/api/skin-check', { image: selfie })).res.status, 200);
  const blocked = await call(e, fastMock, 'POST', '/api/skin-check', { image: other });
  assert.equal(blocked.res.status, 429);
  assert.equal(blocked.data.checksLeft, 0);

  const tight = env({ YOUCAM_MOCK: '0', YOUCAM_API_KEY: 'test-key', DAILY_UNIT_LIMIT: '8' });
  const fake = skinFake();
  const youcam = new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: noSleep });
  const over = await call(tight, { youcam }, 'POST', '/api/skin-check', { image: selfie });
  assert.equal(over.res.status, 429);
  assert.equal(fake.calls.length, 0);
});

test('units are counted per visitor (real mode), and the visitor cap applies', async () => {
  const e = env({ YOUCAM_MOCK: '0', YOUCAM_API_KEY: 'test-key', VISITOR_UNIT_LIMIT: '10' });
  const fake = skinFake();
  const youcam = new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: noSleep });
  assert.equal((await call(e, { youcam }, 'POST', '/api/skin-check', { image: selfie })).res.status, 200); // 9 units
  const visitorKey = [...e.LOOKS.data.keys()].find((k) => k.startsWith('units:') && !k.startsWith('units:site:'));
  assert.equal(e.LOOKS.data.get(visitorKey).value, String(SKIN_UNITS));
  assert.ok(!visitorKey.includes('203.0.113.9')); // hashed, never the raw IP
  const over = await call(e, { youcam }, 'POST', '/api/try-on', { lookId: 'tapered-fade', image: selfie }); // 9 + 2 > 10
  assert.equal(over.res.status, 429);
  const other = await call(e, { youcam }, 'POST', '/api/try-on', { lookId: 'tapered-fade', image: selfie }, { headers: { 'cf-connecting-ip': '198.51.100.4' } });
  assert.equal(other.res.status, 200);
});

test('a result YouCam billed but we cannot read: site budget counts it, the visitor is not charged', async () => {
  const e = env({ YOUCAM_MOCK: '0', YOUCAM_API_KEY: 'test-key' });
  // The ZIP form (a URL string), which we never ask for.
  const fake = skinFake({ result: { task_status: 'success', results: 'https://results.example/skin.zip' } });
  const youcam = new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: noSleep });
  const waited = [];
  const { res, data } = await call(e, { youcam }, 'POST', '/api/skin-check', { image: selfie }, { ctx: { waitUntil: (p) => waited.push(p) } });
  assert.equal(res.status, 502);
  assert.equal(data.code, 'bad_result');
  await Promise.all(waited);
  assert.deepEqual(fake.calls.filter((c) => c.path === '/s2s/v2.0/task/delete').map((c) => c.body.task_id), ['SKIN-1']);
  assert.equal(e.LOOKS.data.get([...e.LOOKS.data.keys()].find((k) => k.startsWith('units:site:'))).value, String(SKIN_UNITS));
  assert.ok(![...e.LOOKS.data.keys()].some((k) => k.startsWith('skinq:') || (k.startsWith('units:') && !k.startsWith('units:site:'))));
  assert.ok(![...e.LOOKS.data.keys()].some((k) => k.startsWith('skin:')));
});

test('try-ons also spend from the site unit budget', async () => {
  const e = env({ YOUCAM_MOCK: '0', YOUCAM_API_KEY: 'test-key', DAILY_UNIT_LIMIT: '11' });
  const fake = skinFake();
  const youcam = new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: noSleep });
  assert.equal((await call(e, { youcam }, 'POST', '/api/skin-check', { image: selfie })).res.status, 200); // 9 units
  assert.equal((await call(e, { youcam }, 'POST', '/api/try-on', { lookId: 'tapered-fade', image: selfie })).res.status, 200); // +2 = 11
  const over = await call(e, { youcam }, 'POST', '/api/try-on', { lookId: 'anchor-beard', image: selfie });
  assert.equal(over.res.status, 429);
});

test('real mode: skin check needs a short side of at least 480px', async () => {
  const e = env({ YOUCAM_MOCK: '0', YOUCAM_API_KEY: 'test-key' });
  const { res, data } = await call(e, {}, 'POST', '/api/skin-check', { image: jpegDataUrl(1000, 400) });
  assert.equal(res.status, 422);
  assert.equal(data.code, 'error_below_min_image_size');
});

// ---- consent gating ---------------------------------------------------------------

async function book(e, extra) {
  const slot = (await booking.nextAvailable('Skin Fade', '2026-09-26'))[0];
  return call(e, {}, 'POST', '/api/book', {
    lookId: 'tapered-fade', date: slot.date, time: slot.first_times[0], customer: 'Sam Test', phone: '07700 900123', ...extra,
  });
}

test('with consent: only a server-written one-line note reaches Marcus', async () => {
  const e = env();
  const { data } = await book(e, {
    consent: true,
    image: selfie,
    skin: { levels: { redness: 'noticeable', acne: 'some', evil: 'x' }, note: '<script>forged</script>', scores: { redness: 12 } },
  });
  assert.equal(data.skinShared, true);
  const [item] = [...e.LOOKS.data.entries()].filter(([k]) => k.startsWith('look:')).map(([, v]) => v.metadata);
  assert.equal(item.skinNote, 'Skin check: noticeable redness, some spots or bumps. Suggested #1 guard, no razor.');
  // Levels and scores are not stored; neither is anything the page wrote itself.
  assert.equal(item.skinLevels, undefined);
  assert.ok(!JSON.stringify(item).includes('forged'));
  assert.ok(!JSON.stringify(item).includes('scores'));
  assert.ok(new TextEncoder().encode(JSON.stringify(item)).length < 1024); // KV metadata limit
  const admin = await call(e, {}, 'GET', '/api/admin/looks', undefined, { headers: { authorization: 'Bearer marcus-secret' } });
  assert.match(admin.data.looks[0].skinNote, /#1 guard, no razor/);
});

test('without consent: no skin summary is stored, even if the page sends one', async () => {
  const e = env();
  const { data } = await book(e, { consent: false, skin: { levels: { redness: 'noticeable' } } });
  assert.equal(data.skinShared, false);
  const [item] = [...e.LOOKS.data.entries()].filter(([k]) => k.startsWith('look:')).map(([, v]) => v.metadata);
  assert.equal(item.skinNote, undefined);
  assert.equal(item.hasImage, false);
});

test('skin note expires with the look', async () => {
  const e = env();
  await book(e, { consent: true, skin: { levels: { redness: 'some' } } });
  const [entry] = [...e.LOOKS.data.entries()].filter(([k]) => k.startsWith('look:')).map(([, v]) => v);
  assert.ok(entry.metadata.skinNote);
  assert.ok(entry.ttl > 0 && entry.ttl <= 30 * 86400);
});

test('page: photo consent comes before the camera, skin card is on the studio screen', async () => {
  const res = await handleRequest(new Request('https://tryon.test/'), env(), {}, { booking });
  const html = await res.text();
  assert.ok(html.indexOf('id="photoConsent"') < html.indexOf('id="cam"'));
  assert.match(html, /<input id="cam"[^>]*disabled>/);
  assert.match(html, /<input id="pick"[^>]*disabled>/);
  assert.match(html, /id="skinCard"/);
  assert.match(html, /YouCam AI Skin Analysis/);
  assert.match(html, /fictional/);
});
