// The looks a customer can try, and the Fade & Co. service each one books.
//
// A look is one or more YouCam steps run in order on the customer's photo:
//   { feature: 'hair',  ... }  -> AI Hairstyle Generator v2.1 (/s2s/v2.1/task/hair-transfer)
//   { feature: 'beard', ... }  -> AI Beard Style Generator    (/s2s/v2.0/task/beard-style)
// "Cut + Beard" chains both: the beard step runs on the hairstyle result.
//
// How a step picks its style (first match wins):
//   1. LOOK_REFS env (JSON {lookId: url}) -> hair step uses ref_file_url, i.e. a photo of
//      one of Marcus's own cuts as the reference. Hair only; beard has no reference mode.
//   2. LOOK_TEMPLATES env (JSON {lookId: templateId} or {lookId: {hair, beard}})
//   3. The first YouCam template whose title/category contains one of `keywords`.

// Fallback copy of the services on the Chair Ready booking server. Live values from
// get_business_info win when the server is reachable (see mergeServices).
export const SERVICES = [
  { id: 1, name: 'Skin Fade', minutes: 45, price: 28 },
  { id: 2, name: 'Classic Cut', minutes: 30, price: 22 },
  { id: 3, name: 'Beard Trim & Shape', minutes: 20, price: 14 },
  { id: 4, name: 'Cut + Beard', minutes: 60, price: 38 },
  { id: 5, name: 'Kids Cut (under 12)', minutes: 30, price: 16 },
];

// YouCam unit cost per feature, from the Unit Consumption tables in the docs.
export const UNIT_COST = { hair: 2, beard: 2 };

export const LOOKS = [
  {
    id: 'high-skin-fade',
    name: 'High Skin Fade',
    blurb: 'Down to the skin at the sides, short textured top.',
    service: 'Skin Fade',
    steps: [{ feature: 'hair', keywords: ['skin fade', 'high fade', 'fade', 'buzz'] }],
  },
  {
    id: 'crop-mid-fade',
    name: 'Crop & Mid Fade',
    blurb: 'Blunt textured fringe with a mid fade.',
    service: 'Skin Fade',
    steps: [{ feature: 'hair', keywords: ['crop', 'french crop', 'mid fade', 'fade'] }],
  },
  {
    id: 'classic-side-part',
    name: 'Classic Side Part',
    blurb: 'Scissor cut on top, tidy taper, hard part optional.',
    service: 'Classic Cut',
    steps: [{ feature: 'hair', keywords: ['side part', 'comb over', 'classic', 'ivy', 'slick'] }],
  },
  {
    id: 'short-boxed-beard',
    name: 'Short Boxed Beard',
    blurb: 'Full but short, sharp cheek and neck lines.',
    service: 'Beard Trim & Shape',
    steps: [{ feature: 'beard', keywords: ['short box', 'boxed', 'box', 'full'] }],
  },
  {
    id: 'clean-stubble',
    name: 'Clean Stubble Line-up',
    blurb: 'Heavy stubble, lined up at the cheeks and neck.',
    service: 'Beard Trim & Shape',
    steps: [{ feature: 'beard', keywords: ['stubble', 'short', 'trim'] }],
  },
  {
    id: 'fade-and-boxed-beard',
    name: 'Skin Fade + Boxed Beard',
    blurb: 'The full works: fade and a shaped beard in one sitting.',
    service: 'Cut + Beard',
    steps: [
      { feature: 'hair', keywords: ['skin fade', 'high fade', 'fade', 'buzz'] },
      { feature: 'beard', keywords: ['short box', 'boxed', 'box', 'full'] },
    ],
  },
  {
    id: 'kids-crew-cut',
    name: 'Kids Crew Cut',
    blurb: 'Short, neat and easy. For under-12s (a parent takes the photo).',
    service: 'Kids Cut (under 12)',
    steps: [{ feature: 'hair', keywords: ['crew', 'buzz', 'short'] }],
  },
];

export function getLook(id) {
  const look = LOOKS.find((l) => l.id === id);
  if (!look) throw new RangeError(`Unknown look: ${id}`);
  return look;
}

export function lookUnits(look) {
  return look.steps.reduce((sum, s) => sum + UNIT_COST[s.feature], 0);
}

// Service names on the booking server may carry extra words ("Kids Cut (under 12)").
// Match case-insensitively on the name, then on the name without a trailing "(...)".
function normalise(name) {
  return String(name).toLowerCase().replace(/\s*\(.*\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

export function findService(services, name) {
  const exact = services.find((s) => s.name.toLowerCase() === String(name).toLowerCase());
  if (exact) return exact;
  const n = normalise(name);
  return services.find((s) => normalise(s.name) === n) || null;
}

// Live services win; anything the server doesn't list falls back to our copy.
export function mergeServices(live) {
  if (!Array.isArray(live) || live.length === 0) return SERVICES.map((s) => ({ ...s }));
  return SERVICES.map((local) => {
    const remote = findService(live, local.name);
    return remote ? { id: remote.id, name: remote.name, minutes: remote.minutes, price: remote.price } : { ...local };
  });
}

export function serviceForLook(lookOrId, services = SERVICES) {
  const look = typeof lookOrId === 'string' ? getLook(lookOrId) : lookOrId;
  const service = findService(services, look.service);
  if (!service) throw new Error(`Look ${look.id} maps to unknown service ${look.service}`);
  return service;
}

// What the customer-facing page needs: looks with their service, price and duration.
export function catalogue(services = SERVICES) {
  return LOOKS.map((look) => {
    const service = serviceForLook(look, services);
    return {
      id: look.id,
      name: look.name,
      blurb: look.blurb,
      service: service.name,
      price: service.price,
      minutes: service.minutes,
      features: look.steps.map((s) => s.feature),
      units: lookUnits(look),
    };
  });
}

function parseJsonEnv(value, name) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    console.warn(`${name} is not valid JSON; ignoring it`);
    return {};
  }
}

// Resolve how each step of a look should call YouCam, from env overrides.
// Returns [{ feature, templateId?, refUrl?, keywords }]; unresolved steps keep keywords
// so the YouCam client can pick a template by name.
export function planSteps(look, env = {}) {
  const refs = parseJsonEnv(env.LOOK_REFS, 'LOOK_REFS');
  const templates = parseJsonEnv(env.LOOK_TEMPLATES, 'LOOK_TEMPLATES');
  return look.steps.map((step) => {
    const plan = { feature: step.feature, keywords: step.keywords };
    if (step.feature === 'hair' && typeof refs[look.id] === 'string') {
      plan.refUrl = refs[look.id];
      return plan;
    }
    const t = templates[look.id];
    if (typeof t === 'string' && look.steps.length === 1) plan.templateId = t;
    else if (t && typeof t === 'object' && typeof t[step.feature] === 'string') plan.templateId = t[step.feature];
    return plan;
  });
}
