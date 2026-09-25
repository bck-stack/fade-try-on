// Browser code for the two pages. Each function is serialised with .toString() into
// the page (see page.js), so it must be fully self-contained: no imports, no
// references to anything outside its own body.

export function customerApp() {
  const $ = (id) => document.getElementById(id);
  const state = {
    config: null,
    selfie: null, // resized JPEG data URL, kept in memory only
    hash: null,
    results: new Map(), // lookId -> result data URL for the current selfie
    current: null,
    view: 'slider',
    busy: false,
    slot: null, // { date, time, day, deposit }
    lastBooking: null,
  };

  // Results (not selfies) are cached in sessionStorage by photo hash + look, so a
  // reload doesn't spend units again. Cleared when the tab closes.
  const resultCache = {
    get(key) {
      try { return sessionStorage.getItem('look:' + key); } catch { return null; }
    },
    set(key, value) {
      try { sessionStorage.setItem('look:' + key, value); } catch { /* full or blocked: memory cache still works */ }
    },
  };

  const money = (n) => '£' + (Number.isInteger(n) ? n : n.toFixed(2));
  const lookById = (id) => state.config.looks.find((l) => l.id === id);
  const dayLabel = (iso, opts) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, opts));

  function show(screen) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== 's-' + screen;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else if (v !== false && v != null) node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  function setError(id, message) {
    const box = $(id);
    box.textContent = message || '';
    box.hidden = !message;
  }

  function updateTries(left) {
    if (typeof left !== 'number') return;
    state.config.triesLeft = left;
    const pill = $('tries');
    pill.hidden = false;
    pill.textContent = left === 1 ? '1 try left' : left + ' tries left';
    pill.classList.toggle('low', left <= 2);
  }

  // ---- photo intake ---------------------------------------------------------

  async function loadBitmap(blob) {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  }

  // Resize to <= 1000px on the long side (hairstyle needs <= 1024, beard < 1024) and
  // re-encode as JPEG. Re-encoding also drops EXIF, including any GPS location.
  async function preparePhoto(blob) {
    const bmp = await loadBitmap(blob);
    const w0 = bmp.width, h0 = bmp.height;
    if (Math.min(w0, h0) < 320) throw new Error('That photo is very small. Try a sharper one.');
    const scale = Math.min(1, 1000 / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w0 * scale);
    canvas.height = Math.round(h0 * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    if (bmp.close) bmp.close();
    const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const buf = await jpeg.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const dataUrl = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(jpeg);
    });
    return { dataUrl, hash };
  }

  async function usePhoto(blob) {
    setError('startErr', '');
    try {
      const { dataUrl, hash } = await preparePhoto(blob);
      state.selfie = dataUrl;
      state.hash = hash;
      state.results = new Map();
      state.current = null;
      for (const look of state.config.looks) {
        const cached = resultCache.get(hash + ':' + look.id);
        if (cached) state.results.set(look.id, cached);
      }
      $('before').src = dataUrl;
      renderLooks();
      renderStage();
      show('studio');
    } catch (err) {
      setError('startErr', err.message && err.message.length < 120 ? err.message : "We couldn't open that photo. Try a JPEG from your camera.");
    }
  }

  // ---- studio ---------------------------------------------------------------

  function renderLooks() {
    const box = $('looks');
    box.replaceChildren();
    for (const look of state.config.looks) {
      const tried = state.results.get(look.id);
      const thumb = tried ? el('img', { src: tried, alt: '' }) : el('span', { class: 'ph', text: look.features.includes('beard') && !look.features.includes('hair') ? 'Beard' : look.features.length > 1 ? 'Cut + beard' : 'Cut' });
      box.append(
        el('button', {
          class: 'look' + (state.current === look.id ? ' on' : '') + (tried ? ' tried' : ''),
          type: 'button',
          'aria-pressed': state.current === look.id ? 'true' : 'false',
          onclick: () => tryLook(look.id),
        },
        el('span', { class: 'thumb' }, thumb),
        el('span', { class: 'name', text: look.name }),
        el('span', { class: 'meta', text: look.service + ' · ' + look.minutes + ' min · ' + money(look.price) }),
        el('span', { class: 'blurb', text: look.blurb })),
      );
    }
  }

  function renderStage() {
    const result = state.current && state.results.get(state.current);
    const look = state.current && lookById(state.current);
    $('after').hidden = !result;
    $('handle').hidden = !result;
    $('slider').hidden = !result;
    $('tagAfter').hidden = !result;
    $('tagBefore').textContent = result ? 'Before' : 'Your photo';
    if (result) {
      $('after').src = result;
      $('tagAfter').textContent = look.name;
    }
    $('sbsBefore').src = state.selfie || '';
    $('sbsAfter').src = result || state.selfie || '';
    $('sbsAfterCap').textContent = look ? look.name : 'Pick a look below';

    const all = $('allTried');
    all.replaceChildren(el('figure', {}, el('img', { src: state.selfie, alt: 'Your photo' }), el('figcaption', { text: 'Before' })));
    for (const [id, src] of state.results) {
      const l = lookById(id);
      all.append(el('figure', { class: id === state.current ? 'on' : '', onclick: () => select(id) }, el('img', { src, alt: l.name }), el('figcaption', { text: l.name + ' · ' + money(l.price) })));
    }

    for (const v of ['slider', 'side', 'all']) {
      $('view-' + v).hidden = state.view !== v;
      $('tab-' + v).setAttribute('aria-selected', String(state.view === v));
    }

    const btn = $('bookBtn');
    btn.disabled = !result;
    btn.textContent = result ? 'Book this look · ' + money(look.price) + ' · ' + look.minutes + ' min' : 'Try a look, then book it';
  }

  function select(id) {
    state.current = id;
    renderLooks();
    renderStage();
  }

  const BUSY_LINES = ['Sending your photo', 'Trying {look} on you', 'Working on the detail', 'Nearly there'];
  let busyTimer = null;
  function setBusy(on, look) {
    state.busy = on;
    $('busy').hidden = !on;
    document.body.classList.toggle('is-busy', on);
    clearInterval(busyTimer);
    if (!on) return;
    let i = 0;
    const line = () => { $('busyText').textContent = BUSY_LINES[Math.min(i++, BUSY_LINES.length - 1)].replace('{look}', look.name) + '…'; };
    line();
    busyTimer = setInterval(line, 5000);
  }

  async function tryLook(id) {
    if (state.busy || !state.selfie) return;
    setError('err', '');
    if (state.results.has(id)) return select(id);
    const look = lookById(id);
    if (state.config.triesLeft <= 0) {
      setError('err', "That's all your free try-ons for today. Book one you've tried, or ask Marcus in the chair.");
      return;
    }
    setBusy(true, look);
    // On phones the preview may be scrolled away while picking from the strip.
    const stageTop = $('busy').getBoundingClientRect().top;
    if (stageTop < 0 || stageTop > window.innerHeight * 0.4) window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      const res = await fetch('/api/try-on', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookId: id, image: state.selfie }),
      });
      const data = await res.json().catch(() => ({}));
      if (typeof data.triesLeft === 'number') updateTries(data.triesLeft);
      if (!res.ok) throw new Error(data.error || 'Something went wrong with the try-on. Please try again.');
      state.results.set(id, data.image);
      resultCache.set(state.hash + ':' + id, data.image);
      select(id);
    } catch (err) {
      setError('err', err.message === 'Failed to fetch' ? 'No connection. Check your signal and try again.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  // Before/after slider: pointer drag on the image, plus a range input for keyboards.
  function setPos(pct) {
    const p = Math.max(0, Math.min(100, pct));
    $('compare').style.setProperty('--pos', p + '%');
    $('slider').value = String(Math.round(p));
  }
  function wireSlider() {
    const box = $('compare');
    let dragging = false;
    const move = (e) => {
      const r = box.getBoundingClientRect();
      setPos(((e.clientX - r.left) / r.width) * 100);
    };
    box.addEventListener('pointerdown', (e) => {
      if ($('after').hidden) return;
      dragging = true;
      box.setPointerCapture(e.pointerId);
      move(e);
    });
    box.addEventListener('pointermove', (e) => { if (dragging) move(e); });
    box.addEventListener('pointerup', () => { dragging = false; });
    box.addEventListener('pointercancel', () => { dragging = false; });
    $('slider').addEventListener('input', (e) => setPos(Number(e.target.value)));
    setPos(50);
  }

  // ---- booking --------------------------------------------------------------

  function openBooking() {
    const look = lookById(state.current);
    state.slot = null;
    $('bookThumb').src = state.results.get(look.id);
    $('bookLook').textContent = look.name;
    $('bookService').textContent = look.service + ' · ' + look.minutes + ' min · ' + money(look.price);
    $('form').hidden = true;
    $('times').replaceChildren();
    $('timesNote').textContent = '';
    setError('bookErr', '');
    $('consentRow').hidden = !state.config.sharing;
    renderDays();
    loadSoonest();
    show('book');
  }

  async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not load times.');
    return data;
  }

  async function loadSoonest() {
    const box = $('soonest');
    box.replaceChildren(el('span', { class: 'muted', text: 'Checking the diary…' }));
    try {
      const data = await getJson('/api/availability?lookId=' + encodeURIComponent(state.current));
      box.replaceChildren();
      for (const d of data.items || []) {
        for (const t of d.first_times.slice(0, 2)) {
          box.append(el('button', { class: 'chip', type: 'button', onclick: () => pickSlot({ date: d.date, time: t, day: d.day, deposit: d.deposit }) },
            el('b', { text: dayLabel(d.date, { weekday: 'short', day: 'numeric' }) }), ' ' + t));
        }
      }
      if (!box.children.length) box.append(el('span', { class: 'muted', text: 'Nothing free in the next few days. Pick a day below or pop in.' }));
    } catch (err) {
      box.replaceChildren(el('span', { class: 'muted', text: err.message }));
    }
  }

  function renderDays() {
    const box = $('days');
    box.replaceChildren();
    const start = new Date((state.config.business.today || new Date().toISOString().slice(0, 10)) + 'T12:00:00Z');
    for (let i = 0; i < 14; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      box.append(el('button', { class: 'chip day', type: 'button', 'data-date': iso, onclick: () => loadTimes(iso) },
        el('small', { text: i === 0 ? 'Today' : dayLabel(iso, { weekday: 'short' }) }),
        el('b', { text: dayLabel(iso, { day: 'numeric' }) })));
    }
  }

  async function loadTimes(date) {
    for (const b of document.querySelectorAll('.chip.day')) b.classList.toggle('on', b.dataset.date === date);
    const box = $('times');
    box.replaceChildren(el('span', { class: 'muted', text: 'Loading times…' }));
    $('timesNote').textContent = '';
    try {
      const data = await getJson('/api/availability?lookId=' + encodeURIComponent(state.current) + '&date=' + date);
      box.replaceChildren();
      for (const t of data.times || []) {
        box.append(el('button', { class: 'time', type: 'button', onclick: () => pickSlot({ date, time: t, day: data.day, deposit: data.deposit }) }, t));
      }
      const notes = [];
      if (data.note) notes.push(data.note);
      if (data.times && data.times.length && data.deposit) notes.push(money(data.deposit) + ' deposit to hold a slot on this day.');
      $('timesNote').textContent = notes.join(' ');
    } catch (err) {
      box.replaceChildren();
      $('timesNote').textContent = err.message;
    }
  }

  function pickSlot(slot) {
    state.slot = slot;
    for (const b of document.querySelectorAll('.time')) b.classList.toggle('on', b.textContent === slot.time);
    $('slotText').textContent = (slot.day || dayLabel(slot.date, { weekday: 'long', day: 'numeric', month: 'long' })) + ' at ' + slot.time;
    $('slotDeposit').textContent = slot.deposit ? money(slot.deposit) + ' deposit on this day.' : '';
    $('form').hidden = false;
    setError('bookErr', '');
    $('name').focus({ preventScroll: true });
    $('form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function submitBooking(e) {
    e.preventDefault();
    if (!state.slot) return;
    const look = lookById(state.current);
    const consent = state.config.sharing && $('consent').checked;
    const btn = $('confirm');
    btn.disabled = true;
    btn.textContent = 'Booking…';
    setError('bookErr', '');
    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lookId: look.id,
          date: state.slot.date,
          time: state.slot.time,
          customer: $('name').value,
          phone: $('phone').value,
          consent,
          image: consent ? state.results.get(look.id) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409) loadTimes(state.slot.date);
        throw new Error(data.error || 'Booking failed. Please try again.');
      }
      renderDone(data, state.results.get(look.id));
    } catch (err) {
      setError('bookErr', err.message === 'Failed to fetch' ? 'No connection. Nothing was booked; try again.' : err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Book it';
    }
  }

  function renderDone(data, image) {
    const b = data.booking;
    const first = String(b.customer || $('name').value).trim().split(/\s+/)[0];
    $('doneTitle').textContent = "You're booked in, " + first + '.';
    $('doneImg').src = image;
    $('doneLook').textContent = data.look.name;
    const rows = [
      ['When', (b.day || b.date) + ' · ' + b.time + (b.ends ? '–' + b.ends : '')],
      ['Service', b.service + ' · ' + money(b.price)],
      ['Where', state.config.business.address || '214 Kingsland Road, Dalston'],
    ];
    if (b.deposit) rows.push(['Deposit', money(b.deposit)]);
    if (b.confirmation_sent_to) rows.push(['Confirmation', 'Sent to ' + b.confirmation_sent_to]);
    rows.push(['Booking ref', '#' + b.booking_id]);
    $('doneRows').replaceChildren(...rows.map(([k, v]) => el('div', { class: 'row' }, el('dt', { text: k }), el('dd', { text: v }))));
    $('doneNote').textContent = data.shared
      ? 'Marcus can see this look before you arrive. We keep only this image, and delete it a week after your appointment.'
      : 'Show this screen to Marcus when you sit down.';
    const save = $('saveLook');
    save.href = image;
    save.download = 'fade-and-co-' + data.look.id + '.jpg';
    show('done');
  }

  // ---- start ----------------------------------------------------------------

  async function init() {
    try {
      const res = await fetch('/api/config');
      state.config = await res.json();
    } catch {
      setError('startErr', "Can't reach Fade & Co. right now. Check your connection and reload.");
      return;
    }
    const c = state.config;
    updateTries(c.triesLeft);
    $('demo').hidden = !c.mock;
    $('mockNote').hidden = !c.mock;
    if (!c.bookingOnline && !c.bookingMock) $('offlineNote').hidden = false;
    for (const id of ['cam', 'pick']) {
      $(id).addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        e.target.value = '';
        if (f) usePhoto(f);
      });
    }
    $('demo').addEventListener('click', async () => {
      const res = await fetch('/demo-selfie.jpg');
      usePhoto(await res.blob());
    });
    $('changePhoto').addEventListener('click', () => show('start'));
    for (const v of ['slider', 'side', 'all']) {
      $('tab-' + v).addEventListener('click', () => { state.view = v; renderStage(); });
    }
    $('bookBtn').addEventListener('click', openBooking);
    $('backToStudio').addEventListener('click', () => show('studio'));
    $('form').addEventListener('submit', submitBooking);
    $('again').addEventListener('click', () => show('studio'));
    wireSlider();
  }

  init();
}

export function adminApp() {
  const $ = (id) => document.getElementById(id);
  const KEY = 'fade-admin-token';
  const token = {
    get() { try { return sessionStorage.getItem(KEY) || ''; } catch { return this.mem || ''; } },
    set(v) { this.mem = v; try { sessionStorage.setItem(KEY, v); } catch { /* memory only */ } },
    clear() { this.mem = ''; try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } },
  };
  const blobUrls = [];

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({}, opts, { headers: { Authorization: 'Bearer ' + token.get() } }));
    if (res.status === 401) {
      token.clear();
      showLogin('That token was not right.');
      throw new Error('unauthorised');
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Request failed');
    }
    return res;
  }

  function showLogin(message) {
    $('login').hidden = false;
    $('board').hidden = true;
    $('loginErr').textContent = message || '';
    $('loginErr').hidden = !message;
  }

  async function image(id) {
    const res = await api('/api/admin/looks/' + encodeURIComponent(id) + '/image');
    const url = URL.createObjectURL(await res.blob());
    blobUrls.push(url);
    return url;
  }

  async function load() {
    $('login').hidden = true;
    $('board').hidden = false;
    $('boardErr').hidden = true;
    try {
      const status = await (await api('/api/admin/status')).json();
      const bits = [];
      if (status.mock) bits.push('Mock mode: sample images, no units used');
      else if (typeof status.units === 'number') bits.push(status.units.toFixed(0) + ' YouCam units left');
      if (status.bookingMock) bits.push('Booking mock on');
      if (!status.storage) bits.push('LOOKS storage is not bound; nothing is being saved');
      $('status').textContent = bits.join(' · ');

      const { looks } = await (await api('/api/admin/looks')).json();
      while (blobUrls.length) URL.revokeObjectURL(blobUrls.pop());
      const list = $('list');
      list.replaceChildren();
      if (!looks.length) {
        list.append(el('p', { class: 'muted', text: 'No try-on bookings yet. When a customer books a look it shows up here.' }));
        return;
      }
      let day = null;
      for (const item of looks) {
        if (item.date !== day) {
          day = item.date;
          list.append(el('h2', { class: 'day', text: item.day || item.date }));
        }
        const pic = el('div', { class: 'pic' }, el('span', { class: 'muted', text: item.hasImage ? 'Loading…' : 'No photo shared' }));
        const card = el('article', { class: 'card' },
          pic,
          el('div', { class: 'info' },
            el('p', { class: 'time', text: item.time + (item.ends ? '–' + item.ends : '') }),
            el('p', { class: 'who', text: item.customer }),
            el('p', { class: 'what', text: item.lookName + ' · ' + item.service }),
            el('p', { class: 'muted', text: 'Booking #' + item.bookingId }),
            el('button', { class: 'btn small', type: 'button', onclick: async () => {
              if (!confirm('Remove this look? The image is deleted.')) return;
              await api('/api/admin/looks/' + encodeURIComponent(item.id), { method: 'DELETE' });
              card.remove();
            } }, 'Done, remove')));
        list.append(card);
        if (item.hasImage) {
          image(item.id).then((src) => pic.replaceChildren(el('img', { src, alt: item.lookName }))).catch(() => {
            pic.replaceChildren(el('span', { class: 'muted', text: 'Image expired' }));
          });
        }
      }
    } catch (err) {
      if (err.message === 'unauthorised') return;
      $('boardErr').textContent = err.message;
      $('boardErr').hidden = false;
    }
  }

  $('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    token.set($('token').value.trim());
    $('token').value = '';
    load();
  });
  $('refresh').addEventListener('click', load);
  $('logout').addEventListener('click', () => { token.clear(); showLogin(); });
  setInterval(() => { if (token.get() && !document.hidden) load(); }, 60000);

  if (token.get()) load();
  else showLogin();
}
