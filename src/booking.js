// Booking through the Chair Ready Voice MCP server (Streamable HTTP, MCP 2025-11-25),
// using the official @modelcontextprotocol/sdk client. The server holds the real diary
// for Fade & Co.; we only call get_business_info, find_available_times, next_available
// and book_appointment.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
// Workers forbid eval/new Function, which the SDK's default (Ajv) validator relies on.
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';

export const BOOKING_MCP_URL = 'https://chair-ready-voice.sitecheck-api.workers.dev/mcp';
export const BUSINESS_ID = 'fade-and-co';

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const PHONE_RE = /^\+?[\d\s()-]{7,20}$/;

export class BookingError extends Error {
  constructor(message, { unavailable = false } = {}) {
    super(message);
    this.name = 'BookingError';
    // true when the booking server itself could not be reached.
    this.unavailable = unavailable;
  }
}

// Tool results carry structuredContent (the server declares output schemas);
// fall back to parsing the text block for older servers.
export function readToolResult(result) {
  const text = (result?.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  if (result?.isError) throw new BookingError(text || 'The booking server refused the request.');
  if (result?.structuredContent !== undefined) return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export class BookingClient {
  constructor({ url = BOOKING_MCP_URL, business = BUSINESS_ID, fetch } = {}) {
    this.url = url;
    this.business = business;
    this.fetch = fetch;
  }

  // One MCP session per call: the server is stateless and our Worker requests are short.
  async call(name, args) {
    const client = new Client(
      { name: 'fade-try-on', version: '0.1.0' },
      { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    );
    const transport = new StreamableHTTPClientTransport(new URL(this.url), this.fetch ? { fetch: this.fetch } : {});
    try {
      await client.connect(transport);
    } catch (err) {
      throw new BookingError(`Booking server unreachable: ${err.message}`, { unavailable: true });
    }
    try {
      const result = await client.callTool({ name, arguments: { business: this.business, ...args } });
      return readToolResult(result);
    } catch (err) {
      if (err instanceof BookingError) throw err;
      throw new BookingError(`Booking call ${name} failed: ${err.message}`, { unavailable: true });
    } finally {
      await client.close().catch(() => {});
    }
  }

  businessInfo() {
    return this.call('get_business_info', {});
  }

  findTimes(service, date) {
    if (!DATE_RE.test(date)) throw new BookingError('Date must be YYYY-MM-DD.');
    return this.call('find_available_times', { service, date });
  }

  async nextAvailable(service, fromDate) {
    const out = await this.call('next_available', fromDate ? { service, from_date: fromDate } : { service });
    return Array.isArray(out) ? out : out.items || [];
  }

  book({ service, date, time, customer, phone }) {
    return this.call('book_appointment', { service, date, time, customer, phone });
  }
}

// BOOKING_MOCK=1: an in-memory diary with the same answers' shapes, for demos and
// screen recordings that shouldn't touch the real booking server.
export class MockBookingClient {
  constructor({ today = new Date().toISOString().slice(0, 10), services } = {}) {
    this.today = today;
    this.services = services;
    this.booked = new Set();
    this.nextId = 1000;
  }

  _service(name) {
    const s = this.services.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
    if (!s) throw new BookingError(`No service called "${name}".`);
    return s;
  }

  _day(date) {
    const d = new Date(`${date}T12:00:00Z`);
    return {
      weekday: d.getUTCDay(),
      label: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
    };
  }

  _times(date, minutes) {
    const { weekday } = this._day(date);
    if (weekday === 0 || weekday === 1) return null;
    const [open, close] = weekday === 6 ? [9 * 60, 17 * 60] : [10 * 60, 19 * 60];
    const times = [];
    for (let t = open; t + minutes <= close; t += 15) {
      if (t < 14 * 60 && t + minutes > 13 * 60 + 30) continue; // lunch break
      const hhmm = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      // Pretend the diary is fairly full: only every third slot is free.
      if ((t / 15) % 3 === 0 && !this.booked.has(`${date} ${hhmm}`)) times.push(hhmm);
    }
    return times;
  }

  async businessInfo() {
    return {
      name: 'Fade & Co.',
      address: '214 Kingsland Road, Dalston, London',
      owner: 'Marcus',
      timezone: 'Europe/London',
      today: this.today,
      deposit_rule: '£5 deposit on Sat',
      services: this.services,
    };
  }

  async findTimes(service, date) {
    const s = this._service(service);
    const times = this._times(date, s.minutes);
    const { label, weekday } = this._day(date);
    return {
      date, day: label, service: s.name, minutes: s.minutes, price: s.price,
      deposit: weekday === 6 ? 5 : 0, open: times !== null, times: times || [],
      note: times === null ? 'Fade & Co. is closed on Sundays and Mondays.' : null,
    };
  }

  async nextAvailable(service, fromDate = this.today) {
    const s = this._service(service);
    const items = [];
    const d = new Date(`${fromDate}T12:00:00Z`);
    for (let i = 0; i < 14 && items.length < 3; i++) {
      const date = d.toISOString().slice(0, 10);
      const times = this._times(date, s.minutes);
      if (times && times.length) {
        items.push({ date, day: this._day(date).label, first_times: times.slice(0, 4), deposit: this._day(date).weekday === 6 ? 5 : 0 });
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return items;
  }

  async book({ service, date, time, customer, phone }) {
    const s = this._service(service);
    const times = this._times(date, s.minutes) || [];
    if (!times.includes(time)) throw new BookingError(`${time} on ${date} is not free for ${s.name}.`);
    this.booked.add(`${date} ${time}`);
    const [h, m] = time.split(':').map(Number);
    const end = h * 60 + m + s.minutes;
    return {
      booking_id: this.nextId++, business: 'Fade & Co.', service: s.name, day: this._day(date).label, date, time,
      ends: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`,
      price: s.price, deposit: this._day(date).weekday === 6 ? 5 : 0, confirmation_sent_to: phone, customer,
    };
  }
}
