// Your Mates Trade Shop — customer side
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const money = (n) => Number(n).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const round2 = (n) => Math.round(n * 100) / 100;
  const img = (url, w) => url ? url + (url.includes('?') ? '&' : '?') + 'width=' + w : '';
  const ORG_TYPES = ['Community club', 'Sports club', 'Boardriders club', 'School P&C', 'Short-stay host (Airbnb etc.)', 'Event or one-off', 'Other'];
  const UNATT = [
    ['attend', 'Someone will be there to receive it', 'We hand it over and check ID.'],
    ['leave', 'Leave it in a safe spot', "Tell us where. You take responsibility once it's dropped off."],
    ['call', 'Call me before delivering', "If we can't reach you, we take it back and rebook."],
  ];
  const NEED_TIMES = ['', 'by 10am', 'by 12pm', 'by 3pm', 'by 5pm'];
  const SUMUP_SDK = 'https://gateway.sumup.com/gateway/ecom/card/v2/sdk.js';

  // ---------- Dates (Brisbane) ----------
  const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date());
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const wd = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
  const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nice = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${DN[d.getUTCDay()]} ${d.getUTCDate()} ${MN[d.getUTCMonth()]}`; };
  const brisHour = () => Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const leadDays = () => Number(S.settings.lead_days ?? 1) + (brisHour() >= Number(S.settings.cutoff_hour ?? 24) ? 1 : 0);
  function nextDays(days, count) {
    const out = []; let d = addDays(todayISO(), leadDays());
    for (let i = 0; i < 60 && out.length < count; i++, d = addDays(d, 1)) if (days.includes(wd(d))) out.push(d);
    return out;
  }

  // ---------- State ----------
  const S = {
    view: 'loading', authMode: 'login', authMsg: null, busy: false,
    profile: null, products: [], settings: null,
    cart: {}, step: 'order', notes: '', age: false,
    f: { method: 'pickup', date: null, slot: null, address_line: '', suburb: '', postcode: '', need_by: '', need_by_time: '', unattended: 'attend', leave_where: '', delivery_notes: '' },
    checkout: null, payState: 'idle', payMsg: '', lastOrder: null, orders: null,
  };
  const P = () => Object.fromEntries(S.products.map((p) => [p.id, p]));
  const cartKey = () => 'ymt-cart-' + (S.profile?.id || 'x');
  function saveCart() { try { localStorage.setItem(cartKey(), JSON.stringify(S.cart)); } catch (e) {} }
  function loadCart() { try { S.cart = JSON.parse(localStorage.getItem(cartKey()) || '{}') || {}; } catch (e) { S.cart = {}; } }

  let tt;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 2600); }

  // ---------- Totals (display only; the server re-checks everything) ----------
  function lines() {
    const map = P();
    return Object.entries(S.cart).filter(([id, q]) => q > 0 && map[id]).map(([id, q]) => {
      const p = map[id]; q = Math.min(q, p.max_per_order || q);
      return { p, q, line: round2(q * Number(p.price)) };
    });
  }
  function totals() {
    const L = lines(), st = S.settings;
    const goods = round2(L.reduce((a, l) => a + l.line, 0));
    const del = S.f.method === 'delivery' && goods > 0 && goods < Number(st.free_over) ? Number(st.delivery_fee) : 0;
    const fee = S.step === 'order' ? 0 : round2((goods + del) * Number(st.card_fee_pct) / 100);
    const total = round2(goods + del + fee);
    return { L, goods, del, fee, total, gst: round2(total / 11), units: L.reduce((a, l) => a + l.q, 0) };
  }
  const pcOk = (pc) => /^\d{4}$/.test(pc || '') && +pc >= S.settings.pc_from && +pc <= S.settings.pc_to;
  function fulfilProblem() {
    const f = S.f;
    if (f.method === 'pickup') {
      if (!f.date) return 'Choose a pickup day.';
      if (!f.slot) return 'Choose a pickup time.';
    } else {
      if (!f.address_line || !f.suburb) return 'Add the delivery address.';
      if (!pcOk(f.postcode)) return `We deliver to postcodes ${S.settings.pc_from}–${S.settings.pc_to}.`;
      if (!f.date) return 'Choose a preferred delivery day.';
      if (!f.need_by) return 'Tell us the date you need it by.';
      if (f.need_by < f.date) return 'Your preferred day is after the date you need it by. Pick an earlier day.';
      if (f.unattended === 'leave' && !f.leave_where.trim()) return 'Tell us where to leave it.';
    }
    if (!S.age) return 'Tick the 18+ confirmation.';
    return '';
  }

  // ---------- Header ----------
  function renderHeader() {
    const nav = $('#nav'), hr = $('#headRight');
    const signedIn = !!S.profile;
    nav.innerHTML = signedIn
      ? `<button data-act="go-shop" class="${S.view === 'shop' ? 'on' : ''}">Order</button>
         <button data-act="go-account" class="${S.view === 'account' ? 'on' : ''}">My orders</button>
         ${S.profile.is_admin ? '<a href="/admin.html">Admin</a>' : ''}
         <a href="https://yourmatesbrewing.com/">Main site</a>`
      : `<a href="https://yourmatesbrewing.com/">Main site</a><a href="https://yourmatesbrewing.com/pages/contact-us">Contact</a>`;
    if (!signedIn) { hr.innerHTML = ''; return; }
    const t = totals();
    hr.innerHTML = `<span class="who">${esc(S.profile.org_name || S.profile.email)}</span>
      <button class="cart-pill num" data-act="go-shop" aria-label="Your order: ${t.units} items">Order · ${money(t.goods)}</button>
      <button class="link" style="color:#fff" data-act="logout">Log out</button>`;
  }

  // ---------- Views ----------
  function render() {
    renderHeader();
    document.body.classList.toggle('has-mbar', S.view === 'shop' && S.step === 'order');
    const v = { setup: viewSetup, auth: viewAuth, shop: viewShop, account: viewAccount, loading: () => `<div class="loading"><span class="spinner"></span>Loading…</div>` }[S.view];
    app.innerHTML = v();
    if (S.view === 'shop' && S.step === 'pay') mountPayment();
  }

  function viewSetup() {
    return `<div class="wrap" style="padding-block:60px"><div class="panel" style="max-width:620px">
      <h2>Almost ready</h2><p>The trade shop isn't connected to its database yet. Add <b>SUPABASE_URL</b> and <b>SUPABASE_ANON_KEY</b> in Netlify, then redeploy. The setup guide walks through it.</p></div></div>`;
  }

  // ----- Login / sign up -----
  function viewAuth() {
    const m = S.authMode, msg = S.authMsg;
    const banner = msg ? `<div class="note ${msg.kind}" role="alert">${esc(msg.text)}</div>` : '';
    let form;
    if (m === 'check') {
      form = `<h2>Check your email</h2><p>We've sent a link to <b>${esc(S.pendingEmail)}</b>. Click it to confirm your account and you'll come straight back here, logged in.</p>
        <p class="muted small">Nothing there after a few minutes? Check your junk folder, or <button class="link" data-act="auth-mode" data-m="login">go back</button>.</p>`;
    } else if (m === 'forgot') {
      form = `<h2>Reset your password</h2><p class="muted">We'll email you a link to set a new one.</p>
        <form id="fForgot">${banner}<label class="f" for="fe">Email<input id="fe" type="email" required autocomplete="email"></label>
        <button class="btn btn-primary btn-block" ${S.busy ? 'disabled' : ''}>Send reset link</button>
        <button type="button" class="link" data-act="auth-mode" data-m="login">Back to log in</button></form>`;
    } else if (m === 'reset') {
      form = `<h2>Set a new password</h2>
        <form id="fReset">${banner}<label class="f" for="np">New password<input id="np" type="password" minlength="8" required autocomplete="new-password"></label>
        <button class="btn btn-primary btn-block" ${S.busy ? 'disabled' : ''}>Save password</button></form>`;
    } else {
      const tabs = `<div class="tabs" role="tablist">
        <button role="tab" aria-selected="${m === 'login'}" data-act="auth-mode" data-m="login">Log in</button>
        <button role="tab" aria-selected="${m === 'signup'}" data-act="auth-mode" data-m="signup">Create account</button></div>`;
      form = tabs + (m === 'login' ? `
        <form id="fLogin">${banner}
          <label class="f" for="le">Email<input id="le" type="email" required autocomplete="email"></label>
          <label class="f" for="lp">Password<input id="lp" type="password" required autocomplete="current-password"></label>
          <button class="btn btn-primary btn-block" ${S.busy ? 'disabled' : ''}>${S.busy ? '<span class="spinner"></span>' : 'Log in'}</button>
          <button type="button" class="link" data-act="auth-mode" data-m="forgot">Forgot your password?</button>
        </form>` : `
        <form id="fSignup">${banner}
          <p class="muted small" style="margin:0">Free to join. You'll get 15% off shop prices on every order.</p>
          <div class="sub-h">Your organisation</div>
          <label class="f" for="so">Organisation name<input id="so" type="text" required maxlength="120" placeholder="e.g. Kawana Waters Football Club" autocomplete="organization"></label>
          <label class="f" for="st">Type<select id="st">${ORG_TYPES.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
          <div class="sub-h">Contact</div>
          <div class="grid2">
            <label class="f" for="sc">Your name<input id="sc" type="text" required maxlength="80" autocomplete="name"></label>
            <label class="f" for="sp">Phone<input id="sp" type="tel" required maxlength="20" autocomplete="tel"></label>
          </div>
          <label class="f" for="se">Email<input id="se" type="email" required autocomplete="email"></label>
          <label class="f" for="sw">Password<input id="sw" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></label>
          <div class="sub-h">Delivery address <span style="font:400 13px var(--body);text-transform:none">(optional, saves typing later)</span></div>
          <label class="f" for="sa">Street address<input id="sa" type="text" maxlength="200" autocomplete="street-address"></label>
          <div class="grid2">
            <label class="f" for="ss">Suburb<input id="ss" type="text" maxlength="80" autocomplete="address-level2"></label>
            <label class="f" for="sz">Postcode<input id="sz" type="text" inputmode="numeric" maxlength="4" autocomplete="postal-code"></label>
          </div>
          <label class="check" for="s18"><input id="s18" type="checkbox" required><span>I'm 18 or over and I'm ordering for the organisation above.</span></label>
          <button class="btn btn-primary btn-block" ${S.busy ? 'disabled' : ''}>${S.busy ? '<span class="spinner"></span>' : 'Create my trade account'}</button>
        </form>`);
    }
    const tiles = ['https://cdn.shopify.com/s/files/1/0454/1949/5576/files/2025-6-18_Beer_Tiles_Shop-online-02_1.jpg',
      'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/2025-6-18_Beer_Tiles_Shop-online-01_1.jpg',
      'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/GoodTimesTilly_2x_cb0d802e-d8ae-4d67-b7a8-77361de3beae.png',
      'https://cdn.shopify.com/s/files/1/0454/1949/5576/files/HazyDave_2x_ff49ca11-428c-40a5-a9c4-32b2a8d52f01.png'];
    return `<div class="wrap auth">
      <section class="pitch">
        <div class="eyebrow">Your Mates trade shop</div>
        <h1>Beer for your club, school or stay</h1>
        <p class="lede">Order cartons and kegs at trade prices for your next fundraiser, presentation night or guest welcome pack.</p>
        <ul class="perks">
          <li><span class="ico">%</span><span><b>15% off shop prices</b>Applied automatically to every order once you've signed up.</span></li>
          <li><span class="ico">$</span><span><b>Pay by card</b>Secure card payment through SumUp. Tax invoice emailed straight away.</span></li>
          <li><span class="ico">→</span><span><b>Pick up or we deliver</b>Collect from the brewery in Warana, or we deliver across the Sunshine Coast.</span></li>
        </ul>
        <div class="can-row">${tiles.map((u) => `<img src="${img(u, 300)}" alt="" loading="lazy">`).join('')}</div>
      </section>
      <section class="panel auth-card">${form}</section>
    </div>`;
  }

  // ----- Shop -----
  function stepper() {
    const st = ['order', 'fulfil', 'pay', 'done'], names = ['Your order', 'Pickup or delivery', 'Pay', 'Done'];
    const i = st.indexOf(S.step);
    return `<ol class="steps">${names.map((n, k) => `<li class="${k === i ? 'is-on' : k < i ? 'is-done' : ''}"><span class="dot">${k < i ? '✓' : k + 1}</span><span class="lbl">${n}</span></li>`).join('')}</ol>`;
  }
  function viewShop() {
    const p = S.profile;
    if (p.status !== 'active') return `<div class="wrap" style="padding-block:50px"><div class="panel" style="max-width:640px"><h2>Your account is on hold</h2>
      <p>Give us a call on (07) 5329 4733 or email sales@yourmatesbrewing.com and we'll sort it out.</p></div></div>`;
    const head = S.step === 'done' ? '' : `<div class="hello">
        <div><div class="eyebrow">${esc(p.org_type)}</div><h1>G'day, ${esc(p.org_name || p.contact_name || 'mate')}</h1>
        <p>Prices below are your trade prices, GST included.</p></div>
        <span class="tier">${Number(p.discount_pct)}% off shop prices</span></div>${stepper()}`;
    const body = { order: stepOrder, fulfil: stepFulfil, pay: stepPay, done: stepDone }[S.step]();
    return `<div class="wrap">${head}${body}</div>${S.step === 'order' ? mbar() : ''}`;
  }
  function card(p) {
    const q = Math.min(S.cart[p.id] || 0, p.max_per_order || 999), max = p.max_per_order;
    const save = Number(p.shop_price) - Number(p.price);
    return `<article class="card">
      <div class="img"><img src="${esc(img(p.image_url, 600))}" alt="${esc(p.name + ' ' + p.pack)}" loading="lazy" width="600" height="600">
        ${p.is_keg ? '<span class="badge">Keg</span>' : ''}</div>
      <div class="body">
        <div class="t">${esc(p.name)}</div>
        <div class="meta">${esc(p.style)}${Number(p.abv) ? ' · ' + Number(p.abv).toFixed(1) + '%' : ''} · ${esc(p.pack)}</div>
        <div class="pr num"><span class="yours">${money(p.price)}</span>${save > 0 ? `<span class="was">${money(p.shop_price)}</span>` : ''}</div>
        ${max ? `<div class="limit">Max ${max} per order</div>` : ''}
        <div class="foot">${q ? `<div class="qty" role="group" aria-label="Quantity of ${esc(p.name)} ${esc(p.pack)}">
            <button data-act="qty" data-id="${esc(p.id)}" data-d="-1" aria-label="Remove one">−</button>
            <input class="num" id="q-${esc(p.id)}" type="number" min="0" ${max ? `max="${max}"` : ''} inputmode="numeric" value="${q}" data-act="qtyset" data-id="${esc(p.id)}" aria-label="Quantity">
            <button data-act="qty" data-id="${esc(p.id)}" data-d="1" aria-label="Add one" ${max && q >= max ? 'disabled' : ''}>+</button></div>`
          : `<button class="btn btn-primary btn-sm add" data-act="qty" data-id="${esc(p.id)}" data-d="1">Add to order</button>`}</div>
      </div></article>`;
  }
  function stepOrder() {
    const packs = S.products.filter((p) => !p.is_keg), kegs = S.products.filter((p) => p.is_keg);
    if (!S.products.length) return `<div class="panel"><h2>Nothing to order right now</h2><p>Check back soon, or call us on (07) 5329 4733.</p></div>`;
    return `<div class="layout"><div>
      ${packs.length ? `<div class="sec-h"><h2>Cartons</h2><span>${packs.length} on your list</span></div><div class="grid">${packs.map(card).join('')}</div>` : ''}
      ${kegs.length ? `<div class="sec-h"><h2>Kegs</h2><span>Pick up or delivered</span></div><div class="grid">${kegs.map(card).join('')}</div>` : ''}
    </div>${summary()}</div>`;
  }
  function summary() {
    const t = totals(), st = S.settings;
    let action = '';
    if (S.step === 'order') action = `<button class="btn btn-primary btn-block" data-act="step" data-to="fulfil" ${t.units ? '' : 'disabled'}>Pickup or delivery</button>`;
    if (S.step === 'fulfil') {
      const prob = fulfilProblem();
      action = `<button class="btn btn-primary btn-block" data-act="to-pay" ${prob || S.busy ? 'disabled' : ''}>${S.busy ? '<span class="spinner"></span>' : 'Continue to payment'}</button>${prob ? `<p class="hint">${esc(prob)}</p>` : ''}`;
    }
    return `<aside class="panel summary" id="summary"><h3>Your order</h3>
      ${t.L.length ? `<div class="lines num">
        ${t.L.map((l) => `<div class="line"><span class="l">${l.q} × ${esc(l.p.name)} <span class="small">${esc(l.p.pack)}</span></span><span>${money(l.line)}</span></div>`).join('')}
        ${S.step !== 'order' ? `<div class="line"><span class="l">${S.f.method === 'pickup' ? 'Pickup, Warana' : 'Delivery'}</span><span>${t.del ? money(t.del) : 'Free'}</span></div>` : ''}
        ${t.fee ? `<div class="line"><span class="l">Card fee (${Number(st.card_fee_pct)}%)</span><span>${money(t.fee)}</span></div>` : ''}
        <div class="line total"><span class="l">Total</span><span>${money(t.total)}</span></div>
        <div class="line"><span class="l">Includes GST</span><span>${money(t.gst)}</span></div>
      </div>` : `<p class="muted">Nothing in your order yet.</p>`}
      ${S.step === 'order' && t.goods > 0 && t.goods < Number(st.free_over) ? `<p class="hint">Delivery is free on orders over ${money(st.free_over)}.</p>` : ''}
      ${action}</aside>`;
  }
  function mbar() {
    const t = totals();
    return `<div class="mbar"><div><div class="small" style="color:#ccc">${t.units} item${t.units === 1 ? '' : 's'}</div><b class="num">${money(t.goods)}</b></div>
      <button class="btn btn-primary btn-sm" data-act="step" data-to="fulfil" ${t.units ? '' : 'disabled'}>Pickup or delivery</button></div>`;
  }
  function stepFulfil() {
    const f = S.f, st = S.settings;
    const pDays = nextDays(st.pickup_days, 6), dDays = nextDays(st.delivery_days, 4);
    const minNeed = addDays(todayISO(), leadDays());
    let warn = '';
    if (f.method === 'delivery' && f.need_by && dDays.length) {
      if (f.need_by < dDays[0]) warn = `<div class="note bad">Our next delivery run is ${nice(dDays[0])}. If you need it sooner, choose pickup or give us a call.</div>`;
      else if (f.date && f.need_by < f.date) warn = `<div class="note warn">Your preferred day is after the date you need it by. Pick an earlier run.</div>`;
    }
    const pcBad = f.postcode.length === 4 && !pcOk(f.postcode);
    return `<div class="layout"><div>
      <section class="panel"><h2>How do you want it?</h2>
        <div class="choice">
          <button class="opt" data-act="method" data-v="pickup" aria-pressed="${f.method === 'pickup'}"><b>Pick up</b><span>${esc(st.pickup_address)} · free</span></button>
          <button class="opt" data-act="method" data-v="delivery" aria-pressed="${f.method === 'delivery'}"><b>Deliver to us</b><span>${money(st.delivery_fee)}, free over ${money(st.free_over)} · Sunshine Coast</span></button>
        </div>
        ${f.method === 'pickup' ? `
          <span class="lab">Pickup day</span>
          <div class="chips">${pDays.map((d) => `<button class="chip" data-act="date" data-v="${d}" aria-pressed="${f.date === d}">${DN[wd(d)]}<small>${nice(d).slice(4)}</small></button>`).join('')}</div>
          <span class="lab">Time</span>
          <div class="chips">${st.pickup_slots.map((s) => `<button class="chip" data-act="slot" data-v="${esc(s)}" aria-pressed="${f.slot === s}">${esc(s)}</button>`).join('')}</div>
          ${lines().some((l) => l.p.is_keg) ? '<div class="note warn">Kegs weigh 40–65kg. Bring a second person and a vehicle that can carry them.</div>' : ''}
        ` : `
          <span class="lab">Delivery address</span>
          <div class="grid3">
            <label class="f full" for="a1">Street address<input id="a1" type="text" data-f="address_line" value="${esc(f.address_line)}" autocomplete="street-address"></label>
            <label class="f" for="a2" style="grid-column:1/2">Suburb<input id="a2" type="text" data-f="suburb" value="${esc(f.suburb)}" autocomplete="address-level2"></label>
            <label class="f" for="a3">Postcode<input id="a3" type="text" inputmode="numeric" maxlength="4" data-f="postcode" value="${esc(f.postcode)}" autocomplete="postal-code"></label>
          </div>
          <div id="pcmsg">${pcBad ? `<div class="note bad">We deliver to postcodes ${st.pc_from}–${st.pc_to}. Choose pickup, or call us about freight.</div>` : ''}</div>
          <span class="lab">Preferred delivery day</span>
          <div class="chips">${dDays.map((d) => `<button class="chip" data-act="date" data-v="${d}" aria-pressed="${f.date === d}">${DN[wd(d)]}<small>${nice(d).slice(4)}</small></button>`).join('')}</div>
          <span class="lab">Need it by</span>
          <div class="grid2">
            <label class="f" for="nb">Date<input id="nb" type="date" min="${minNeed}" value="${esc(f.need_by)}" data-act="needby"></label>
            <label class="f" for="nt">Time<select id="nt" data-act="needtime">${NEED_TIMES.map((v) => `<option value="${v}" ${f.need_by_time === v ? 'selected' : ''}>${v ? v[0].toUpperCase() + v.slice(1) : 'Any time that day'}</option>`).join('')}</select></label>
          </div>
          ${warn}
          <label class="lab" for="dn">Delivery notes <span class="opt-tag">(optional)</span></label>
          <textarea id="dn" rows="2" data-f="delivery_notes" maxlength="500" placeholder="e.g. Bar cool room through the back gate. Unit 2 is the left driveway.">${esc(f.delivery_notes)}</textarea>
          <span class="lab">If no one's there</span>
          <div class="radios">${UNATT.map(([v, t, s]) => `<label class="radio" for="u-${v}"><input type="radio" name="unatt" id="u-${v}" value="${v}" data-act="unatt" ${f.unattended === v ? 'checked' : ''}><span><b>${t}</b><small>${s}</small></span></label>`).join('')}</div>
          ${f.unattended === 'leave' ? `<label class="lab" for="lw">Where should we leave it?</label><input id="lw" type="text" maxlength="200" data-f="leave_where" value="${esc(f.leave_where)}" placeholder="e.g. Under the carport, behind the bins">` : ''}
        `}
        <label class="lab" for="on">Order notes <span class="opt-tag">(optional)</span></label>
        <textarea id="on" rows="2" maxlength="1000" data-act="notes" placeholder="e.g. Invoice reference: Presentation Night 2026">${esc(S.notes)}</textarea>
        <label class="check" for="age" style="margin-top:18px"><input type="checkbox" id="age" data-act="age" ${S.age ? 'checked' : ''}>
          <span>I'm 18 or over, and whoever collects or receives this order will be 18+ with photo ID.</span></label>
        ${S.payMsg ? `<div class="note bad" role="alert">${esc(S.payMsg)}</div>` : ''}
      </section>
      <button class="btn btn-sm back" data-act="step" data-to="order">← Back to your order</button>
    </div>${summary()}</div>`;
  }
  function fulfilText(f) {
    return f.method === 'pickup' ? `Pickup ${nice(f.date)}, ${f.slot}` : `Delivery ${nice(f.date)}, needed by ${nice(f.need_by)}${f.need_by_time ? ' ' + f.need_by_time : ''}`;
  }
  function stepPay() {
    const c = S.checkout;
    return `<div class="layout"><div>
      <section class="panel"><h2>Pay by card</h2>
        <p class="muted" style="margin:6px 0 0">Order #${c.orderId}${c.checkoutId ? ` · ${esc(fulfilText(S.f))} · <b class="num" style="color:var(--ink)">${money(c.total)}</b>` : ''}</p>
        ${S.payState === 'checking' ? `<div class="loading" style="padding:40px 0"><span class="spinner"></span>Confirming your payment with SumUp…</div>` : ''}
        ${S.payMsg ? `<div class="note ${S.payState === 'failed' ? 'bad' : 'warn'}" role="alert" style="margin-top:14px">${esc(S.payMsg)}</div>` : ''}
        <div id="sumup-card" ${S.payState === 'checking' ? 'hidden' : ''}></div>
        <div class="secure">🔒 Card details go straight to SumUp. We never see or store them.</div>
      </section>
      <button class="btn btn-sm back" data-act="step" data-to="fulfil">← Change pickup or delivery</button>
    </div>${summary()}</div>`;
  }
  function stepDone() {
    const o = S.lastOrder, f = o.fulfilment;
    const rows = f.method === 'pickup'
      ? [['Pickup', `${nice(f.date)}, ${f.slot}`], ['Where', f.pickup_address]]
      : [['Delivery day', nice(f.date)], ['Needed by', nice(f.need_by) + (f.need_by_time ? ', ' + f.need_by_time : '')], ['Address', `${f.address_line}, ${f.suburb} ${f.postcode}`],
         ['If no one\'s there', UNATT.find((u) => u[0] === f.unattended)[1] + (f.unattended === 'leave' ? ': ' + f.leave_where : '')]]
        .concat(f.delivery_notes ? [['Delivery notes', f.delivery_notes]] : []);
    if (o.notes) rows.push(['Order notes', o.notes]);
    return `<section class="panel done-panel">
      <div class="tick">✓</div>
      <h1>Paid. Order #${o.id} is in.</h1>
      <p>A tax invoice is on its way to <b>${esc(o.email)}</b>.</p>
      <dl class="kv num">
        <dt>Items</dt><dd>${o.items.map((i) => `${i.qty} × ${esc(i.name)} ${esc(i.pack)}`).join('<br>')}</dd>
        ${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
        <dt>Paid</dt><dd>${money(o.total)} <span class="muted small">incl. ${money(o.gst)} GST</span></dd>
      </dl>
      <p class="muted small">${f.method === 'pickup' ? "We'll have it packed and ready in the cool room. Ask at the bar when you arrive." : "We'll text or call the day before with a delivery window."}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">
        <button class="btn btn-primary" data-act="new-order">Place another order</button>
        <button class="btn" data-act="go-account">See my orders</button>
      </div></section>`;
  }

  // ----- Account -----
  function viewAccount() {
    const p = S.profile, os = S.orders;
    const STATUS = { pending_payment: 'Not paid', paid: 'Paid · being packed', packed: 'Packed · ready', completed: 'Collected / delivered', cancelled: 'Cancelled', payment_failed: 'Payment failed', needs_review: 'Paid · we\'re checking it' };
    return `<div class="wrap acct">
      <section><h1 style="margin-bottom:14px">My orders</h1>
        ${os === null ? '<div class="loading"><span class="spinner"></span>Loading…</div>' : os.length ? `<div class="olist">${os.map((o) => `
          <article class="orow">
            <div class="top"><b>#${o.id}</b><span class="pill ${o.status}">${STATUS[o.status] || o.status}</span></div>
            <div class="small muted">${new Date(o.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })} · ${esc(fulfilText(o.fulfilment))}</div>
            <div class="small">${o.items.map((i) => `${i.qty} × ${esc(i.name)} ${esc(i.pack)}`).join(', ')}</div>
            <div class="top"><b class="num" style="font:700 16px var(--body)">${money(o.total)}</b>
              <button class="btn btn-sm" data-act="reorder" data-id="${o.id}">Order these again</button></div>
          </article>`).join('')}</div>` : `<p class="muted">No orders yet. <button class="link" data-act="go-shop">Start one</button>.</p>`}
      </section>
      <section class="panel"><h2>Account details</h2>
        <p class="muted small">${esc(p.email)} · ${Number(p.discount_pct)}% off shop prices</p>
        <form id="fProfile" style="display:grid;gap:12px;margin-top:12px">
          <label class="f" for="po">Organisation<input id="po" type="text" maxlength="120" value="${esc(p.org_name)}" required></label>
          <label class="f" for="pt">Type<select id="pt">${ORG_TYPES.map((t) => `<option ${t === p.org_type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <div class="grid2"><label class="f" for="pc">Contact name<input id="pc" type="text" maxlength="80" value="${esc(p.contact_name)}"></label>
          <label class="f" for="pp">Phone<input id="pp" type="tel" maxlength="20" value="${esc(p.phone)}"></label></div>
          <label class="f" for="pa">Delivery address<input id="pa" type="text" maxlength="200" value="${esc(p.address_line)}"></label>
          <div class="grid2"><label class="f" for="ps">Suburb<input id="ps" type="text" maxlength="80" value="${esc(p.suburb)}"></label>
          <label class="f" for="pz">Postcode<input id="pz" type="text" inputmode="numeric" maxlength="4" value="${esc(p.postcode)}"></label></div>
          <button class="btn btn-primary">Save details</button>
        </form></section></div>`;
  }

  // ---------- Payment (SumUp card widget) ----------
  let sdkPromise = null;
  function loadSdk() {
    if (window.SumUpCard) return Promise.resolve();
    sdkPromise = sdkPromise || new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = SUMUP_SDK; s.onload = res; s.onerror = () => { sdkPromise = null; rej(new Error('sdk')); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }
  let mounted = null;
  async function mountPayment() {
    if (S.payState === 'checking' || !S.checkout?.checkoutId) return;
    const el = $('#sumup-card'); if (!el) return;
    try { await loadSdk(); } catch (e) { S.payMsg = "The card form didn't load. Check your connection and refresh the page."; render(); return; }
    try { mounted?.unmount?.(); } catch (e) {}
    mounted = window.SumUpCard.mount({
      id: 'sumup-card',
      checkoutId: S.checkout.checkoutId,
      amount: String(S.checkout.total.toFixed(2)),
      currency: 'AUD', locale: 'en-AU', country: 'AU',
      showSubmitButton: true, showEmail: false,
      onResponse: (type, body) => {
        if (type === 'success') confirmPayment(S.checkout.orderId);
        else if (type === 'fail') { S.payState = 'failed'; S.payMsg = 'The payment didn\'t go through. Check the card details and try again, or use another card.'; render(); }
        else if (type === 'error') { S.payState = 'failed'; S.payMsg = 'The card form hit a problem. Try again, or refresh the page.'; render(); }
      },
    });
  }
  async function confirmPayment(orderId) {
    S.payState = 'checking'; S.payMsg = ''; render();
    for (let i = 0; i < 8; i++) {
      try {
        const r = await SB.api('confirm-payment', { orderId });
        if (r.status === 'paid' || r.order?.status === 'paid' || r.order?.status === 'packed' || r.order?.status === 'completed') {
          S.lastOrder = r.order; S.cart = {}; saveCart(); S.step = 'done'; S.payState = 'idle'; S.checkout = null; S.age = false; S.notes = '';
          render(); scrollTo(0, 0); return;
        }
        if (r.status === 'review') {
          S.lastOrder = r.order; S.cart = {}; saveCart(); S.checkout = null; S.payState = 'failed'; S.step = 'pay';
          S.payMsg = `We've received your payment for order #${orderId}, but we need to check it before we confirm. We'll be in touch today. Please don't pay again.`;
          render(); return;
        }
        if (r.status === 'failed') { S.payState = 'failed'; S.payMsg = 'The payment was declined. Try again or use another card.'; render(); return; }
      } catch (e) { /* keep trying */ }
      await new Promise((res) => setTimeout(res, 2000));
    }
    S.payState = 'failed';
    S.payMsg = "We're still waiting for SumUp to confirm. If your card was charged, your order is safe and we'll email the invoice. Otherwise, try again.";
    render();
  }

  // ---------- Data ----------
  async function loadAccount() {
    const user = await SB.user();
    const [profile] = await SB.rest(`profiles?id=eq.${user.id}&select=*`);
    if (!profile) throw new Error('no profile');
    S.profile = profile;
    const [products, settings] = await Promise.all([SB.rpc('my_price_list'), SB.rest('settings?id=eq.1&select=*')]);
    S.products = products || []; S.settings = settings[0];
    loadCart();
    const f = S.f;
    if (!f.address_line) Object.assign(f, { address_line: profile.address_line, suburb: profile.suburb, postcode: profile.postcode });
  }
  async function loadOrders() {
    S.orders = null; render();
    S.orders = await SB.rest('orders?select=*&status=in.(paid,packed,completed,cancelled,needs_review)&order=created_at.desc&limit=50');
    render();
  }

  // ---------- Events ----------
  function setQty(id, q) {
    const p = P()[id]; if (!p) return;
    const max = p.max_per_order || 999;
    q = Math.max(0, Math.min(max, Math.floor(Number(q) || 0)));
    if (p.max_per_order && Number(S.cart[id] || 0) < q && q === max) toast(`${p.name} ${p.pack} is limited to ${max} per order`);
    if (q) S.cart[id] = q; else delete S.cart[id];
    saveCart();
  }
  function refreshSummary() {
    const s = $('#summary'); if (s) s.outerHTML = summary();
    const m = $('.mbar'); if (m) m.outerHTML = mbar();
    renderHeader();
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'auth-mode') { S.authMode = b.dataset.m; S.authMsg = null; render(); }
    else if (a === 'logout') { await SB.signOut(); location.href = '/'; }
    else if (a === 'go-shop') { S.view = 'shop'; if (S.step === 'done') S.step = 'order'; render(); scrollTo(0, 0); }
    else if (a === 'go-account') { S.view = 'account'; loadOrders(); scrollTo(0, 0); }
    else if (a === 'qty') {
      const id = b.dataset.id; const before = S.cart[id] || 0;
      setQty(id, before + Number(b.dataset.d));
      const cardEl = b.closest('.card');
      if (cardEl) cardEl.outerHTML = card(P()[id]);
      refreshSummary();
      if (!before && S.cart[id]) $('#q-' + CSS.escape(id))?.focus();
    }
    else if (a === 'step') { S.step = b.dataset.to; S.payMsg = ''; S.payState = 'idle'; render(); scrollTo(0, 0); }
    else if (a === 'method') { S.f.method = b.dataset.v; S.f.date = null; render(); }
    else if (a === 'date') { S.f.date = b.dataset.v; render(); }
    else if (a === 'slot') { S.f.slot = b.dataset.v; render(); }
    else if (a === 'to-pay') {
      if (fulfilProblem()) return;
      S.busy = true; S.payMsg = ''; refreshSummary();
      try {
        const r = await SB.api('create-checkout', { items: S.cart, fulfilment: S.f, notes: S.notes, age_confirmed: S.age });
        S.checkout = r; S.step = 'pay'; S.payState = 'idle';
      } catch (err) {
        S.payMsg = err.message;
        if (err.status === 401) { await SB.signOut(); location.reload(); return; }
      }
      S.busy = false; render(); scrollTo(0, 0);
    }
    else if (a === 'new-order') { S.step = 'order'; S.lastOrder = null; render(); scrollTo(0, 0); }
    else if (a === 'reorder') {
      const o = S.orders.find((x) => String(x.id) === b.dataset.id); const map = P(); let skipped = 0;
      S.cart = {};
      o.items.forEach((i) => { if (map[i.product_id]) setQty(i.product_id, i.qty); else skipped++; });
      saveCart(); S.view = 'shop'; S.step = 'order'; render(); scrollTo(0, 0);
      toast(skipped ? `Added to your order. ${skipped} item${skipped > 1 ? 's aren\'t' : ' isn\'t'} available right now.` : 'Added to your order. Check the quantities, then continue.');
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target, a = el.dataset.act;
    if (a === 'age') { S.age = el.checked; refreshSummary(); }
    else if (a === 'needby') { S.f.need_by = el.value; render(); }
    else if (a === 'needtime') { S.f.need_by_time = el.value; }
    else if (a === 'unatt') { S.f.unattended = el.value; render(); }
    else if (a === 'qtyset') { setQty(el.dataset.id, el.value); const c = el.closest('.card'); if (c) c.outerHTML = card(P()[el.dataset.id]); refreshSummary(); }
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.f) {
      S.f[el.dataset.f] = el.value;
      if (el.dataset.f === 'postcode') {
        const pc = el.value; const m = $('#pcmsg');
        if (m) m.innerHTML = pc.length === 4 && !pcOk(pc) ? `<div class="note bad">We deliver to postcodes ${S.settings.pc_from}–${S.settings.pc_to}. Choose pickup, or call us about freight.</div>` : '';
      }
      refreshSummary();
    } else if (el.dataset.act === 'notes') S.notes = el.value;
  });

  document.addEventListener('submit', async (e) => {
    const id = e.target.id; if (!['fLogin', 'fSignup', 'fForgot', 'fReset', 'fProfile'].includes(id)) return;
    e.preventDefault();
    // Read every field before re-rendering (re-rendering replaces the form)
    const vals = {}; e.target.querySelectorAll('input, select, textarea').forEach((el) => { if (el.id) vals[el.id] = el.value; });
    const v = (x) => String(vals[x] ?? '').trim();
    S.busy = true; S.authMsg = null;
    if (id !== 'fProfile') render();
    try {
      if (id === 'fLogin') { await SB.signIn({ email: v('le'), password: vals.lp }); await enterShop(); return; }
      if (id === 'fSignup') {
        const r = await SB.signUp({ email: v('se'), password: vals.sw, data: {
          org_name: v('so'), org_type: v('st'), contact_name: v('sc'), phone: v('sp'), address_line: v('sa'), suburb: v('ss'), postcode: v('sz') } });
        if (SB.session) { await enterShop(); toast('Welcome aboard. Your 15% trade discount is on.'); return; }
        S.pendingEmail = v('se'); S.authMode = 'check';
        if (r && Array.isArray(r.identities) && r.identities.length === 0) { S.authMode = 'login'; S.authMsg = { kind: 'warn', text: "There's already an account with that email. Log in, or reset your password." }; }
      }
      if (id === 'fForgot') { await SB.resetPassword(v('fe')); S.authMode = 'login'; S.authMsg = { kind: 'good', text: 'If that email has an account, a reset link is on its way.' }; }
      if (id === 'fReset') { await SB.updatePassword(vals.np); toast('Password saved'); await enterShop(); return; }
      if (id === 'fProfile') {
        const body = { org_name: v('po'), org_type: v('pt'), contact_name: v('pc'), phone: v('pp'), address_line: v('pa'), suburb: v('ps'), postcode: v('pz') };
        const [p] = await SB.rest(`profiles?id=eq.${S.profile.id}`, { method: 'PATCH', body, prefer: 'return=representation' });
        S.profile = p; S.busy = false; toast('Details saved'); render(); return;
      }
    } catch (err) {
      S.authMsg = { kind: 'bad', text: err.message };
      if (id === 'fProfile') toast(err.message);
    }
    S.busy = false; render();
  });

  async function enterShop() {
    S.busy = false;
    try {
      await loadAccount();
      S.view = 'shop';
      const paid = new URLSearchParams(location.search).get('paid');
      if (paid) {
        history.replaceState(null, '', '/');
        S.checkout = { orderId: Number(paid), checkoutId: null, total: 0 }; S.step = 'pay'; S.payState = 'checking'; render();
        confirmPayment(Number(paid)); return;
      }
    } catch (e) {
      console.error(e);
      await SB.signOut();
      S.view = 'auth'; S.authMode = 'login'; S.authMsg = { kind: 'bad', text: "We couldn't load your account. Log in again, or call us if it keeps happening." };
    }
    render(); scrollTo(0, 0);
  }

  // ---------- Start ----------
  (async function start() {
    if (!SB.configured) { S.view = 'setup'; render(); return; }
    const h = SB.readHash();
    if (h?.error) { S.view = 'auth'; S.authMode = 'forgot'; S.authMsg = { kind: 'bad', text: h.error }; render(); return; }
    if (h?.type === 'recovery') { S.view = 'auth'; S.authMode = 'reset'; render(); return; }
    if (SB.session) { await enterShop(); if (h?.type === 'signup') toast('Email confirmed. Your 15% trade discount is on.'); return; }
    S.view = 'auth'; render();
  })();
})();
