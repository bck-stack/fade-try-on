import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BookingClient, BookingError, readToolResult, MockBookingClient } from '../src/booking.js';
import { handleRequest, resetCaches } from '../src/worker.js';
import { SERVICES } from '../src/looks.js';
import { fakeBookingServer } from './mcp-fake.js';
import { FakeKV, jpegDataUrl, tinyJpeg } from './helpers.js';

const MCP_URL = 'https://chair-ready.test/mcp';

beforeEach(() => resetCaches());

function clientFor(fake) {
  return new BookingClient({ url: MCP_URL, fetch: fake.fetch });
}

test('SDK client talks MCP 2025-11-25 over Streamable HTTP and reads structured results', async () => {
  const fake = fakeBookingServer();
  const info = await clientFor(fake).businessInfo();
  assert.equal(info.name, 'Fade & Co.');
  assert.equal(info.services.length, 5);
  assert.deepEqual(fake.state.calls[0], { tool: 'get_business_info', args: { business: 'fade-and-co' } });
  assert.ok(fake.state.protocolVersions.has('2025-11-25'));
});

test('find_available_times and next_available', async () => {
  const fake = fakeBookingServer();
  const c = clientFor(fake);
  const day = await c.findTimes('Skin Fade', '2026-09-29');
  assert.deepEqual(day.times, ['10:00', '11:15', '14:00']);
  assert.deepEqual(fake.state.calls.at(-1).args, { business: 'fade-and-co', service: 'Skin Fade', date: '2026-09-29' });
  const next = await c.nextAvailable('Cut + Beard');
  assert.equal(next[0].date, '2026-09-29');
  assert.throws(() => c.findTimes('Skin Fade', '29/09/2026'), BookingError);
});

test('book_appointment sends exactly the documented arguments', async () => {
  const fake = fakeBookingServer();
  const booking = await clientFor(fake).book({ service: 'Cut + Beard', date: '2026-09-29', time: '14:00', customer: 'Sam Okafor', phone: '07700 900123' });
  assert.equal(booking.booking_id, 501);
  assert.equal(booking.ends, '15:00');
  assert.deepEqual(fake.state.calls.at(-1), {
    tool: 'book_appointment',
    args: { business: 'fade-and-co', service: 'Cut + Beard', date: '2026-09-29', time: '14:00', customer: 'Sam Okafor', phone: '07700 900123' },
  });
});

test('tool errors (isError) become BookingError with the server message', async () => {
  const fake = fakeBookingServer();
  await assert.rejects(
    clientFor(fake).book({ service: 'Skin Fade', date: '2026-09-29', time: '11:00', customer: 'Sam', phone: '07700900123' }),
    (err) => err instanceof BookingError && !err.unavailable && /just taken/.test(err.message),
  );
});

test('unreachable server -> BookingError marked unavailable', async () => {
  const c = new BookingClient({ url: MCP_URL, fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(c.businessInfo(), (err) => err instanceof BookingError && err.unavailable);
});

test('readToolResult falls back to parsing the text block', () => {
  assert.deepEqual(readToolResult({ content: [{ type: 'text', text: '{"a":1}' }] }), { a: 1 });
  assert.throws(() => readToolResult({ content: [{ type: 'text', text: 'nope' }], isError: true }), /nope/);
});

// ---- the Worker's booking flow against the mocked MCP server ------------------

function env(extra = {}) {
  return { YOUCAM_MOCK: '1', BOOKING_MCP_URL: MCP_URL, ADMIN_TOKEN: 'marcus-secret', LOOKS: new FakeKV(), ...extra };
}

async function call(e, deps, method, path, body, headers = {}) {
  const init = { method, headers: { 'content-type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await handleRequest(new Request('https://tryon.test' + path, init), e, {}, deps);
  const type = res.headers.get('content-type') || '';
  return { res, data: type.includes('json') ? await res.json() : null };
}

const lookImage = jpegDataUrl(600, 750);

test('config shows live prices from get_business_info', async () => {
  const fake = fakeBookingServer();
  fake.state.services[0].price = 30; // Marcus put the price up
  const { data } = await call(env(), { mcpFetch: fake.fetch }, 'GET', '/api/config');
  assert.equal(data.bookingOnline, true);
  assert.equal(data.business.today, '2026-09-25');
  assert.equal(data.looks.find((l) => l.id === 'tapered-fade').price, 30);
  assert.equal(data.looks.find((l) => l.id === 'buzz-cut').service, 'Classic Cut');
  assert.equal(data.looks.some((l) => /kids/i.test(l.service)), false); // no look asks for a child's photo
});

test('MCP calls go through the BOOKING service binding when one is bound', async () => {
  const fake = fakeBookingServer();
  const seen = [];
  const BOOKING = { fetch: (req) => { seen.push(req); return fake.fetch(req); } };
  const { data } = await call(env({ BOOKING }), {}, 'GET', '/api/config');
  assert.equal(data.bookingOnline, true);
  assert.ok(seen.length > 0 && seen.every((r) => r instanceof Request && r.url.endsWith('/mcp')));
});

test('config falls back to the local price list when the diary is down', async () => {
  const { data } = await call(env(), { mcpFetch: async () => { throw new Error('down'); } }, 'GET', '/api/config');
  assert.equal(data.bookingOnline, false);
  assert.equal(data.looks.find((l) => l.id === 'tapered-fade').price, 28);
});

test('availability: soonest days, and times for a chosen date, for the look\'s service', async () => {
  const fake = fakeBookingServer();
  const deps = { mcpFetch: fake.fetch };
  const soon = await call(env(), deps, 'GET', '/api/availability?lookId=buzz-cut');
  assert.equal(soon.data.service, 'Classic Cut');
  assert.equal(soon.data.items.length, 1);
  const day = await call(env(), deps, 'GET', '/api/availability?lookId=fade-and-anchor&date=2026-09-29');
  assert.equal(day.data.service, 'Cut + Beard');
  assert.deepEqual(day.data.times, ['10:00', '11:15', '14:00']);
  assert.equal((await call(env(), deps, 'GET', '/api/availability?lookId=nope')).res.status, 400);
  assert.equal((await call(env(), deps, 'GET', '/api/availability?lookId=tapered-fade&date=tomorrow')).res.status, 400);
});

test('book with consent: books the look\'s service and stores only the chosen image', async () => {
  // A date in the future, so the one-week expiry check doesn't depend on today's date.
  const date = new Date(Date.now() + 3 * 86400 * 1000).toISOString().slice(0, 10);
  const fake = fakeBookingServer();
  const e = env();
  const { res, data } = await call(e, { mcpFetch: fake.fetch }, 'POST', '/api/book', {
    lookId: 'fade-and-anchor', date, time: '14:00', customer: 'Sam Okafor', phone: '07700 900123', consent: true, image: lookImage,
  });
  assert.equal(res.status, 200);
  assert.equal(data.booking.booking_id, 501);
  assert.equal(data.look.name, 'Tapered Fade + Anchor Beard');
  assert.equal(data.look.service, 'Cut + Beard');
  assert.equal(data.shared, true);
  assert.equal(fake.state.calls.at(-1).args.service, 'Cut + Beard');

  const keys = [...e.LOOKS.data.keys()].filter((k) => k.startsWith('look:'));
  assert.deepEqual(keys, [`look:${date}T14:00:501`]);
  const stored = e.LOOKS.data.get(keys[0]);
  assert.equal(stored.metadata.lookName, 'Tapered Fade + Anchor Beard');
  assert.equal(stored.metadata.hasImage, true);
  assert.equal(stored.metadata.phone, undefined, 'phone number is not stored');
  assert.ok(stored.ttl > 7 * 86400 - 10, 'kept until a week after the appointment');
  assert.deepEqual(new Uint8Array(stored.value), tinyJpeg(600, 750));

  // Marcus sees it in the incoming looks view.
  const auth = { authorization: 'Bearer marcus-secret' };
  const list = await call(e, {}, 'GET', '/api/admin/looks', undefined, auth);
  assert.equal(list.data.looks.length, 1);
  assert.equal(list.data.looks[0].customer, 'Sam Okafor');
  const img = await handleRequest(new Request('https://tryon.test/api/admin/looks/' + encodeURIComponent(keys[0]) + '/image', { headers: auth }), e, {}, {});
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), tinyJpeg(600, 750));

  const del = await call(e, {}, 'DELETE', '/api/admin/looks/' + encodeURIComponent(keys[0]), undefined, auth);
  assert.equal(del.res.status, 200);
  assert.equal(e.LOOKS.data.has(keys[0]), false);
});

test('book without consent: no image stored, even if one is sent', async () => {
  const fake = fakeBookingServer();
  const e = env();
  const { data } = await call(e, { mcpFetch: fake.fetch }, 'POST', '/api/book', {
    lookId: 'tapered-fade', date: '2026-09-29', time: '10:00', customer: 'Jo', phone: '07700900123', consent: false, image: lookImage,
  });
  assert.equal(data.shared, false);
  assert.equal(data.stored, true);
  const [entry] = [...e.LOOKS.data.values()];
  assert.equal(entry.value, '');
  assert.equal(entry.metadata.hasImage, false);
  assert.equal(entry.metadata.lookName, 'Tapered Fade');
});

test('a slot taken in the meantime returns 409 with the server message; nothing stored', async () => {
  const fake = fakeBookingServer();
  const e = env();
  const { res, data } = await call(e, { mcpFetch: fake.fetch }, 'POST', '/api/book', {
    lookId: 'tapered-fade', date: '2026-09-29', time: '11:00', customer: 'Jo Bloggs', phone: '07700900123', consent: true, image: lookImage,
  });
  assert.equal(res.status, 409);
  assert.match(data.error, /just taken/);
  assert.equal(e.LOOKS.data.size, 0);
});

test('booking input is validated before the MCP server is called', async () => {
  const fake = fakeBookingServer();
  const base = { lookId: 'tapered-fade', date: '2026-09-29', time: '10:00', customer: 'Jo Bloggs', phone: '07700900123' };
  for (const bad of [{ date: '29-09-2026' }, { time: '9am' }, { customer: 'J' }, { phone: 'call me' }, { lookId: 'mullet' }, { consent: true, image: 'data:text/html;base64,PGgxPg==' }]) {
    const { res } = await call(env(), { mcpFetch: fake.fetch }, 'POST', '/api/book', { ...base, ...bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  assert.equal(fake.state.calls.filter((c) => c.tool === 'book_appointment').length, 0);
});

test('diary unreachable while booking -> 503, clear message', async () => {
  const { res, data } = await call(env(), { mcpFetch: async () => { throw new Error('down'); } }, 'POST', '/api/book', {
    lookId: 'tapered-fade', date: '2026-09-29', time: '10:00', customer: 'Jo Bloggs', phone: '07700900123',
  });
  assert.equal(res.status, 503);
  assert.match(data.error, /Nothing was booked/);
});

test('booking still succeeds without a LOOKS binding', async () => {
  const fake = fakeBookingServer();
  const { res, data } = await call(env({ LOOKS: undefined }), { mcpFetch: fake.fetch }, 'POST', '/api/book', {
    lookId: 'goatee', date: '2026-09-29', time: '10:00', customer: 'Jo Bloggs', phone: '07700900123', consent: true, image: lookImage,
  });
  assert.equal(res.status, 200);
  assert.equal(data.stored, false);
  assert.equal(data.booking.service, 'Beard Trim & Shape');
});

test('BOOKING_MOCK diary books only free times', async () => {
  const mock = new MockBookingClient({ today: '2026-09-29', services: SERVICES });
  const day = await mock.findTimes('Skin Fade', '2026-09-29');
  assert.ok(day.times.length > 0);
  const b = await mock.book({ service: 'Skin Fade', date: '2026-09-29', time: day.times[0], customer: 'Jo', phone: '07700900123' });
  assert.equal(b.service, 'Skin Fade');
  await assert.rejects(mock.book({ service: 'Skin Fade', date: '2026-09-29', time: day.times[0], customer: 'Jo', phone: '1' }), BookingError);
  assert.equal((await mock.findTimes('Skin Fade', '2026-09-27')).open, false); // Sunday
});
