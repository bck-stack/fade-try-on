// A mocked Chair Ready Voice MCP server, built with the official SDK server classes and
// served through the web-standard Streamable HTTP transport. `fetch` routes the
// client's HTTP requests straight into it, so no port or network is needed.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import * as z from 'zod';

export function fakeBookingServer() {
  const state = {
    calls: [],
    httpRequests: 0,
    protocolVersions: new Set(),
    taken: new Set(['2026-09-29 11:00']),
    nextId: 501,
    services: [
      { id: 1, name: 'Skin Fade', minutes: 45, price: 28 },
      { id: 2, name: 'Classic Cut', minutes: 30, price: 22 },
      { id: 3, name: 'Beard Trim & Shape', minutes: 20, price: 14 },
      { id: 4, name: 'Cut + Beard', minutes: 60, price: 38 },
      { id: 5, name: 'Kids Cut (under 12)', minutes: 30, price: 16 },
    ],
  };
  const TIMES = ['10:00', '11:00', '11:15', '14:00'];
  const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
  const fail = (text) => ({ content: [{ type: 'text', text }], isError: true });
  const findService = (name) => state.services.find((s) => s.name.toLowerCase() === String(name).toLowerCase());

  function build() {
    const server = new McpServer({ name: 'chair-ready-voice-fake', version: '0.0.1' });
    const business = z.string().default('fade-and-co');

    server.registerTool('get_business_info', { inputSchema: { business } }, async (args) => {
      state.calls.push({ tool: 'get_business_info', args });
      return ok({ name: 'Fade & Co.', address: '214 Kingsland Road, Dalston, London', owner: 'Marcus', timezone: 'Europe/London', today: '2026-09-25', now: '16:00', hours: [], deposit_rule: '£5 deposit on Sat', services: state.services });
    });

    server.registerTool('find_available_times', { inputSchema: { business, service: z.string(), date: z.string() } }, async (args) => {
      state.calls.push({ tool: 'find_available_times', args });
      const s = findService(args.service);
      if (!s) return fail(`No service called "${args.service}".`);
      const times = TIMES.filter((t) => !state.taken.has(`${args.date} ${t}`));
      return ok({ date: args.date, day: 'Tuesday 29 September', service: s.name, minutes: s.minutes, price: s.price, deposit: 0, open: true, times, note: null });
    });

    server.registerTool('next_available', { inputSchema: { business, service: z.string(), from_date: z.string().optional() } }, async (args) => {
      state.calls.push({ tool: 'next_available', args });
      if (!findService(args.service)) return fail(`No service called "${args.service}".`);
      return ok({ items: [{ date: '2026-09-29', day: 'Tuesday 29 September', first_times: ['10:00', '11:15'], deposit: 0 }] });
    });

    server.registerTool('book_appointment', {
      inputSchema: { business, service: z.string(), date: z.string(), time: z.string(), customer: z.string().min(2), phone: z.string() },
    }, async (args) => {
      state.calls.push({ tool: 'book_appointment', args });
      const s = findService(args.service);
      if (!s) return fail(`No service called "${args.service}".`);
      if (state.taken.has(`${args.date} ${args.time}`)) return fail(`Sorry, ${args.time} on ${args.date} was just taken.`);
      state.taken.add(`${args.date} ${args.time}`);
      const [h, m] = args.time.split(':').map(Number);
      const end = h * 60 + m + s.minutes;
      return ok({
        booking_id: state.nextId++, business: 'Fade & Co.', service: s.name, day: 'Tuesday 29 September', date: args.date, time: args.time,
        ends: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`,
        price: s.price, deposit: 0, confirmation_sent_to: args.phone,
      });
    });
    return server;
  }

  // Stateless: a fresh server + transport per HTTP request, like the real Worker.
  async function fetch(input, init) {
    const request = new Request(input, init);
    state.httpRequests++;
    const v = request.headers.get('mcp-protocol-version');
    if (v) state.protocolVersions.add(v);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await build().connect(transport);
    return transport.handleRequest(request);
  }

  return { fetch, state };
}
