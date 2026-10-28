// POST /api/new-account
// Called by the database (not the browser) when someone signs up. Emails sales@.
import { env, json, sendEmail, esc, safeEqual } from '../lib/shared.mjs';

export default async (req) => {
  if (!safeEqual(req.headers.get('x-notify-secret'), env('NOTIFY_SECRET'))) return json(401, { error: 'Not allowed' });
  const { profile: p } = await req.json();
  if (!p?.email) return json(400, { error: 'No profile' });
  const row = (k, v) => v ? `<tr><td style="padding:4px 14px 4px 0;color:#666">${k}</td><td>${esc(v)}</td></tr>` : '';
  await sendEmail({
    to: env('SALES_EMAIL', 'sales@yourmatesbrewing.com'),
    replyTo: p.email,
    subject: `New trade account: ${p.org_name || p.email}`,
    html: `<div style="font-family:Roboto,Arial,sans-serif;color:#333;max-width:560px">
      <div style="background:#333;color:#fff;padding:14px 18px;font-size:20px;font-weight:bold">NEW TRADE ACCOUNT</div>
      <div style="padding:18px;border:2px solid #000;border-top:0">
        <p style="margin:0 0 12px">Someone just signed up to the trade shop. They get ${Number(p.discount_pct)}% off shop prices straight away.</p>
        <table style="border-collapse:collapse">
          ${row('Organisation', p.org_name)}${row('Type', p.org_type)}${row('Contact', p.contact_name)}
          ${row('Email', p.email)}${row('Phone', p.phone)}
          ${row('Address', [p.address_line, p.suburb, p.postcode].filter(Boolean).join(', '))}
        </table>
        <p style="margin:16px 0 0">Not a genuine trade customer? Suspend them in
          <a href="${env('SITE_URL', '')}/admin.html#customers">admin → Customers</a>. You can also move them to a different discount tier there.</p>
      </div></div>`,
  });
  return json(200, { ok: true });
};

export const config = { path: '/api/new-account' };
