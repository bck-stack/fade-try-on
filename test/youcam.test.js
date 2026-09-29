import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YouCamClient, YouCamError, MockYouCam, createYouCam, sniffImageType } from '../src/youcam.js';
import { LOOKS, getLook, planSteps } from '../src/looks.js';
import { fakeYouCam, tinyJpeg } from './helpers.js';

const noSleep = async () => {};

function client(fake, opts = {}) {
  return new YouCamClient({ apiKey: 'test-key', fetch: fake.fetch, sleep: noSleep, ...opts });
}

const selfie = () => ({ bytes: tinyJpeg(768, 1024), contentType: 'image/jpeg' });
// The keyword fallback path: the same look with its pinned template ids removed.
const unpinned = (look) => ({ ...look, steps: look.steps.map(({ template, keepColor, ...step }) => step) });

test('hairstyle look: upload, run, poll, download, per the documented shapes', async () => {
  const fake = fakeYouCam();
  const yc = client(fake);
  const look = unpinned(getLook('tapered-fade'));
  const out = await yc.applyLook({ lookId: look.id, steps: planSteps(look, {}) }, selfie());

  // 1. File API: JSON body with content_type/file_name/file_size, bearer auth.
  const file = fake.calls[0];
  assert.equal(file.method, 'POST');
  assert.equal(file.url, 'https://yce-api-01.makeupar.com/s2s/v2.0/file');
  assert.equal(file.headers.authorization, 'Bearer test-key');
  assert.deepEqual(file.body, { files: [{ content_type: 'image/jpg', file_name: 'selfie.jpg', file_size: selfie().bytes.byteLength }] });

  // 2. PUT to the presigned URL with the given headers (Content-Length left to fetch).
  const put = fake.calls[1];
  assert.equal(put.method, 'PUT');
  assert.equal(put.url, 'https://upload.example/presigned/1');
  assert.equal(put.headers['content-type'], 'image/jpg');
  assert.equal(put.headers['content-length'], undefined);
  assert.equal(put.body.byteLength, selfie().bytes.byteLength);

  // 3. Template picked by keyword ("fade") across paginated template lists.
  const run = fake.calls.find((c) => c.method === 'POST' && c.path === '/s2s/v2.1/task/hair-transfer');
  // keep_users_color template -> keep the customer's own hair colour.
  assert.deepEqual(run.body, { src_file_id: 'FILE-1', template_id: 'hair-fade', hair_color: 'src' });
  const templatePages = fake.calls.filter((c) => c.path === '/s2s/v2.1/task/template/hair-transfer');
  assert.equal(templatePages.length, 2);
  assert.equal(templatePages[0].query.page_size, '20');
  assert.equal(templatePages[1].query.starting_token, '1');

  // 4. Polled until success.
  const polls = fake.calls.filter((c) => c.method === 'GET' && c.path === '/s2s/v2.1/task/hair-transfer/TASK-1');
  assert.equal(polls.length, 2);

  // 5. Result downloaded.
  assert.equal(out.contentType, 'image/jpeg');
  assert.deepEqual(out.taskIds, ['TASK-1']);
  assert.equal(sniffImageType(out.bytes), 'image/jpeg');
});

test('hair_color is only sent for templates that declare keep_users_color', async () => {
  const fake = fakeYouCam();
  const yc = client(fake);
  const look = unpinned(getLook('buzz-cut')); // keywords resolve to 'hair-buzz', no keep_users_color
  await yc.applyLook({ lookId: look.id, steps: planSteps(look, {}) }, selfie());
  const run = fake.calls.find((c) => c.method === 'POST' && c.path === '/s2s/v2.1/task/hair-transfer');
  assert.deepEqual(run.body, { src_file_id: 'FILE-1', template_id: 'hair-buzz' });
});

test('template list is fetched once and cached per client', async () => {
  const fake = fakeYouCam();
  const yc = client(fake);
  const look = unpinned(getLook('tapered-fade'));
  await yc.applyLook({ lookId: look.id, steps: planSteps(look, {}) }, selfie());
  await yc.applyLook({ lookId: look.id, steps: planSteps(look, {}) }, selfie());
  assert.equal(fake.calls.filter((c) => c.path.includes('/template/')).length, 2); // 2 pages, first time only
});

test('pinned templates that keep the customer colour send hair_color: src', async () => {
  const fake = fakeYouCam();
  const yc = client(fake);
  const look = getLook('side-swept-undercut');
  await yc.applyLook({ lookId: look.id, steps: planSteps(look, {}) }, selfie());
  const run = fake.calls.find((c) => c.method === 'POST' && c.path === '/s2s/v2.1/task/hair-transfer');
  assert.deepEqual(run.body, { src_file_id: 'FILE-1', template_id: 'all_side_swept_undercut', hair_color: 'src' });
});

test('keyword priority: first keyword wins over later ones, falls back to first template', async () => {
  const fake = fakeYouCam();
  const yc = client(fake);
  assert.equal(await yc.resolveTemplate('beard', ['short box', 'stubble']), 'beard-box');
  assert.equal(await yc.resolveTemplate('beard', ['stubble', 'short box']), 'beard-stub');
  assert.equal(await yc.resolveTemplate('beard', ['nothing-matches']), 'beard-goatee');
});

test('Cut + Beard chains: beard step runs on the hairstyle result URL', async () => {
  const fake = fakeYouCam();
  const yc = client(fake);
  const look = getLook('fade-and-anchor');
  const out = await yc.applyLook({ lookId: look.id, steps: planSteps(look, {}) }, selfie());

  const hair = fake.calls.find((c) => c.method === 'POST' && c.path === '/s2s/v2.1/task/hair-transfer');
  const beard = fake.calls.find((c) => c.method === 'POST' && c.path === '/s2s/v2.0/task/beard-style');
  // Pinned ids go straight to the task: no template listing, no keyword guessing.
  assert.deepEqual(hair.body, { src_file_id: 'FILE-1', template_id: 'all_messy_tapered_fade' });
  assert.deepEqual(beard.body, { src_file_url: 'https://results.example/out/1.jpg', template_id: 'all_anchor' });
  assert.equal(fake.calls.filter((c) => c.path.includes('/template/')).length, 0);
  assert.equal(fake.calls.filter((c) => c.path === '/s2s/v2.0/file').length, 1, 'selfie uploaded once');
  assert.deepEqual(out.taskIds, ['TASK-1', 'TASK-2']);
  // Only the final result is downloaded.
  assert.equal(fake.calls.filter((c) => c.url.startsWith('https://results.example')).length, 1);
});

test('LOOK_REFS: hairstyle uses a reference photo (ref_file_url) and skips templates', async () => {
  const fake = fakeYouCam();
  const yc = client(fake);
  const look = getLook('side-swept-undercut');
  const env = { LOOK_REFS: JSON.stringify({ 'side-swept-undercut': 'https://fadeandco.example/refs/side-part.jpg' }) };
  await yc.applyLook({ lookId: look.id, steps: planSteps(look, env) }, selfie());
  const run = fake.calls.find((c) => c.path === '/s2s/v2.1/task/hair-transfer' && c.method === 'POST');
  assert.deepEqual(run.body, { src_file_id: 'FILE-1', ref_file_url: 'https://fadeandco.example/refs/side-part.jpg' });
  assert.equal(fake.calls.filter((c) => c.path.includes('/template/')).length, 0);
});

test('LOOK_TEMPLATES pins template ids', async () => {
  const fake = fakeYouCam();
  const yc = client(fake);
  const look = getLook('fade-and-anchor');
  const env = { LOOK_TEMPLATES: JSON.stringify({ 'fade-and-anchor': { hair: 'H-9', beard: 'B-9' } }) };
  await yc.applyLook({ lookId: look.id, steps: planSteps(look, env) }, selfie());
  const bodies = fake.calls.filter((c) => c.method === 'POST' && c.path.includes('/task/') && !c.path.endsWith('delete')).map((c) => c.body.template_id);
  assert.deepEqual(bodies, ['H-9', 'B-9']);
});

test('task error surfaces the engine code, a friendly message and the task ids', async () => {
  const fake = fakeYouCam({ taskResult: () => ({ task_status: 'error', error: 'error_hair_too_short', error_message: 'hair too short' }) });
  const yc = client(fake);
  const look = getLook('tapered-fade');
  await assert.rejects(
    yc.applyLook({ lookId: look.id, steps: planSteps(look, {}) }, selfie()),
    (err) => {
      assert.ok(err instanceof YouCamError);
      assert.equal(err.code, 'error_hair_too_short');
      assert.equal(err.httpStatus, 422);
      assert.match(err.userMessage, /too short/);
      assert.deepEqual(err.taskIds, ['TASK-1']);
      return true;
    },
  );
});

test('bad API key -> InvalidApiKey (503 for our API)', async () => {
  const fake = fakeYouCam();
  const yc = new YouCamClient({ apiKey: 'wrong', fetch: fake.fetch, sleep: noSleep });
  await assert.rejects(yc.uploadImage(tinyJpeg()), (err) => err.code === 'InvalidAccessToken' && err.httpStatus === 503);
  const fake2 = fakeYouCam({ intercept: (c) => (c.path === '/s2s/v2.0/file' ? new Response(JSON.stringify({ status: 401, error: 'Invalid API key' }), { status: 401 }) : null) });
  await assert.rejects(client(fake2).uploadImage(tinyJpeg()), (err) => err.code === 'InvalidApiKey' && err.httpStatus === 503);
});

test('out of units -> CreditInsufficiency', async () => {
  const fake = fakeYouCam({
    intercept: (c) => (c.method === 'POST' && c.path === '/s2s/v2.0/task/beard-style'
      ? new Response(JSON.stringify({ status: 400, error: 'Insufficient unit', error_code: 'CreditInsufficiency' }), { status: 400 })
      : null),
  });
  const look = getLook('anchor-beard');
  await assert.rejects(client(fake).applyLook({ lookId: look.id, steps: planSteps(look, {}) }, selfie()), (err) => {
    assert.equal(err.code, 'CreditInsufficiency');
    assert.equal(err.httpStatus, 503);
    assert.match(err.userMessage, /out of credit/);
    return true;
  });
});

test('polling survives transient 5xx/429 and gives up after the timeout', async () => {
  let failures = 2;
  const fake = fakeYouCam({
    intercept: (c) => {
      if (c.method === 'GET' && c.path.startsWith('/s2s/v2.0/task/beard-style/') && failures-- > 0) {
        return new Response(JSON.stringify({ status: 500, error: 'oops' }), { status: 500 });
      }
      return null;
    },
  });
  const url = await client(fake).waitForTask('beard', 'TASK-X');
  assert.match(url, /results\.example/);

  let t = 0;
  const slow = fakeYouCam({ pollsUntilSuccess: Infinity });
  const yc = client(slow, { now: () => t, sleep: async (ms) => { t += ms; }, pollIntervalMs: 3000, timeoutMs: 30000 });
  await assert.rejects(yc.waitForTask('hair', 'TASK-Y'), (err) => err.code === 'timeout' && err.httpStatus === 504);
  assert.equal(slow.calls.length, 10);
});

test('deleteTask posts the task id and never throws', async () => {
  const fake = fakeYouCam();
  assert.equal(await client(fake).deleteTask('TASK-1'), true);
  const del = fake.calls.at(-1);
  assert.equal(del.path, '/s2s/v2.0/task/delete');
  assert.deepEqual(del.body, { task_id: 'TASK-1' });

  const broken = fakeYouCam({ intercept: () => new Response('{"status":400,"error_code":"OperationInvalid"}', { status: 400 }) });
  assert.equal(await client(broken).deleteTask('TASK-1'), false);
});

test('getUnits sums amount_dec', async () => {
  assert.equal(await client(fakeYouCam()).getUnits(), 990.5);
});

test('MOCK mode returns a bundled image for every look, no network', async () => {
  const mock = createYouCam({ YOUCAM_MOCK: '1' }, { sleep: noSleep });
  assert.ok(mock instanceof MockYouCam);
  for (const look of LOOKS) {
    const out = await mock.applyLook({ lookId: look.id, steps: planSteps(look, {}) }, selfie());
    assert.equal(sniffImageType(out.bytes), 'image/jpeg', look.id);
    assert.ok(out.bytes.length > 1000);
  }
});

test('real mode without a key refuses to start', () => {
  assert.throws(() => createYouCam({ YOUCAM_MOCK: '0' }), /YOUCAM_API_KEY/);
});
