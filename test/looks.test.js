import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, SERVICES, getLook, serviceForLook, mergeServices, findService, catalogue, lookUnits, planSteps } from '../src/looks.js';
import { MOCK_IMAGES } from '../src/mock-images.js';

// The shop's price list, as agreed with Marcus.
const PRICE_LIST = {
  'Skin Fade': { minutes: 45, price: 28 },
  'Classic Cut': { minutes: 30, price: 22 },
  'Beard Trim & Shape': { minutes: 20, price: 14 },
  'Cut + Beard': { minutes: 60, price: 38 },
  'Kids Cut (under 12)': { minutes: 30, price: 16 },
};

test('fallback services match the price list', () => {
  assert.equal(SERVICES.length, 5);
  for (const s of SERVICES) assert.deepEqual({ minutes: s.minutes, price: s.price }, PRICE_LIST[s.name], s.name);
});

test('every look maps to a real service with price and duration', () => {
  for (const look of LOOKS) {
    const s = serviceForLook(look);
    assert.ok(PRICE_LIST[s.name], `${look.id} -> ${s.name}`);
  }
  assert.equal(serviceForLook('tapered-fade').name, 'Skin Fade');
  assert.equal(serviceForLook('textured-crop').name, 'Skin Fade');
  assert.equal(serviceForLook('side-swept-undercut').name, 'Classic Cut');
  assert.equal(serviceForLook('anchor-beard').name, 'Beard Trim & Shape');
  assert.equal(serviceForLook('goatee').name, 'Beard Trim & Shape');
  assert.equal(serviceForLook('fade-and-anchor').name, 'Cut + Beard');
  assert.equal(serviceForLook('buzz-cut').name, 'Classic Cut');
});

test('every adult service can be reached from a look; kids cuts have none on purpose', () => {
  const reached = new Set(LOOKS.map((l) => serviceForLook(l).name));
  for (const s of SERVICES) assert.equal(reached.has(s.name), !/kids/i.test(s.name), s.name);
});

test('every step pins a template id from the live YouCam catalogue', () => {
  const pinned = {
    'tapered-fade': ['all_messy_tapered_fade'], 'textured-crop': ['male_textured_crop'],
    'side-swept-undercut': ['all_side_swept_undercut'], 'buzz-cut': ['all_buzz_cut'],
    'anchor-beard': ['all_anchor'], goatee: ['all_goatee'], 'fade-and-anchor': ['all_messy_tapered_fade', 'all_anchor'],
  };
  assert.deepEqual(Object.keys(pinned).sort(), LOOKS.map((l) => l.id).sort());
  for (const look of LOOKS) assert.deepEqual(planSteps(look).map((s) => s.templateId), pinned[look.id], look.id);
});

test('look steps match the service: beard services use the beard feature, Cut + Beard chains both', () => {
  for (const look of LOOKS) {
    const service = serviceForLook(look).name;
    const features = look.steps.map((s) => s.feature);
    if (service === 'Beard Trim & Shape') assert.deepEqual(features, ['beard']);
    else if (service === 'Cut + Beard') assert.deepEqual(features, ['hair', 'beard']);
    else assert.deepEqual(features, ['hair']);
  }
  assert.equal(lookUnits(getLook('fade-and-anchor')), 4);
  assert.equal(lookUnits(getLook('tapered-fade')), 2);
});

test('every look has a mock image, plus the demo selfie', () => {
  for (const look of LOOKS) assert.ok(MOCK_IMAGES[look.id], look.id);
  assert.ok(MOCK_IMAGES['demo-selfie']);
});

test('unknown look ids are rejected', () => {
  assert.throws(() => getLook('mullet'), RangeError);
});

test('findService tolerates case and a trailing qualifier', () => {
  const live = [{ id: 5, name: 'Kids Cut (under 12)', minutes: 30, price: 16 }];
  assert.equal(findService(live, 'kids cut').id, 5);
  assert.equal(findService(live, 'KIDS CUT (UNDER 12)').id, 5);
  assert.equal(findService(live, 'Skin Fade'), null);
});

test('live prices from the booking server win; missing ones fall back', () => {
  const live = [
    { id: 11, name: 'Skin Fade', minutes: 45, price: 30 },
    { id: 15, name: 'Kids Cut', minutes: 25, price: 15 },
  ];
  const merged = mergeServices(live);
  assert.deepEqual(findService(merged, 'Skin Fade'), { id: 11, name: 'Skin Fade', minutes: 45, price: 30 });
  assert.deepEqual(findService(merged, 'Kids Cut'), { id: 15, name: 'Kids Cut', minutes: 25, price: 15 });
  assert.equal(findService(merged, 'Classic Cut').price, 22);
  assert.deepEqual(mergeServices(null), SERVICES);
});

test('catalogue gives the page everything it shows', () => {
  const items = catalogue();
  assert.equal(items.length, LOOKS.length);
  const combo = items.find((i) => i.id === 'fade-and-anchor');
  assert.deepEqual(
    { service: combo.service, price: combo.price, minutes: combo.minutes, features: combo.features, units: combo.units },
    { service: 'Cut + Beard', price: 38, minutes: 60, features: ['hair', 'beard'], units: 4 },
  );
});

test('planSteps reads LOOK_REFS and LOOK_TEMPLATES, ignores bad JSON', () => {
  const fade = getLook('tapered-fade');
  assert.deepEqual(planSteps(fade, {}), [{ feature: 'hair', keywords: fade.steps[0].keywords, templateId: 'all_messy_tapered_fade' }]);
  assert.equal(planSteps(fade, { LOOK_TEMPLATES: '{"tapered-fade":"T1"}' })[0].templateId, 'T1');
  assert.equal(planSteps(fade, { LOOK_REFS: '{"tapered-fade":"https://x/r.jpg"}' })[0].refUrl, 'https://x/r.jpg');
  assert.equal(planSteps(fade, { LOOK_TEMPLATES: 'not json' })[0].templateId, 'all_messy_tapered_fade');
  assert.equal(planSteps(fade, { LOOK_REFS: '{"tapered-fade":"https://x/r.jpg"}' })[0].templateId, undefined);
  // Reference photos only apply to hair; beard steps still need a template.
  const beard = getLook('anchor-beard');
  assert.equal(planSteps(beard, { LOOK_REFS: '{"anchor-beard":"https://x/r.jpg"}' })[0].refUrl, undefined);
});
