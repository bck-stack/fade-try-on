// Shared fakes for the tests: an in-memory KV namespace, tiny JPEGs, and a fake
// YouCam API that speaks the request/response shapes from the official docs.

export class FakeKV {
  constructor() {
    this.data = new Map();
  }

  async put(key, value, opts = {}) {
    let stored = value;
    if (value instanceof Uint8Array) stored = value.slice().buffer;
    this.data.set(key, { value: stored, metadata: opts.metadata ?? null, ttl: opts.expirationTtl });
  }

  async get(key) {
    const e = this.data.get(key);
    return e ? e.value : null;
  }

  async getWithMetadata(key, opts = {}) {
    const e = this.data.get(key);
    if (!e) return { value: null, metadata: null };
    let value = e.value;
    if (opts.type === 'arrayBuffer' && typeof value === 'string') value = new TextEncoder().encode(value).buffer;
    return { value, metadata: e.metadata };
  }

  async list({ prefix = '' } = {}) {
    const keys = [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort()
      .map((name) => ({ name, metadata: this.data.get(name).metadata }));
    return { keys, list_complete: true };
  }

  async delete(key) {
    this.data.delete(key);
  }
}

// Smallest byte sequence our JPEG checks accept: SOI, APP0, SOF0 (with size), EOI.
export function tinyJpeg(width = 800, height = 1000) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

export function jpegDataUrl(width, height) {
  return 'data:image/jpeg;base64,' + Buffer.from(tinyJpeg(width, height)).toString('base64');
}

const BASE = 'https://yce-api-01.makeupar.com';

// A fake YouCam server. Records every request; behaviour is tweakable per test.
export function fakeYouCam(overrides = {}) {
  const calls = [];
  const state = {
    pollsUntilSuccess: 2,
    polls: {},
    taskCounter: 0,
    hairTemplates: [
      [{ id: 'hair-long', title: 'Long Layers', category_name: 'Women' }, { id: 'hair-bob', title: 'Curly Bob', category_name: 'Women' }],
      [{ id: 'hair-buzz', title: 'Buzz Cut', category_name: 'Men' }, { id: 'hair-fade', title: 'High Skin Fade', category_name: 'Men' }],
    ],
    beardTemplates: [[{ id: 'beard-goatee', title: 'Goatee' }, { id: 'beard-box', title: 'Short Boxed Beard' }, { id: 'beard-stub', title: 'Stubble' }]],
    taskResult: () => ({ task_status: 'success', error: null, results: { url: `https://results.example/out/${state.taskCounter}.jpg` } }),
    ...overrides,
  };

  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  async function fetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
    let body = init.body;
    if (typeof body === 'string' && headers['content-type']?.includes('json')) body = JSON.parse(body);
    const call = { method, url: url.href, path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body };
    calls.push(call);
    if (state.intercept) {
      const r = await state.intercept(call);
      if (r) return r;
    }

    if (url.origin === BASE) {
      if (headers.authorization !== 'Bearer test-key') return reply({ status: 401, error: 'Unauthorized', error_code: 'InvalidAccessToken' }, 401);
      if (method === 'POST' && url.pathname === '/s2s/v2.0/file') {
        const f = body.files[0];
        return reply({
          status: 200,
          data: {
            files: [{
              content_type: f.content_type,
              file_name: f.file_name,
              file_id: 'FILE-1',
              requests: [{ method: 'PUT', url: 'https://upload.example/presigned/1', headers: { 'Content-Type': f.content_type, 'Content-Length': String(f.file_size) } }],
            }],
          },
        });
      }
      const tpl = /^\/s2s\/v2\.[01]\/task\/template\/(hair-transfer|beard-style)$/.exec(url.pathname);
      if (method === 'GET' && tpl) {
        const pages = tpl[1] === 'hair-transfer' ? state.hairTemplates : state.beardTemplates;
        const i = url.searchParams.get('starting_token') ? Number(url.searchParams.get('starting_token')) : 0;
        return reply({ status: 200, data: { templates: pages[i] || [], next_token: i + 1 < pages.length ? String(i + 1) : null } });
      }
      if (method === 'POST' && (url.pathname === '/s2s/v2.1/task/hair-transfer' || url.pathname === '/s2s/v2.0/task/beard-style')) {
        state.taskCounter++;
        return reply({ status: 200, data: { task_id: `TASK-${state.taskCounter}` } });
      }
      const st = /^\/s2s\/v2\.[01]\/task\/(hair-transfer|beard-style)\/(.+)$/.exec(url.pathname);
      if (method === 'GET' && st) {
        const id = decodeURIComponent(st[2]);
        state.polls[id] = (state.polls[id] || 0) + 1;
        if (state.polls[id] < state.pollsUntilSuccess) return reply({ status: 200, data: { task_status: 'running', error: null, results: null } });
        return reply({ status: 200, data: state.taskResult(id) });
      }
      if (method === 'POST' && url.pathname === '/s2s/v2.0/task/delete') return reply({ status: 200 });
      if (method === 'GET' && url.pathname === '/s2s/v1.0/client/credit') {
        return reply({ status: 200, results: [{ id: 1, type: 'ApiPaygToken', amount: 990, amount_dec: 990.5, expiry: 0 }] });
      }
      return reply({ status: 404, error: 'not found' }, 404);
    }
    if (url.origin === 'https://upload.example' && method === 'PUT') return new Response(null, { status: 200 });
    if (url.origin === 'https://results.example') {
      return new Response(tinyJpeg(600, 750), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    }
    return new Response('unexpected', { status: 599 });
  }

  return { fetch, calls, state };
}
