// POST /api/bulk-enquiry
// A logged-in customer asks about bulk / regular-order pricing. Emails orders@ with their details.
import { env, json, sb, sendEmail, esc, userFromRequest } from '../lib/shared.mjs';

const FREQ = {
  weekly: 'Every week', fortnightly: 'Every fortnight', monthly: 'About once a month',
  event: 'A large one-off order (event)', other: 'Something else',
};

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  try {
    const user = await userFromRequest(req);
    if (!user) return json(401, { error: 'Please log in again.' });
    if (!user.email_confirmed_at) return json(403, { error: 'Confirm your email address first.' });
    const [p] = await sb(`profiles?id=eq.${user.id}&select=*`);
    if (!p) return json(403, { error: 'We could not find your trade account.' });

    const body = await req.json().catch(() => ({}));
    const freq = FREQ[body.frequency] ? body.frequency : 'other';
    const volume = String(body.volume ?? '').trim().slice(0, 200);
    const message = String(body.message ?? '').trim().slice(0, 1500);
    const phone = String(body.phone ?? p.phone ?? '').trim().slice(0, 30);
    if (!volume) return json(400, { error: 'Tell us roughly how much you order.' });

    const row = (k, v) => v ? `<tr><td style="padding:4px 14px 4px 0;color:#666;vertical-align:top">${k}</td><td>${esc(v)}</td></tr>` : '';
    await sendEmail({
      to: env('SALES_EMAIL', 'orders@yourmatesbrewing.com'),
      replyTo: p.email,
      subject: `Bulk pricing enquiry: ${p.org_name || p.email}`,
      html: `<div style="font-family:Roboto,Arial,sans-serif;color:#333;max-width:560px">
        <div style="background:#333;color:#fff;padding:14px 18px;font-size:20px;font-weight:bold">BULK PRICING ENQUIRY</div>
        <div style="padding:18px;border:2px solid #000;border-top:0">
          <table style="border-collapse:collapse">
            ${row('Organisation', p.org_name)}${row('Type', p.org_type)}${row('Contact', p.contact_name)}
            ${row('Email', p.email)}${row('Phone', phone)}
            ${row('How often', FREQ[freq])}${row('Usual order', volume)}${row('Message', message)}
            ${row('Current discount', Number(p.discount_pct) + '% off shop prices')}
          </table>
          <p style="margin:16px 0 0">Reply to this email to answer them. To change their pricing, open
            <a href="${env('SITE_URL', '')}/admin.html#customers">admin → Customers &amp; prices</a>.</p>
        </div></div>`,
    });
    return json(200, { ok: true });
  } catch (e) {
    console.error(e);
    return json(500, { error: "That didn't send. Try again, or call us on (07) 5329 4733." });
  }
};

export const config = { path: '/api/bulk-enquiry' };
