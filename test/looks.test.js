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
  assert.equal(serviceForLook('high-skin-fade').name, 'Skin Fade');
  assert.equal(serviceForLook('crop-mid-fade').name, 'Skin Fade');
  assert.equal(serviceForLook('classic-side-part').name, 'Classic Cut');
  assert.equal(serviceForLook('short-boxed-beard').name, 'Beard Trim & Shape');
  assert.equal(serviceForLook('clean-stubble').name, 'Beard Trim & Shape');
  assert.equal(serviceForLook('fade-and-boxed-beard').name, 'Cut + Beard');
  assert.equal(serviceForLook('kids-crew-cut').name, 'Kids Cut (under 12)');
});

test('every service can be reached from at least one look', () => {
  const reached = new Set(LOOKS.map((l) => serviceForLook(l).name));
  for (const s of SERVICES) assert.ok(reached.has(s.name), s.name);
});

test('look steps match the service: beard services use the beard feature, Cut + Beard chains both', () => {
  for (const look of LOOKS) {
    const service = serviceForLook(look).name;
    const features = look.steps.map((s) => s.feature);
    if (service === 'Beard Trim & Shape') assert.deepEqual(features, ['beard']);
    else if (service === 'Cut + Beard') assert.deepEqual(features, ['hair', 'beard']);
    else assert.deepEqual(features, ['hair']);
  }
  assert.equal(lookUnits(getLook('fade-and-boxed-beard')), 4);
  assert.equal(lookUnits(getLook('high-skin-fade')), 2);
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
  const combo = items.find((i) => i.id === 'fade-and-boxed-beard');
  assert.deepEqual(
    { service: combo.service, price: combo.price, minutes: combo.minutes, features: combo.features, units: combo.units },
    { service: 'Cut + Beard', price: 38, minutes: 60, features: ['hair', 'beard'], units: 4 },
  );
});

test('planSteps reads LOOK_REFS and LOOK_TEMPLATES, ignores bad JSON', () => {
  const fade = getLook('high-skin-fade');
  assert.deepEqual(planSteps(fade, {}), [{ feature: 'hair', keywords: fade.steps[0].keywords }]);
  assert.equal(planSteps(fade, { LOOK_TEMPLATES: '{"high-skin-fade":"T1"}' })[0].templateId, 'T1');
  assert.equal(planSteps(fade, { LOOK_REFS: '{"high-skin-fade":"https://x/r.jpg"}' })[0].refUrl, 'https://x/r.jpg');
  assert.equal(planSteps(fade, { LOOK_TEMPLATES: 'not json' })[0].templateId, undefined);
  // Reference photos only apply to hair; beard steps still need a template.
  const beard = getLook('short-boxed-beard');
  assert.equal(planSteps(beard, { LOOK_REFS: '{"short-boxed-beard":"https://x/r.jpg"}' })[0].refUrl, undefined);
});
