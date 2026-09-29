// Chosen looks for Marcus, in the LOOKS KV namespace.
//
// Only the generated result image the customer picked is stored, and only when they
// ticked the consent box. The original selfie is never written anywhere. Without
// consent we keep a text-only record (look name + booking) so Marcus still knows what
// was asked for. Records expire a week after the appointment.
//
// Keys:  look:<YYYY-MM-DD>T<HH:MM>:<booking_id>   value = image bytes ('' if none)
//        quota:<visitor>:<YYYY-MM-DD>             value = tries used today

const KEEP_AFTER_APPOINTMENT_DAYS = 7;
const MIN_TTL_SECONDS = 24 * 3600;

export function lookKey(booking) {
  return `look:${booking.date}T${booking.time}:${booking.booking_id}`;
}

export function expiryFor(date, now = Date.now()) {
  const appointment = Date.parse(`${date}T23:59:59Z`);
  const expires = appointment + KEEP_AFTER_APPOINTMENT_DAYS * 86400 * 1000;
  return Math.max(MIN_TTL_SECONDS, Math.round((expires - now) / 1000));
}

export class LookStore {
  constructor(kv) {
    this.kv = kv;
  }

  get enabled() {
    return Boolean(this.kv);
  }

  async save({ booking, look, customer, image, now = Date.now() }) {
    if (!this.kv) return null;
    const key = lookKey(booking);
    const metadata = {
      bookingId: booking.booking_id,
      date: booking.date,
      day: booking.day || booking.date,
      time: booking.time,
      ends: booking.ends || null,
      service: booking.service,
      customer: String(customer).slice(0, 80),
      lookId: look.id,
      lookName: look.name,
      hasImage: Boolean(image),
      contentType: image ? image.contentType : null,
      createdAt: new Date(now).toISOString(),
    };
    await this.kv.put(key, image ? image.bytes : '', {
      metadata,
      expirationTtl: expiryFor(booking.date, now),
    });
    return key;
  }

  async list() {
    if (!this.kv) return [];
    const items = [];
    let cursor;
    do {
      const page = await this.kv.list({ prefix: 'look:', cursor });
      for (const k of page.keys) items.push({ id: k.name, ...(k.metadata || {}) });
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    // Keys sort by date and time already; keep that order explicitly.
    return items.sort((a, b) => a.id.localeCompare(b.id));
  }

  async getImage(id) {
    if (!this.kv || !id.startsWith('look:')) return null;
    const { value, metadata } = await this.kv.getWithMetadata(id, { type: 'arrayBuffer' });
    if (!value || !metadata?.hasImage || value.byteLength === 0) return null;
    return { bytes: new Uint8Array(value), contentType: metadata.contentType || 'image/jpeg' };
  }

  async remove(id) {
    if (!this.kv || !id.startsWith('look:')) return false;
    await this.kv.delete(id);
    return true;
  }
}

// Per-visitor try-on cap. KV is eventually consistent, so this is a soft limit that
// stops casual overuse of units; it isn't a hard security boundary. Without a KV
// binding it falls back to a per-isolate Map.
const memoryQuota = new Map();

export class TryQuota {
  constructor(kv, limit) {
    this.kv = kv;
    this.limit = limit;
  }

  key(visitor, now = Date.now()) {
    return `quota:${visitor}:${new Date(now).toISOString().slice(0, 10)}`;
  }

  async used(visitor, now) {
    const key = this.key(visitor, now);
    if (!this.kv) return memoryQuota.get(key) || 0;
    return Number((await this.kv.get(key)) || 0);
  }

  async left(visitor, now) {
    return Math.max(0, this.limit - (await this.used(visitor, now)));
  }

  async spend(visitor, now) {
    const key = this.key(visitor, now);
    const next = (await this.used(visitor, now)) + 1;
    if (!this.kv) memoryQuota.set(key, next);
    else await this.kv.put(key, String(next), { expirationTtl: 2 * 86400 });
    return Math.max(0, this.limit - next);
  }
}

// Visitor id: a hash of IP + user agent, so no raw IP is stored.
export async function visitorId(request, salt = 'fade-try-on') {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local';
  const ua = request.headers.get('user-agent') || '';
  const data = new TextEncoder().encode(`${salt}|${ip}|${ua}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
