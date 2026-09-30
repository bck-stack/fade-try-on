// HTML for the customer app and Marcus's looks view. Styles are inline; the browser
// code lives in client.js and is serialised into a nonce'd <script>.

import { customerApp, adminApp } from './client.js';

const CSS = `
:root{
  --paper:#f4efe6; --card:#fffaf1; --ink:#141414; --muted:#6b645a; --line:#e2d8c6;
  --brass:#c8a15a; --red:#b8322a; --ok:#2f5d50; --shadow:0 1px 2px rgba(20,20,20,.06),0 8px 24px rgba(20,20,20,.08);
  --radius:18px; color-scheme:light;
}
@media (prefers-color-scheme:dark){
  :root{--paper:#121110; --card:#1c1a17; --ink:#f4efe6; --muted:#a79f92; --line:#2f2b25; --shadow:0 1px 2px rgba(0,0,0,.4); color-scheme:dark}
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;min-height:100vh}
[hidden]{display:none!important}
h1,h2,h3{font-family:ui-serif,Georgia,"Times New Roman",serif;line-height:1.15;margin:0 0 .5rem;letter-spacing:-.01em}
h1{font-size:clamp(1.9rem,6vw,2.6rem)}
h2{font-size:1.35rem}
h3{font-size:1rem;font-family:inherit;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:1.4rem 0 .6rem}
p{margin:0 0 1rem}
button,input{font:inherit;color:inherit}
.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem 16px;background:#141414;color:#f4efe6}
.brand{display:flex;align-items:center;gap:.6rem;text-decoration:none;color:inherit}
.brand b{font-family:ui-serif,Georgia,serif;font-size:1.2rem;letter-spacing:.01em}
.brand small{font-size:.72rem;text-transform:uppercase;letter-spacing:.14em;color:var(--brass);border:1px solid rgba(200,161,90,.5);border-radius:99px;padding:.05rem .5rem}
.pole{width:10px;height:28px;border-radius:5px;background:repeating-linear-gradient(135deg,#b8322a 0 5px,#f4efe6 5px 10px,#1f4e8c 10px 15px,#f4efe6 15px 20px);box-shadow:0 0 0 2px #2a2a2a}
.pill{font-size:.8rem;padding:.2rem .65rem;border-radius:99px;background:rgba(244,239,230,.12);white-space:nowrap}
.pill.low{background:var(--red);color:#fff}
main{max-width:1080px;margin:0 auto;padding:20px 16px 120px}
.screen{animation:fade .25s ease}
@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.eyebrow{font-size:.78rem;text-transform:uppercase;letter-spacing:.14em;color:var(--muted);margin-bottom:.6rem}
.lede{font-size:1.1rem;color:var(--muted);max-width:34rem}
.actions{display:grid;gap:.6rem;margin:1.5rem 0 1rem;max-width:26rem}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;min-height:52px;padding:.7rem 1.2rem;border-radius:14px;border:1.5px solid var(--ink);background:transparent;cursor:pointer;font-weight:600;text-align:center;text-decoration:none;color:var(--ink);transition:transform .1s ease,background .15s}
.btn:active{transform:scale(.98)}
.btn.primary{background:var(--ink);color:var(--paper)}
.btn.ghost{border-style:dashed;border-color:var(--muted);color:var(--muted)}
.btn[disabled]{opacity:.45;cursor:not-allowed}
.btn.small{min-height:36px;padding:.3rem .8rem;font-size:.85rem;border-radius:10px}
.btn.wide{width:100%}
.btn:focus-visible,.look:focus-visible,.chip:focus-visible,.time:focus-visible,.tabs button:focus-visible,.link:focus-visible{outline:3px solid var(--brass);outline-offset:2px}
.tips{display:flex;flex-wrap:wrap;gap:.4rem;padding:0;margin:0 0 1rem;list-style:none}
.tips li{font-size:.85rem;padding:.25rem .7rem;border:1px solid var(--line);border-radius:99px;background:var(--card)}
.privacy{font-size:.9rem;color:var(--muted);display:flex;gap:.5rem;align-items:flex-start;max-width:34rem}
.privacy svg{flex:none;margin-top:.2rem}
.note{font-size:.88rem;color:var(--muted);border-left:3px solid var(--brass);padding:.3rem .8rem;background:var(--card);border-radius:0 10px 10px 0}
.error{color:#fff;background:var(--red);padding:.7rem 1rem;border-radius:12px;font-size:.95rem}
.muted{color:var(--muted);font-size:.9rem}
.link{background:none;border:0;padding:.4rem 0;color:var(--muted);text-decoration:underline;cursor:pointer}
.studio{display:grid;gap:20px}
.studio>*{min-width:0}
@media (min-width:900px){.studio{grid-template-columns:minmax(0,440px) 1fr;align-items:start}.stage-col{position:sticky;top:76px}}
.stage{position:relative}
.compare{position:relative;aspect-ratio:4/5;border-radius:var(--radius);overflow:hidden;background:var(--card);box-shadow:var(--shadow);touch-action:pan-y;user-select:none;-webkit-user-select:none}
.compare img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none}
.compare #after{clip-path:inset(0 0 0 var(--pos,50%))}
.handle{position:absolute;top:0;bottom:0;left:var(--pos,50%);width:3px;margin-left:-1.5px;background:#fff;box-shadow:0 0 8px rgba(0,0,0,.35);pointer-events:none}
.handle::after{content:"\\2039\\00a0\\203A";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:40px;height:40px;border-radius:50%;background:#fff;color:#141414;display:grid;place-items:center;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.3)}
.compare input[type=range]{position:absolute;left:0;right:0;bottom:0;width:100%;opacity:0;height:1px;pointer-events:none}
.compare input[type=range]:focus-visible + .handle{outline:3px solid var(--brass)}
.tag{position:absolute;bottom:12px;font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:.25rem .6rem;border-radius:99px;background:rgba(20,20,20,.75);color:#f4efe6;pointer-events:none}
.tag.l{left:12px}.tag.r{right:12px;background:var(--red)}
.side{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.side figure,.all figure{margin:0;background:var(--card);border-radius:14px;overflow:hidden;box-shadow:var(--shadow)}
.side img,.all img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover}
figcaption{font-size:.82rem;padding:.4rem .6rem;font-weight:600}
.all{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
.all figure{cursor:pointer}.all figure.on{outline:3px solid var(--red)}
.busy{position:absolute;inset:0;border-radius:var(--radius);background:rgba(20,20,20,.62);color:#fff;display:grid;place-content:center;justify-items:center;gap:.8rem;text-align:center;padding:1rem;backdrop-filter:blur(2px)}
.spinner{width:44px;height:44px;border-radius:50%;border:4px solid rgba(255,255,255,.25);border-top-color:#fff;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spinner{animation-duration:3s}.screen{animation:none}}
.tabs{display:flex;gap:4px;margin:12px 0;padding:4px;background:var(--card);border:1px solid var(--line);border-radius:12px}
.tabs button{flex:1;border:0;background:transparent;padding:.5rem;border-radius:9px;font-size:.88rem;font-weight:600;color:var(--muted);cursor:pointer}
.tabs button[aria-selected=true]{background:var(--ink);color:var(--paper)}
.looks{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.look{display:flex;flex-direction:column;align-items:stretch;text-align:left;padding:0;border:1.5px solid var(--line);background:var(--card);border-radius:16px;overflow:hidden;cursor:pointer;transition:border-color .15s,transform .1s}
.look:active{transform:scale(.985)}
.look.on{border-color:var(--red);box-shadow:0 0 0 2px var(--red)}
.look .thumb{aspect-ratio:1/1;background:linear-gradient(135deg,var(--line),transparent);display:grid;place-items:center;overflow:hidden}
.look .thumb img{width:100%;height:100%;object-fit:cover;object-position:50% 30%}
.look .pv{position:relative;display:block;width:100%;height:100%}.look .pv img{opacity:.92}.look .pvtag{position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.62);color:#fff;font-size:11px;letter-spacing:.06em;text-transform:uppercase;padding:3px 7px;border-radius:6px}
.look .ph{font-family:ui-serif,Georgia,serif;font-size:1.05rem;color:var(--muted)}
.look .name{font-weight:700;padding:.6rem .7rem 0;line-height:1.25}
.look .meta{font-size:.8rem;color:var(--muted);padding:0 .7rem}
.look .blurb{font-size:.8rem;padding:.2rem .7rem .7rem;line-height:1.35}
.look.tried .ph{display:none}
@media (max-width:899px){
  .compare{aspect-ratio:auto;height:min(56vh,120vw)}
  .side img{aspect-ratio:3/4}
  .looks{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:10px;margin:0 -16px;padding:2px 16px 10px;scrollbar-width:none}
  .looks::-webkit-scrollbar{display:none}
  .look{flex:0 0 148px;scroll-snap-align:start}
  .look .blurb{display:none}
  .look .meta{padding-bottom:.7rem}
}
.sticky{position:fixed;left:0;right:0;bottom:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:linear-gradient(to top,var(--paper) 70%,transparent);z-index:4}
.sticky .btn{max-width:560px;margin:0 auto;display:flex}
.summary{display:flex;gap:14px;align-items:center;background:var(--card);padding:10px;border-radius:var(--radius);box-shadow:var(--shadow);max-width:560px}
.summary img{width:84px;height:104px;object-fit:cover;border-radius:12px}
.summary p{margin:0;color:var(--muted)}
.book{max-width:560px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips.scroll{flex-wrap:nowrap;overflow-x:auto;padding-bottom:6px;scrollbar-width:thin}
.chip{border:1.5px solid var(--line);background:var(--card);border-radius:12px;padding:.5rem .8rem;cursor:pointer;white-space:nowrap}
.chip.day{display:grid;justify-items:center;min-width:58px;padding:.4rem .5rem}
.chip.day small{font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.chip.day b{font-size:1.15rem}
.chip.on,.time.on{border-color:var(--ink);background:var(--ink);color:var(--paper)}
.chip.on small{color:inherit}
.times{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:8px;margin:12px 0 6px}
.time{border:1.5px solid var(--line);background:var(--card);border-radius:10px;padding:.55rem 0;cursor:pointer;font-weight:600}
form{margin-top:1.2rem;padding:16px;background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow)}
.slot{font-weight:700;font-size:1.1rem;margin:0}
label.field{display:block;margin:.9rem 0 0;font-weight:600;font-size:.9rem}
label.field input{display:block;width:100%;margin-top:.3rem;min-height:48px;padding:.6rem .8rem;border:1.5px solid var(--line);border-radius:12px;background:var(--paper)}
label.field input:focus{outline:none;border-color:var(--ink)}
.consent{display:flex;gap:.7rem;align-items:flex-start;margin:1rem 0;font-size:.9rem}
.consent input{width:22px;height:22px;flex:none;margin-top:.1rem;accent-color:var(--ink)}
.photo-consent{max-width:34rem;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:.7rem .8rem;margin:1.2rem 0 0}
.actions.locked{opacity:.45}
.actions.locked .btn{cursor:not-allowed}
.done{max-width:560px}
.done .look-card{background:var(--card);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);margin:1rem 0}
.done .look-card img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover}
.done .look-card p{margin:0;padding:.7rem 1rem;font-weight:700}
dl{margin:0 0 1rem;background:var(--card);border-radius:var(--radius);padding:.4rem 1rem;box-shadow:var(--shadow)}
.row{display:flex;justify-content:space-between;gap:1rem;padding:.55rem 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
dt{color:var(--muted)}dd{margin:0;text-align:right;font-weight:600}
.done .btns{display:grid;gap:.6rem}
footer{max-width:1080px;margin:0 auto;padding:0 16px 40px;color:var(--muted);font-size:.8rem}
/* admin */
.card{display:grid;grid-template-columns:120px 1fr;gap:14px;background:var(--card);border-radius:var(--radius);padding:10px;box-shadow:var(--shadow);margin-bottom:10px}
.card .pic{aspect-ratio:4/5;border-radius:12px;overflow:hidden;background:var(--line);display:grid;place-items:center;text-align:center}
.card .pic img{width:100%;height:100%;object-fit:cover}
.card p{margin:0 0 .2rem}
.card .time{font-size:1.3rem;font-weight:800;font-family:ui-serif,Georgia,serif;border:0;padding:0;background:none}
.card .who{font-weight:700}
.card .btn{margin-top:.5rem}
h2.day{margin:1.5rem 0 .6rem}
.login{max-width:380px}
/* skin check */
.skin{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 16px;margin:0 0 18px;border-top:4px solid var(--ok)}
.skin h2{margin-bottom:.2rem}
.skin .api{font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:var(--ok);font-weight:700;margin:0 0 .5rem}
.skin h4{margin:.8rem 0 .3rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.skin-head{font-weight:700;font-size:1.05rem;margin-bottom:.6rem}
.skin-busy{display:flex;gap:.6rem;align-items:center;color:var(--muted)}
.spinner.small{width:20px;height:20px;border-width:3px;border-color:var(--line);border-top-color:var(--ink)}
.levels{list-style:none;padding:0;margin:0 0 .7rem;display:grid;grid-template-columns:1fr 1fr;gap:6px}
.lv{display:flex;justify-content:space-between;gap:.4rem;font-size:.85rem;padding:.35rem .6rem;border-radius:10px;border:1px solid var(--line)}
.lv.noticeable{border-color:var(--red);background:rgba(184,50,42,.08)}
.lv.noticeable b{color:var(--red)}
.lv.some b{color:#8a5a00}
.lv.low b{color:var(--ok)}
.skin-finish{margin-bottom:.5rem}
.skin-nudge{font-size:.92rem;border-left:3px solid var(--brass);padding-left:.6rem}
.aftercare{margin:0 0 .6rem;padding-left:1.1rem;font-size:.92rem}
.disclaimer{font-size:.82rem;color:var(--muted);font-style:italic;margin:0}
.small{font-size:.8rem}
.skin-note{font-size:.88rem;background:rgba(47,93,80,.1);border-left:3px solid var(--ok);padding:.25rem .5rem;border-radius:0 8px 8px 0;margin:.3rem 0}
.book-skin{margin:.8rem 0 0;max-width:560px}
`;

const LOCK = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>`;

function shell({ title, description, nonce, body, script }) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#141414">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${CSS}</style>
</head>
<body>
<header class="bar">
  <a class="brand" href="/"><span class="pole" aria-hidden="true"></span><b>Fade &amp; Co.</b><small>Try-On</small></a>
  <span id="tries" class="pill" hidden></span>
</header>
${body}
<script nonce="${nonce}">
// Wrangler's bundler (esbuild keep_names) may wrap inner functions in __name(); define it for the browser.
var __name = function (fn) { return fn; };
(${script.toString()})();
</script>
</body>
</html>`;
}

export function customerPage({ nonce }) {
  const body = `
<main>
  <section id="s-start" class="screen">
    <p class="eyebrow">Fade &amp; Co. · a fictional demo barbershop</p>
    <h1>Check your skin, see the cut, then book it.</h1>
    <p class="lede">One selfie: a quick skin check suggests a gentler guard or finish if your skin looks irritated, then you try the shop's cuts and beard shapes on yourself and book the one you like.</p>
    <label class="consent photo-consent" id="photoConsentRow"><input id="photoConsent" type="checkbox"><span>I'm 18 or over, and I agree to my photo being sent to the YouCam API for the skin check and try-ons. It's deleted from YouCam straight after each result, and never stored here.</span></label>
    <div id="photoActions" class="actions locked">
      <label class="btn primary">Take a selfie<input id="cam" type="file" accept="image/*" capture="user" hidden disabled></label>
      <label class="btn">Upload a photo<input id="pick" type="file" accept="image/*" hidden disabled></label>
      <button id="demo" class="btn ghost" type="button" hidden disabled>Use the demo face</button>
    </div>
    <p id="startErr" class="error" role="alert" hidden></p>
    <ul class="tips" aria-label="Photo tips"><li>Look straight at the camera</li><li>Good light</li><li>Head and shoulders</li><li>Just you</li></ul>
    <p class="privacy">${LOCK}<span>Your selfie is only used for the skin check and try-ons: processed in memory, then deleted. We never store it.</span></p>
    <p id="mockNote" class="note" hidden>Mock mode: results are sample illustrations and no YouCam units are used.</p>
    <p id="offlineNote" class="note" hidden>The diary is offline right now, so prices shown are the usual ones. You can still try looks.</p>
  </section>

  <section id="s-studio" class="screen" hidden>
    <div class="studio">
      <div class="stage-col">
        <div class="stage">
          <div id="view-slider">
            <div id="compare" class="compare">
              <img id="before" alt="Your photo">
              <img id="after" alt="You with the chosen look" hidden>
              <input id="slider" type="range" min="0" max="100" value="50" aria-label="Before and after slider" hidden>
              <div id="handle" class="handle" hidden></div>
              <span id="tagBefore" class="tag l">Your photo</span>
              <span id="tagAfter" class="tag r" hidden>After</span>
            </div>
          </div>
          <div id="view-side" class="side" hidden>
            <figure><img id="sbsBefore" alt="Before"><figcaption>Before</figcaption></figure>
            <figure><img id="sbsAfter" alt="After"><figcaption id="sbsAfterCap">After</figcaption></figure>
          </div>
          <div id="view-all" class="all" hidden><div id="allTried" style="display:contents"></div></div>
          <div id="busy" class="busy" hidden aria-live="polite"><div class="spinner"></div><p id="busyText"></p></div>
        </div>
        <div class="tabs" role="tablist" aria-label="How to compare">
          <button id="tab-slider" role="tab" type="button" aria-selected="true">Slider</button>
          <button id="tab-side" role="tab" type="button" aria-selected="false">Side by side</button>
          <button id="tab-all" role="tab" type="button" aria-selected="false">All tried</button>
        </div>
        <p id="err" class="error" role="alert" hidden></p>
      </div>
      <div>
        <section id="skinCard" class="skin" aria-labelledby="skinTitle">
          <p class="api">YouCam AI Skin Analysis</p>
          <h2 id="skinTitle">Skin check before the cut</h2>
          <div id="skinBody" aria-live="polite"></div>
        </section>
        <h2>Pick a look</h2>
        <p class="muted">Each look is a real Fade &amp; Co. service. Tap one to see it on you; looks you've tried are free to revisit.</p>
        <div id="looks" class="looks"></div>
        <p><button id="changePhoto" class="link" type="button">Use a different photo</button></p>
        <p class="privacy">${LOCK}<span>Your selfie is processed in memory and deleted from YouCam after each try-on and skin check. Results stay on this phone until you close the tab.</span></p>
      </div>
    </div>
    <div class="sticky"><button id="bookBtn" class="btn primary wide" type="button" disabled>Try a look, then book it</button></div>
  </section>

  <section id="s-book" class="screen book" hidden>
    <p><button id="backToStudio" class="link" type="button">← Back to looks</button></p>
    <div class="summary"><img id="bookThumb" alt=""><div><h2 id="bookLook"></h2><p id="bookService"></p></div></div>
    <p id="bookSkin" class="skin-note book-skin" hidden></p>
    <h3>Soonest free</h3>
    <div id="soonest" class="chips"></div>
    <h3>Or pick a day</h3>
    <div id="days" class="chips scroll"></div>
    <div id="times" class="times"></div>
    <p id="timesNote" class="muted"></p>
    <form id="form" hidden novalidate>
      <p class="slot" id="slotText"></p>
      <p class="muted" id="slotDeposit"></p>
      <label class="field">Your name<input id="name" name="name" autocomplete="name" required minlength="2" maxlength="80"></label>
      <label class="field">Mobile number<input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" required placeholder="07…"></label>
      <label class="consent" id="consentRow"><input id="consent" type="checkbox"><span>Send this look<span id="consentSkin" hidden> and my one-line skin-check summary</span> to Marcus so he can see it before I sit down. Only that is kept (never my selfie or skin scores), and it's deleted a week after the appointment.</span></label>
      <button id="confirm" class="btn primary wide" type="submit">Book it</button>
    </form>
    <p id="bookErr" class="error" role="alert" hidden></p>
  </section>

  <section id="s-done" class="screen done" hidden>
    <h1 id="doneTitle">You're booked in.</h1>
    <div class="look-card"><img id="doneImg" alt="Your chosen look"><p>The look: <span id="doneLook"></span></p></div>
    <dl id="doneRows"></dl>
    <p class="note" id="doneNote"></p>
    <div class="btns">
      <a id="saveLook" class="btn" href="#">Save the look to your phone</a>
      <button id="again" class="btn ghost" type="button">Try another look</button>
    </div>
  </section>
</main>
<footer>Fade &amp; Co. is a fictional one-chair barbershop used as a demo customer. Skin check and try-on by the YouCam API. · <a href="/admin" style="color:inherit">Staff</a></footer>`;
  return shell({
    title: 'Fade & Co. Try-On',
    description: "Try Fade & Co.'s cuts and beard shapes on your own face, then book the look.",
    nonce,
    body,
    script: customerApp,
  });
}

export function adminPage({ nonce }) {
  const body = `
<main>
  <section id="login" class="login" hidden>
    <h1>Incoming looks</h1>
    <p class="muted">For Marcus: the looks customers booked, so you can see them before they sit down.</p>
    <form id="loginForm">
      <label class="field">Staff token<input id="token" type="password" autocomplete="current-password" required></label>
      <p id="loginErr" class="error" role="alert" hidden></p>
      <p><button class="btn primary wide" type="submit">Open</button></p>
    </form>
  </section>
  <section id="board" hidden>
    <h1>Incoming looks</h1>
    <p class="muted" id="status"></p>
    <p><button id="refresh" class="btn small" type="button">Refresh</button> <button id="logout" class="link" type="button">Lock</button></p>
    <p id="boardErr" class="error" role="alert" hidden></p>
    <div id="list"></div>
  </section>
</main>`;
  return shell({ title: 'Incoming looks · Fade & Co.', description: 'Staff view of booked try-on looks.', nonce, body, script: adminApp });
}
