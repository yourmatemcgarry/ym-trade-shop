// Your Mates Trade Shop — admin
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const money = (n) => Number(n).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const img = (url, w) => url ? url + (url.includes('?') ? '&' : '?') + 'width=' + w : '';
  const DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nice = (iso) => { if (!iso) return ''; const d = new Date(iso + 'T00:00:00Z'); return `${DN[d.getUTCDay()]} ${d.getUTCDate()} ${MN[d.getUTCMonth()]}`; };
  const when = (ts) => new Date(ts).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Brisbane' });
  const UNATT = { attend: 'Someone will receive it', leave: 'Leave in a safe spot', call: 'Call before delivering' };
  const STATUS = { pending_payment: 'Awaiting payment', payment_failed: 'Payment failed', abandoned: 'Abandoned', paid: 'Paid · to pack', packed: 'Packed', completed: 'Collected / delivered', cancelled: 'Cancelled', needs_review: 'Paid · needs review' };
  const FILTERS = [['review', 'Needs review', ['needs_review']], ['paid', 'To pack', ['paid']], ['packed', 'Packed', ['packed']], ['completed', 'Completed', ['completed']],
    ['unpaid', 'Awaiting payment', ['pending_payment', 'payment_failed']], ['cancelled', 'Cancelled', ['cancelled']], ['all', 'All', ['needs_review', 'paid', 'packed', 'completed', 'pending_payment', 'payment_failed', 'cancelled']]];
  const TIERS = [15, 20, 25];

  const S = { tab: 'orders', me: null, orders: [], filter: 'paid', products: [], profiles: [], settings: null,
    editSku: null, custId: null, custSearch: '', overrides: [], confirmCancel: null, loaded: false };

  let tt;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 2600); }
  async function guard(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { console.error(e); toast(e.message || 'That didn\'t save. Try again.'); throw e; } }

  // ---------- Render ----------
  function render() {
    $('#headRight').innerHTML = S.me ? `<span class="who">${esc(S.me.email)}</span><button class="link" style="color:#fff" data-act="logout">Log out</button>` : '';
    if (!S.me) return;
    const tabs = [['orders', 'Orders'], ['skus', 'Master SKU list'], ['customers', 'Customers & prices'], ['settings', 'Delivery & fees']];
    app.innerHTML = `<nav class="atabs">${tabs.map(([k, n]) => `<a href="#${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${n}</a>`).join('')}</nav>
      ${S.loaded ? { orders: tabOrders, skus: tabSkus, customers: tabCustomers, settings: tabSettings }[S.tab]() : '<div class="loading"><span class="spinner"></span>Loading…</div>'}`;
  }

  // ----- Orders -----
  function fulfilCell(o) {
    const f = o.fulfilment || {};
    if (f.method === 'pickup') return `<b>Pickup</b> ${nice(f.date)}<div class="sub">${esc(f.slot)}</div>`;
    return `<b>Delivery</b> ${nice(f.date)}
      <div class="sub">Needed by ${nice(f.need_by)}${f.need_by_time ? ', ' + esc(f.need_by_time) : ''}</div>
      <div class="sub">${esc(f.address_line)}, ${esc(f.suburb)} ${esc(f.postcode)}</div>
      <div class="sub">${esc(UNATT[f.unattended] || '')}${f.unattended === 'leave' ? ': ' + esc(f.leave_where) : ''}</div>
      ${f.delivery_notes ? `<div class="onote">Delivery: ${esc(f.delivery_notes)}</div>` : ''}`;
  }
  function tabOrders() {
    const counts = Object.fromEntries(FILTERS.map(([k, , st]) => [k, S.orders.filter((o) => st.includes(o.status)).length]));
    const st = FILTERS.find((f) => f[0] === S.filter)[2];
    const list = S.orders.filter((o) => st.includes(o.status));
    const ymB = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit' }).format(new Date(d));
    const ym = ymB(Date.now());
    const month = S.orders.filter((o) => o.paid_at && ymB(o.paid_at) === ym && ['paid', 'packed', 'completed'].includes(o.status)).reduce((a, o) => a + Number(o.total), 0);
    return `<div class="kpis">
        <div class="kpi"><div class="k">To pack</div><div class="v num">${counts.paid}</div></div>
        <div class="kpi"><div class="k">Packed, waiting</div><div class="v num">${counts.packed}</div></div>
        <div class="kpi"><div class="k">Paid this month</div><div class="v num">${money(month)}</div></div>
        <div class="kpi"><div class="k">Trade accounts</div><div class="v num">${S.profiles.filter((p) => !p.is_admin).length}</div></div>
      </div>
      ${counts.review ? `<div class="note bad" style="margin-bottom:14px"><b>${counts.review} paid order${counts.review > 1 ? 's need' : ' needs'} checking.</b> The money came through but something didn't line up. Open <button class="link" data-act="filter" data-v="review">Needs review</button>.</div>` : ''}
      <div class="filters">${FILTERS.filter(([k]) => k !== 'review' || counts.review).map(([k, n]) => `<button class="fchip" data-act="filter" data-v="${k}" aria-pressed="${S.filter === k}">${n}<span class="c">${counts[k]}</span></button>`).join('')}
        <button class="btn btn-sm" data-act="reload" style="margin-left:auto">Refresh</button></div>
      <div class="tbl">${list.length ? `<table>
        <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Pickup / delivery</th><th class="r">Total</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map((o) => {
          const next = o.status === 'paid' ? ['packed', 'Mark packed'] : o.status === 'packed' ? ['completed', 'Mark complete'] : o.status === 'needs_review' ? ['paid', 'Fulfil it'] : null;
          const canCancel = ['paid', 'packed', 'needs_review'].includes(o.status);
          return `<tr>
          <td class="num"><b>#${o.id}</b><div class="sub">${when(o.created_at)}</div></td>
          <td>${esc(o.org_name)}<div class="sub">${esc(o.email)}</div></td>
          <td>${o.items.map((i) => `${i.qty} × ${esc(i.name)} <span class="sub">${esc(i.pack)}</span>`).join('<br>')}${o.notes ? `<div class="onote">${esc(o.notes)}</div>` : ''}</td>
          <td>${fulfilCell(o)}</td>
          <td class="r num">${money(o.total)}${Number(o.delivery_fee) ? `<div class="sub">incl. ${money(o.delivery_fee)} delivery</div>` : ''}</td>
          <td><span class="pill ${o.status}">${STATUS[o.status]}</span>${o.review_reason && o.status === 'needs_review' ? `<div class="sub" style="max-width:200px;margin-top:4px">${esc(o.review_reason)}</div>` : ''}</td>
          <td><div class="acts">
            ${next ? `<button class="btn btn-sm btn-primary" data-act="ostatus" data-id="${o.id}" data-v="${next[0]}">${next[1]}</button>` : ''}
            ${canCancel ? (S.confirmCancel === o.id
              ? `<button class="btn btn-sm btn-dark" data-act="ostatus" data-id="${o.id}" data-v="cancelled">Confirm cancel</button>`
              : `<button class="btn btn-sm" data-act="askcancel" data-id="${o.id}">Cancel</button>`) : ''}
          </div>${S.confirmCancel === o.id ? '<div class="sub" style="text-align:right;margin-top:4px">Refund the card in SumUp separately.</div>' : ''}</td></tr>`; }).join('')}</tbody></table>`
        : `<div class="empty">No orders here.</div>`}</div>`;
  }

  // ----- SKUs -----
  function skuEditForm(p, isNew) {
    const v = (k, d = '') => esc(p ? p[k] ?? d : d);
    return `<form class="eform" id="${isNew ? 'fNewSku' : 'fEditSku'}" data-id="${v('id')}">
      <label class="f">Beer name<input name="name" type="text" required value="${v('name')}"></label>
      <label class="f">Style<input name="style" type="text" value="${v('style')}"></label>
      <label class="f">ABV %<input name="abv" type="number" step="0.1" min="0" value="${v('abv', '')}"></label>
      <label class="f">Pack<input name="pack" type="text" required value="${v('pack')}" placeholder="16-pack cans or 30L keg"></label>
      <label class="f">SKU code<input name="sku" type="text" required value="${v('sku')}" placeholder="YMB-NAME-16"></label>
      <label class="f">Shop price (incl. GST)<input name="shop_price" type="number" step="0.01" min="0" required value="${v('shop_price')}"></label>
      <label class="f">Max per order<input name="max_per_order" type="number" min="1" value="${v('max_per_order')}" placeholder="No limit"></label>
      <label class="f">Sort order<input name="sort" type="number" value="${v('sort', '100')}"></label>
      <label class="f wide">Image URL <span class="sub">(copy from the product in Shopify)</span><input name="image_url" type="url" value="${v('image_url')}" placeholder="https://cdn.shopify.com/…"></label>
      <label class="check" style="align-self:end"><input name="is_keg" type="checkbox" ${p?.is_keg ? 'checked' : ''}><span>This is a keg</span></label>
      <label class="check" style="align-self:end"><input name="active" type="checkbox" ${!p || p.active ? 'checked' : ''}><span>On sale</span></label>
      <div class="full" style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm">${isNew ? 'Add SKU' : 'Save'}</button>
        ${isNew ? '' : '<button type="button" class="btn btn-sm" data-act="sku-cancel">Cancel</button>'}
      </div></form>`;
  }
  function tabSkus() {
    const on = S.products.filter((p) => p.active), lim = on.filter((p) => p.max_per_order);
    return `<p class="muted" style="max-width:70ch;margin-top:0">Untick <b>On sale</b> and a SKU disappears from every customer straight away. Set a max per order to stretch stock that's running low. Each customer's own prices are kept, so switching back on restores everything.</p>
      <div class="kpis">
        <div class="kpi"><div class="k">On sale</div><div class="v num">${on.length}</div></div>
        <div class="kpi"><div class="k">Limited</div><div class="v num">${lim.length}</div></div>
        <div class="kpi"><div class="k">Switched off</div><div class="v num">${S.products.length - on.length}</div></div>
        <div class="kpi"><div class="k">Total SKUs</div><div class="v num">${S.products.length}</div></div>
      </div>
      <div class="tbl"><table>
        <thead><tr><th>On sale</th><th></th><th>Product</th><th>SKU</th><th class="r">Shop price</th><th class="r">Max per order</th><th></th></tr></thead>
        <tbody>${S.products.map((p) => S.editSku === p.id ? `<tr class="editrow"><td colspan="7">${skuEditForm(p, false)}</td></tr>` : `
          <tr class="${p.active ? '' : 'row-off'}">
            <td><input class="toggle" type="checkbox" data-act="sku-active" data-id="${esc(p.id)}" ${p.active ? 'checked' : ''} aria-label="${esc(p.name)} ${esc(p.pack)} on sale"></td>
            <td><img class="thumb" src="${esc(img(p.image_url, 100))}" alt=""></td>
            <td><b>${esc(p.name)}</b> ${p.is_keg ? '<span class="pill">Keg</span>' : ''}<div class="sub">${esc(p.style)}${Number(p.abv) ? ' · ' + Number(p.abv).toFixed(1) + '%' : ''} · ${esc(p.pack)}</div></td>
            <td class="sub num">${esc(p.sku)}</td>
            <td class="r"><input class="cell-in num" type="number" step="0.01" min="0" value="${p.shop_price}" data-act="sku-price" data-id="${esc(p.id)}" aria-label="Shop price"></td>
            <td class="r"><input class="cell-in num" type="number" min="1" placeholder="No limit" value="${p.max_per_order ?? ''}" data-act="sku-max" data-id="${esc(p.id)}" aria-label="Max per order"></td>
            <td class="r"><button class="btn btn-sm" data-act="sku-edit" data-id="${esc(p.id)}">Edit</button></td>
          </tr>`).join('')}</tbody></table></div>
      <section class="panel" style="margin-top:20px"><h2>Add a new SKU</h2>
        <p class="muted small" style="margin:4px 0 14px">New SKUs go on sale to every customer at their discount tier as soon as you add them.</p>
        ${skuEditForm(null, true)}</section>`;
  }

  // ----- Customers -----
  const custPrice = (p, c, o) => o && o.price != null ? Number(o.price) : Math.round(Number(p.shop_price) * (1 - Number(c.discount_pct) / 100));
  function tabCustomers() {
    const q = S.custSearch.toLowerCase();
    const list = S.profiles.filter((p) => !q || [p.org_name, p.email, p.contact_name, p.suburb].join(' ').toLowerCase().includes(q));
    const c = S.profiles.find((p) => p.id === S.custId);
    const ov = Object.fromEntries(S.overrides.map((o) => [o.product_id, o]));
    return `<div class="cgrid"><div>
        <label class="f" for="cs" style="margin-bottom:10px">Search<input id="cs" type="text" data-act="csearch" value="${esc(S.custSearch)}" placeholder="Name, email or suburb"></label>
        <div class="clist">${list.map((p) => `<button class="citem" data-act="cust" data-id="${p.id}" aria-pressed="${p.id === S.custId}">
          <b>${esc(p.org_name || p.email)} ${p.status === 'suspended' ? '<span class="pill suspended">On hold</span>' : ''}${p.is_admin ? ' <span class="pill">Admin</span>' : ''}</b>
          <span>${esc(p.org_type)} · ${Number(p.discount_pct)}% off · joined ${new Date(p.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span></button>`).join('') || '<div class="empty">No matches.</div>'}</div>
      </div><div>
      ${!c ? '<div class="panel empty">Pick a customer to see their prices.</div>' : `
        <section class="panel">
          <div class="chead"><div><h2>${esc(c.org_name || c.email)}</h2>
            <div class="sub" style="margin-top:4px">${esc(c.org_type)} · ${esc(c.contact_name)} · ${esc(c.email)} · ${esc(c.phone)}</div>
            ${c.address_line ? `<div class="sub">${esc(c.address_line)}, ${esc(c.suburb)} ${esc(c.postcode)}</div>` : ''}</div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="pill ${c.status === 'active' ? 'on' : 'suspended'}">${c.status === 'active' ? 'Active' : 'On hold'}</span>
              <button class="btn btn-sm ${c.status === 'active' ? '' : 'btn-primary'}" data-act="cstatus" data-v="${c.status === 'active' ? 'suspended' : 'active'}">${c.status === 'active' ? 'Put on hold' : 'Reactivate'}</button>
            </div></div>
          <div class="tierbar"><b style="margin-right:4px">Discount tier</b>
            ${TIERS.map((t) => `<button class="btn btn-sm" data-act="tier" data-v="${t}" aria-pressed="${Number(c.discount_pct) === t}">${t}% off</button>`).join('')}
            <label class="sub" style="display:flex;align-items:center;gap:6px">Custom <input class="cell-in num" type="number" min="0" max="60" step="0.5" value="${Number(c.discount_pct)}" data-act="tier-custom" style="width:70px">%</label>
            <span class="sub">Rounded to the nearest dollar. Choosing a tier clears custom prices.</span>
          </div>
          <div class="tbl"><table>
            <thead><tr><th>Show</th><th>Product</th><th class="r">Shop</th><th class="r">Their price</th><th class="r">Off</th><th></th></tr></thead>
            <tbody>${S.products.map((p) => { const o = ov[p.id]; const hidden = o?.hidden; const pr = custPrice(p, c, o); const off = Math.round((1 - pr / p.shop_price) * 100);
              return `<tr class="${!p.active || hidden ? 'row-off' : ''}">
                <td><input class="toggle" type="checkbox" data-act="c-show" data-id="${esc(p.id)}" ${hidden ? '' : 'checked'} aria-label="Show ${esc(p.name)} to this customer"></td>
                <td><b>${esc(p.name)}</b> <span class="sub">${esc(p.pack)}</span>${p.active ? '' : ' <span class="pill off">Off for everyone</span>'}</td>
                <td class="r num">${money(p.shop_price)}</td>
                <td class="r"><input class="cell-in num" type="number" step="0.5" min="0" value="${pr}" data-act="c-price" data-id="${esc(p.id)}" aria-label="Price for ${esc(p.name)}">${o?.price != null ? '<span class="custom-tag">custom</span>' : ''}</td>
                <td class="r num sub">${off > 0 ? off + '%' : '—'}</td>
                <td class="r">${o?.price != null ? `<button class="link" data-act="c-reset" data-id="${esc(p.id)}">Reset</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
          <label class="f" for="anotes" style="margin-top:14px">Notes about this customer <span class="sub">(only admins see this)</span>
            <textarea id="anotes" rows="2" data-act="c-notes">${esc(c.admin_notes)}</textarea></label>
        </section>`}
      </div></div>`;
  }

  // ----- Settings -----
  function tabSettings() {
    const s = S.settings;
    const days = (key) => `<div class="days7">${DN.map((d, i) => `<label><input type="checkbox" name="${key}" value="${i}" ${s[key].includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div>`;
    return `<form id="fSettings"><div class="sgrid">
      <div class="panel"><h3>Delivery fee</h3><label class="f">Per delivered order ($)<input name="delivery_fee" type="number" step="0.5" min="0" value="${s.delivery_fee}"></label></div>
      <div class="panel"><h3>Free delivery</h3><label class="f">On orders over ($)<input name="free_over" type="number" step="1" min="0" value="${s.free_over}"></label></div>
      <div class="panel"><h3>Card surcharge</h3><label class="f">Percent added at checkout<input name="card_fee_pct" type="number" step="0.1" min="0" max="5" value="${s.card_fee_pct}"></label><p class="sub">Leave at 0 to absorb SumUp's fee.</p></div>
      <div class="panel"><h3>Delivery area</h3><div class="grid2"><label class="f">Postcodes from<input name="pc_from" type="number" value="${s.pc_from}"></label><label class="f">to<input name="pc_to" type="number" value="${s.pc_to}"></label></div></div>
      <div class="panel"><h3>Delivery days</h3>${days('delivery_days')}</div>
      <div class="panel"><h3>Pickup days</h3>${days('pickup_days')}</div>
      <div class="panel"><h3>Pickup times</h3><label class="f">One per line<textarea name="pickup_slots" rows="3">${esc(s.pickup_slots.join('\n'))}</textarea></label></div>
      <div class="panel"><h3>Notice needed</h3><label class="f">Earliest day, in days from today<input name="lead_days" type="number" min="0" max="14" value="${s.lead_days}"></label><p class="sub">1 = tomorrow at the earliest.</p></div>
      <div class="panel"><h3>Daily cut-off</h3><label class="f">Hour (24h, Brisbane)<input name="cutoff_hour" type="number" min="0" max="24" value="${s.cutoff_hour}"></label><p class="sub">Orders after this hour can't book the next day. 15 = 3pm. 24 = no cut-off.</p></div>
      <div class="panel"><h3>Pickup address</h3><label class="f">Shown to customers<input name="pickup_address" type="text" value="${esc(s.pickup_address)}"></label></div>
    </div><button class="btn btn-primary" style="margin-top:16px">Save settings</button></form>`;
  }

  // ---------- Data ----------
  async function loadAll() {
    const [orders, products, profiles, settings] = await Promise.all([
      SB.rest('orders?select=*&order=created_at.desc&limit=500'),
      SB.rest('products?select=*&order=is_keg,sort,name'),
      SB.rest('profiles?select=*&order=created_at.desc'),
      SB.rest('settings?id=eq.1&select=*'),
    ]);
    Object.assign(S, { orders, products, profiles, settings: settings[0], loaded: true });
  }
  async function loadOverrides() { S.overrides = S.custId ? await SB.rest(`customer_products?customer_id=eq.${S.custId}&select=*`) : []; }
  const cur = () => S.profiles.find((p) => p.id === S.custId);
  async function patchProfile(body, msg) {
    const [p] = await guard(() => SB.rest(`profiles?id=eq.${S.custId}`, { method: 'PATCH', body, prefer: 'return=representation' }), msg);
    S.profiles = S.profiles.map((x) => (x.id === p.id ? p : x));
  }
  async function upsertOverride(product_id, fields) {
    const existing = S.overrides.find((o) => o.product_id === product_id) || { hidden: false, price: null };
    const row = { customer_id: S.custId, product_id, hidden: existing.hidden, price: existing.price, ...fields };
    if (!row.hidden && row.price == null) {
      await SB.rest(`customer_products?customer_id=eq.${S.custId}&product_id=eq.${encodeURIComponent(product_id)}`, { method: 'DELETE' });
    } else {
      await SB.rest('customer_products?on_conflict=customer_id,product_id', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates' });
    }
    await loadOverrides();
  }
  function formData(form) {
    const d = {}; new FormData(form).forEach((v, k) => { d[k] = v; });
    return d;
  }
  function skuBody(form) {
    const d = formData(form);
    return {
      name: d.name.trim(), style: d.style.trim(), abv: Number(d.abv) || 0, pack: d.pack.trim(), sku: d.sku.trim().toUpperCase(),
      shop_price: Number(d.shop_price), max_per_order: Number(d.max_per_order) > 0 ? Number(d.max_per_order) : null,
      sort: Number(d.sort) || 100, image_url: d.image_url.trim(), is_keg: !!form.is_keg.checked, active: !!form.active.checked,
    };
  }

  // ---------- Events ----------
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act, id = b.dataset.id;
    if (a === 'logout') { await SB.signOut(); location.href = '/'; }
    else if (a === 'filter') { S.filter = b.dataset.v; S.confirmCancel = null; render(); }
    else if (a === 'reload') { await guard(loadAll); render(); toast('Up to date'); }
    else if (a === 'askcancel') { S.confirmCancel = Number(id); render(); }
    else if (a === 'ostatus') {
      const [o] = await guard(() => SB.rest(`orders?id=eq.${id}`, { method: 'PATCH', body: { status: b.dataset.v }, prefer: 'return=representation' }), `Order #${id}: ${STATUS[b.dataset.v]}`);
      S.orders = S.orders.map((x) => (x.id === o.id ? o : x)); S.confirmCancel = null; render();
    }
    else if (a === 'sku-edit') { S.editSku = id; render(); }
    else if (a === 'sku-cancel') { S.editSku = null; render(); }
    else if (a === 'cust') { S.custId = id; S.overrides = []; render(); await guard(loadOverrides); render(); }
    else if (a === 'cstatus') { await patchProfile({ status: b.dataset.v }, b.dataset.v === 'active' ? 'Account reactivated' : 'Account on hold. They can\'t order until you reactivate it.'); render(); }
    else if (a === 'tier') {
      const t = Number(b.dataset.v);
      await patchProfile({ discount_pct: t });
      await guard(() => SB.rest(`customer_products?customer_id=eq.${S.custId}&price=not.is.null`, { method: 'PATCH', body: { price: null } }));
      await guard(() => SB.rest(`customer_products?customer_id=eq.${S.custId}&hidden=is.false&price=is.null`, { method: 'DELETE' }));
      await loadOverrides(); render(); toast(`${cur().org_name}: every price now ${t}% off shop price`);
    }
    else if (a === 'c-reset') { await guard(() => upsertOverride(id, { price: null }), 'Price reset to their tier'); render(); }
  });

  document.addEventListener('change', async (e) => {
    const el = e.target, a = el.dataset.act, id = el.dataset.id;
    const patchProduct = async (body, msg) => {
      const [p] = await guard(() => SB.rest(`products?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body, prefer: 'return=representation' }), msg);
      S.products = S.products.map((x) => (x.id === p.id ? p : x)); render();
    };
    if (a === 'sku-active') await patchProduct({ active: el.checked }, el.checked ? 'Back on sale' : 'Switched off for every customer');
    else if (a === 'sku-price' && !(Number(el.value) > 0)) { toast('Enter a price above $0'); render(); }
    else if (a === 'sku-price') await patchProduct({ shop_price: Number(el.value) }, 'Shop price saved. Customer prices follow it.');
    else if (a === 'sku-max') await patchProduct({ max_per_order: Number(el.value) > 0 ? Number(el.value) : null }, Number(el.value) > 0 ? `Max ${el.value} per order` : 'No limit');
    else if (a === 'tier-custom' && !(el.value !== '' && Number(el.value) >= 0 && Number(el.value) <= 90)) { toast('Enter a discount between 0 and 90%'); render(); }
    else if (a === 'tier-custom') { await patchProfile({ discount_pct: Number(el.value) || 0 }, `Discount set to ${Number(el.value) || 0}%`); render(); }
    else if (a === 'c-show') { await guard(() => upsertOverride(id, { hidden: !el.checked }), el.checked ? 'Shown to this customer' : 'Hidden from this customer'); render(); }
    else if (a === 'c-price' && !(Number(el.value) > 0)) { toast('Enter a price above $0, or untick Show to hide it'); render(); }
    else if (a === 'c-price') {
      const p = S.products.find((x) => x.id === id), c = cur(), v = Number(el.value);
      const tierPrice = Math.round(Number(p.shop_price) * (1 - Number(c.discount_pct) / 100));
      await guard(() => upsertOverride(id, { price: v === tierPrice ? null : v }), `${p.name} ${p.pack}: ${money(v)} for ${c.org_name}`); render();
    }
    else if (a === 'c-notes') { await patchProfile({ admin_notes: el.value }, 'Notes saved'); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.dataset.act === 'csearch') { S.custSearch = e.target.value; const pos = e.target.selectionStart; render(); const i = $('#cs'); i.focus(); i.setSelectionRange(pos, pos); }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target; e.preventDefault();
    if (f.id === 'fEditSku') {
      if (!(skuBody(f).shop_price > 0)) { toast('Enter a shop price above $0'); return; }
      const [p] = await guard(() => SB.rest(`products?id=eq.${encodeURIComponent(f.dataset.id)}`, { method: 'PATCH', body: skuBody(f), prefer: 'return=representation' }), 'SKU saved');
      S.products = S.products.map((x) => (x.id === p.id ? p : x)); S.editSku = null; render();
    } else if (f.id === 'fNewSku') {
      const body = skuBody(f);
      body.id = body.sku.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sku-' + Date.now();
      await guard(() => SB.rest('products', { method: 'POST', body, prefer: 'return=representation' }), `${body.name} ${body.pack} added`);
      S.products = await SB.rest('products?select=*&order=is_keg,sort,name'); render();
    } else if (f.id === 'fSettings') {
      const d = formData(f);
      const days = (k) => [...f.querySelectorAll(`input[name=${k}]:checked`)].map((x) => Number(x.value));
      const body = {
        delivery_fee: Number(d.delivery_fee), free_over: Number(d.free_over), card_fee_pct: Number(d.card_fee_pct),
        pc_from: Number(d.pc_from), pc_to: Number(d.pc_to), lead_days: Number(d.lead_days), cutoff_hour: Number(d.cutoff_hour), pickup_address: d.pickup_address.trim(),
        delivery_days: days('delivery_days'), pickup_days: days('pickup_days'),
        pickup_slots: d.pickup_slots.split('\n').map((s) => s.trim()).filter(Boolean),
      };
      const [s] = await guard(() => SB.rest('settings?id=eq.1', { method: 'PATCH', body, prefer: 'return=representation' }), 'Settings saved');
      S.settings = s; render();
    } else if (f.id === 'fAdminLogin') {
      try { await SB.signIn({ email: $('#ae').value.trim(), password: $('#ap').value }); await start(); }
      catch (err) { $('#aerr').textContent = err.message; $('#aerr').hidden = false; }
    }
  });
  window.addEventListener('hashchange', () => { S.tab = location.hash.slice(1) || 'orders'; S.editSku = null; render(); });

  function loginForm(msg) {
    app.innerHTML = `<section class="panel" style="max-width:420px;margin:50px auto"><h2>Admin log in</h2>
      <form id="fAdminLogin" style="display:grid;gap:12px;margin-top:12px">
        <div id="aerr" class="note bad" ${msg ? '' : 'hidden'}>${esc(msg || '')}</div>
        <label class="f" for="ae">Email<input id="ae" type="email" required autocomplete="email"></label>
        <label class="f" for="ap">Password<input id="ap" type="password" required autocomplete="current-password"></label>
        <button class="btn btn-primary btn-block">Log in</button></form></section>`;
  }

  async function start() {
    if (!SB.configured) { app.innerHTML = '<div class="panel" style="margin-top:40px">Not connected to the database yet. See the setup guide.</div>'; return; }
    if (!SB.session) { loginForm(); return; }
    try {
      const user = await SB.user();
      const [me] = await SB.rest(`profiles?id=eq.${user.id}&select=*`);
      if (!me?.is_admin) { await SB.signOut(); loginForm('That account isn\'t an admin. Log in with an admin account.'); return; }
      S.me = me; S.tab = location.hash.slice(1) || 'orders';
      render(); await loadAll(); render();
      setInterval(async () => { if (S.tab === 'orders' && !document.hidden) { try { const before = S.orders.filter((o) => o.status === 'paid').length; S.orders = await SB.rest('orders?select=*&order=created_at.desc&limit=500'); const after = S.orders.filter((o) => o.status === 'paid').length; if (after > before) toast('New paid order'); if (!document.activeElement || document.activeElement === document.body) render(); } catch (e) {} } }, 60000);
    } catch (e) { console.error(e); loginForm('Your session expired. Log in again.'); }
  }
  start();
})();
