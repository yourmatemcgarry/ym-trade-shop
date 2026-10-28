// Shared helpers for the Netlify functions. No npm packages needed: plain fetch.

export const env = (k, fallback) => {
  const v = (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing environment variable ${k}`);
  }
  return v;
};

export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ---------- Supabase (service role: bypasses row-level security) ----------
// Supabase's newer "sb_secret_..." keys go in the apikey header only; the older JWT-style
// service_role key also needs to be sent as a Bearer token. Handle both.
const sbHeaders = () => {
  const k = env('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: k, ...(k.startsWith('eyJ') ? { Authorization: `Bearer ${k}` } : {}), 'Content-Type': 'application/json' };
};

export async function sb(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    method,
    headers: { ...sbHeaders(), ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

// Who is calling? Verifies the customer's login token with Supabase.
export async function userFromRequest(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// ---------- SumUp ----------
export async function sumup(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${env('SUMUP_API_BASE', 'https://api.sumup.com/v0.1')}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env('SUMUP_API_KEY')}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SumUp ${method} ${path} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

// ---------- Email (Resend) ----------
export async function sendEmail({ to, subject, html, replyTo }) {
  const key = env('RESEND_API_KEY', '');
  if (!key) { console.warn('RESEND_API_KEY not set; email skipped:', subject); return; }
  const res = await fetch(env('RESEND_API_URL', 'https://api.resend.com/emails'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('MAIL_FROM', 'Your Mates Trade <trade@yourmatesbrewing.com>'),
      to: Array.isArray(to) ? to : [to],
      subject, html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  if (!res.ok) console.error('Email failed', res.status, await res.text());
}

// ---------- Dates (Brisbane time, no daylight saving) ----------
export function brisbaneToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' }).format(new Date()); // YYYY-MM-DD
}
export function brisbaneHour() {
  return Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
}
export function dayDiff(a, b) { // whole days from a to b, both YYYY-MM-DD
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
export function weekday(d) { return new Date(d + 'T00:00:00Z').getUTCDay(); }
export function niceDate(d) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export const money = (n) => '$' + Number(n).toFixed(2);
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const UNATTENDED = {
  attend: 'Someone will be there to receive it',
  leave: 'Leave it in a safe spot',
  call: 'Call before delivering',
};

// ---------- Order emails ----------
export function fulfilmentLines(f) {
  if (f.method === 'pickup') return [['Pickup', `${niceDate(f.date)}, ${f.slot}`], ['From', f.pickup_address || '41 Technology Drive, Warana']];
  const rows = [
    ['Delivery day', niceDate(f.date)],
    ['Needed by', niceDate(f.need_by) + (f.need_by_time ? `, ${f.need_by_time}` : '')],
    ['Address', `${f.address_line}, ${f.suburb} ${f.postcode}`],
    ['If no one\'s there', UNATTENDED[f.unattended] + (f.unattended === 'leave' ? `: ${f.leave_where}` : '')],
  ];
  if (f.delivery_notes) rows.push(['Delivery notes', f.delivery_notes]);
  return rows;
}

export function orderEmailHtml(order, { forCustomer }) {
  const f = order.fulfilment;
  const rows = fulfilmentLines(f).map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('');
  const items = order.items.map((i) => `<tr><td style="padding:6px 0">${i.qty} × ${esc(i.name)} <span style="color:#666">${esc(i.pack)} · ${esc(i.sku)}</span></td><td style="padding:6px 0;text-align:right">${money(i.line)}</td></tr>`).join('');
  const abn = env('BUSINESS_ABN', '');
  return `<div style="font-family:Roboto,Arial,sans-serif;color:#333;max-width:560px">
  <div style="background:#333;color:#fff;padding:14px 18px;font-size:20px;font-weight:bold;letter-spacing:.5px">YOUR MATES TRADE SHOP</div>
  <div style="padding:18px;border:2px solid #000;border-top:0">
    <h2 style="margin:0 0 6px">${forCustomer ? 'Thanks, your order is paid' : 'New paid trade order'} · #${order.id}</h2>
    <p style="margin:0 0 14px;color:#666">${esc(order.org_name)} · ${esc(order.email)}</p>
    <table style="width:100%;border-collapse:collapse;border-bottom:1px solid #ddd">${items}</table>
    <table style="width:100%;border-collapse:collapse;margin-top:8px">
      ${order.delivery_fee > 0 ? `<tr><td>Delivery</td><td style="text-align:right">${money(order.delivery_fee)}</td></tr>` : ''}
      ${order.card_fee > 0 ? `<tr><td>Card fee</td><td style="text-align:right">${money(order.card_fee)}</td></tr>` : ''}
      <tr><td style="font-weight:bold;padding-top:6px">Total paid</td><td style="text-align:right;font-weight:bold;padding-top:6px">${money(order.total)}</td></tr>
      <tr><td style="color:#666">Includes GST</td><td style="text-align:right;color:#666">${money(order.gst)}</td></tr>
    </table>
    <table style="margin-top:16px;border-collapse:collapse">${rows}</table>
    ${order.notes ? `<p style="margin:14px 0 0"><b>Order notes:</b> ${esc(order.notes)}</p>` : ''}
    ${forCustomer ? `<p style="margin:18px 0 0;color:#666;font-size:13px">Tax invoice · Your Mates Brewing Company Pty Ltd${abn ? ` · ABN ${esc(abn)}` : ''} · 41 Technology Drive, Warana QLD 4575. Questions? Reply to this email.</p>`
                  : `<p style="margin:18px 0 0"><a href="${env('SITE_URL', '')}/admin.html#orders">Open the order list</a></p>`}
  </div></div>`;
}

// Mark an order paid exactly once and send the emails. Safe to call from both the
// browser confirmation and the SumUp webhook: only the first caller flips the status.
// If money arrives for an order that was cancelled/abandoned, or the amount doesn't match,
// the order is flagged "needs review" and sales@ is told, so a payment is never lost.
export async function settleCheckout(checkoutId) {
  const orders = await sb(`orders?sumup_checkout_id=eq.${encodeURIComponent(checkoutId)}&select=*`);
  const order = orders?.[0];
  if (!order) return { status: 'unknown' };
  const checkout = await sumup(`checkouts/${encodeURIComponent(checkoutId)}`);

  if (checkout.status === 'PAID') {
    if (['paid', 'packed', 'completed'].includes(order.status)) return { status: 'paid', order };
    if (order.status === 'needs_review') return { status: 'review', order };

    const amountOk = Math.abs(Number(checkout.amount) - Number(order.total)) < 0.01;
    const settleable = ['pending_payment', 'payment_failed'].includes(order.status);
    if (amountOk && settleable) {
      const updated = await sb(`orders?id=eq.${order.id}&status=in.(pending_payment,payment_failed)`, {
        method: 'PATCH', body: { status: 'paid', paid_at: new Date().toISOString() }, prefer: 'return=representation',
      });
      if (updated?.length) {
        const o = updated[0];
        await Promise.all([
          sendEmail({ to: env('SALES_EMAIL', 'sales@yourmatesbrewing.com'), subject: `Trade order #${o.id} · ${o.org_name} · ${money(o.total)}`, html: orderEmailHtml(o, { forCustomer: false }), replyTo: o.email }),
          sendEmail({ to: o.email, subject: `Your Mates order #${o.id} is confirmed`, html: orderEmailHtml(o, { forCustomer: true }), replyTo: env('SALES_EMAIL', 'sales@yourmatesbrewing.com') }),
        ]);
        return { status: 'paid', order: o };
      }
      const [again] = await sb(`orders?id=eq.${order.id}&select=*`); // someone else settled it a moment ago
      return { status: ['paid', 'packed', 'completed'].includes(again?.status) ? 'paid' : 'review', order: again };
    }

    const reason = !amountOk
      ? `SumUp took ${money(checkout.amount)} but the order total is ${money(order.total)}.`
      : `Payment of ${money(checkout.amount)} arrived after the order was marked "${order.status}".`;
    const flagged = await sb(`orders?id=eq.${order.id}&status=neq.needs_review`, {
      method: 'PATCH', body: { status: 'needs_review', review_reason: reason, paid_at: new Date().toISOString() }, prefer: 'return=representation',
    });
    if (flagged?.length) {
      await sendEmail({
        to: env('SALES_EMAIL', 'sales@yourmatesbrewing.com'), replyTo: order.email,
        subject: `CHECK: trade order #${order.id} was paid but needs review`,
        html: `<p><b>${esc(reason)}</b></p><p>Either fulfil it (set it back to "Paid" in admin) or refund it in SumUp.</p>` + orderEmailHtml(flagged[0], { forCustomer: false }),
      });
    }
    return { status: 'review', order: flagged?.[0] || order };
  }
  if (checkout.status === 'FAILED' || checkout.status === 'EXPIRED') {
    await sb(`orders?id=eq.${order.id}&status=eq.pending_payment`, { method: 'PATCH', body: { status: 'payment_failed' } });
    return { status: 'failed', order };
  }
  return { status: 'pending', order };
}

export function safeEqual(a, b) {
  a = String(a ?? ''); b = String(b ?? '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
