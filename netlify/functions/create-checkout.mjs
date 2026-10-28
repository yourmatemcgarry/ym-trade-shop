// POST /api/create-checkout
// Prices the basket on the server, saves a pending order, and opens a SumUp checkout for it.
import { env, json, sb, sumup, userFromRequest, brisbaneToday, brisbaneHour, settleCheckout } from '../lib/shared.mjs';
import { buildOrder } from '../lib/order.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  try {
    const user = await userFromRequest(req);
    if (!user) return json(401, { error: 'Please log in again.' });
    if (!user.email_confirmed_at || user.is_anonymous) return json(403, { error: 'Confirm your email address first. Check your inbox for the link we sent.' });

    const [profile] = await sb(`profiles?id=eq.${user.id}&select=*`);
    if (!profile) return json(403, { error: 'We could not find your trade account.' });
    if (profile.status !== 'active') return json(403, { error: 'Your trade account is on hold. Call us on (07) 5329 4733.' });

    const input = await req.json();
    const [priceList, [settings]] = await Promise.all([
      sb('rpc/price_list_for', { method: 'POST', body: { p_customer: user.id } }),
      sb('settings?id=eq.1&select=*'),
    ]);

    const { errors, order } = buildOrder({ priceList, settings, input, today: brisbaneToday(), hour: brisbaneHour() });
    if (errors.length) return json(400, { error: errors[0], errors });

    // Tidy up this customer's earlier unpaid attempts: settle any that were actually paid,
    // close the rest at SumUp so an old card form can't be used, and hide them from admin.
    const stale = await sb(`orders?customer_id=eq.${user.id}&status=in.(pending_payment,payment_failed)&select=id,sumup_checkout_id`);
    for (const o of stale) {
      if (o.sumup_checkout_id) {
        const r = await settleCheckout(o.sumup_checkout_id).catch(() => ({ status: 'error' }));
        if (r.status === 'paid' || r.status === 'review') continue;
        await sumup(`checkouts/${encodeURIComponent(o.sumup_checkout_id)}`, { method: 'DELETE' }).catch(() => {});
      }
      await sb(`orders?id=eq.${o.id}&status=in.(pending_payment,payment_failed)`, { method: 'PATCH', body: { status: 'abandoned' } });
    }

    const [saved] = await sb('orders', {
      method: 'POST', prefer: 'return=representation',
      body: { ...order, customer_id: user.id, org_name: profile.org_name, email: profile.email, status: 'pending_payment' },
    });

    const site = env('SITE_URL').replace(/\/$/, '');
    const checkout = await sumup('checkouts', {
      method: 'POST',
      body: {
        checkout_reference: `YMT-${saved.id}-${Date.now().toString(36)}`,
        amount: order.total,
        currency: 'AUD',
        merchant_code: env('SUMUP_MERCHANT_CODE'),
        description: `Your Mates trade order #${saved.id} (${profile.org_name})`.slice(0, 120),
        return_url: `${site}/api/sumup-webhook`,
        redirect_url: `${site}/?paid=${saved.id}`,
      },
    });

    await sb(`orders?id=eq.${saved.id}`, { method: 'PATCH', body: { sumup_checkout_id: checkout.id } });
    return json(200, { orderId: saved.id, checkoutId: checkout.id, total: order.total });
  } catch (e) {
    console.error(e);
    return json(500, { error: 'Something went wrong setting up payment. Nothing has been charged. Please try again.' });
  }
};

export const config = { path: '/api/create-checkout' };
